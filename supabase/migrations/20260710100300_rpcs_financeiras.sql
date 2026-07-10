-- ============================================================================
-- P0 INTEGRIDADE (4/6): fechamento/reabertura de comanda, crédito da fila e
-- fechamento de caixa viram RPCs TRANSACIONAIS com papel validado no banco.
-- Falhas cobertas: 12, 15, 16, 17, 19 (parcial), + race de caixa (11 parcial).
-- Regra única de crédito (falha 16): crédito nasce SÓ de
--   (a) cancelamento com pagamento confirmado (fila_cancelar), ou
--   (b) fim de dia pago sem atendimento em waiting/checked_in (cron v2 abaixo).
--   no_show NUNCA gera crédito.
-- ============================================================================

-- ── 0. Helpers ───────────────────────────────────────────────────────────────
-- Papel financeiro: só admin e financial alteram caixa/pagamento/crédito/
-- fechamento (spec do Cleiton). Em prod hoje só existem admin e professional,
-- então ninguém operante perde acesso.
CREATE OR REPLACE FUNCTION public.fn_role_financeiro(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT has_role(_uid, 'admin'::app_role) OR has_role(_uid, 'financial'::app_role);
$$;
REVOKE ALL ON FUNCTION public.fn_role_financeiro(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_role_financeiro(uuid) TO authenticated;

-- Réplica fiel de getCardFeePercent (src/hooks/useCardBrands.ts:22-37).
CREATE OR REPLACE FUNCTION public.fn_card_fee_percent(
  p_brand public.card_brands, p_method text, p_installments int)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_fee numeric;
BEGIN
  IF p_method = 'debit_card' THEN
    RETURN COALESCE(p_brand.debit_fee_percent, 0);
  END IF;
  -- Prefer per-installment fees if available
  IF p_brand.credit_installment_fees IS NOT NULL
     AND p_brand.credit_installment_fees <> '{}'::jsonb THEN
    IF p_installments <= 1 THEN RETURN COALESCE(p_brand.credit_fee_percent, 0); END IF;
    v_fee := (p_brand.credit_installment_fees ->> p_installments::text)::numeric;
    IF v_fee IS NOT NULL THEN RETURN v_fee; END IF;
  END IF;
  -- Fallback range-based
  IF p_installments <= 1 THEN RETURN COALESCE(p_brand.credit_fee_percent, 0); END IF;
  IF p_installments <= 6 THEN RETURN COALESCE(p_brand.credit_2_6_fee_percent, 0); END IF;
  IF p_installments <= 12 THEN RETURN COALESCE(p_brand.credit_7_12_fee_percent, 0); END IF;
  RETURN COALESCE(p_brand.credit_13_18_fee_percent, 0);
END;
$$;

-- caixa_movements ganha o tipo auditável de estorno por reabertura.
ALTER TABLE public.caixa_movements DROP CONSTRAINT IF EXISTS caixa_movements_type_check;
ALTER TABLE public.caixa_movements ADD CONSTRAINT caixa_movements_type_check
  CHECK (type IN ('sangria', 'suprimento', 'estorno_reabertura'));

CREATE OR REPLACE FUNCTION public.apply_caixa_movement()
RETURNS trigger LANGUAGE plpgsql AS $f$
DECLARE
  v_caixa public.caixas%ROWTYPE;
  v_delta numeric;
BEGIN
  SELECT * INTO v_caixa FROM public.caixas WHERE id = NEW.caixa_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caixa nao encontrado';
  END IF;
  IF v_caixa.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Nao e possivel movimentar um caixa fechado';
  END IF;
  -- sangria e estorno_reabertura tiram; suprimento põe
  v_delta := CASE WHEN NEW.type IN ('sangria', 'estorno_reabertura') THEN -NEW.amount ELSE NEW.amount END;
  UPDATE public.caixas SET
    total_cash        = GREATEST(0, COALESCE(total_cash, 0)        + CASE WHEN NEW.payment_method = 'cash'        THEN v_delta ELSE 0 END),
    total_pix         = GREATEST(0, COALESCE(total_pix, 0)         + CASE WHEN NEW.payment_method = 'pix'         THEN v_delta ELSE 0 END),
    total_credit_card = GREATEST(0, COALESCE(total_credit_card, 0) + CASE WHEN NEW.payment_method = 'credit_card' THEN v_delta ELSE 0 END),
    total_debit_card  = GREATEST(0, COALESCE(total_debit_card, 0)  + CASE WHEN NEW.payment_method = 'debit_card'  THEN v_delta ELSE 0 END),
    total_other       = GREATEST(0, COALESCE(total_other, 0)       + CASE WHEN NEW.payment_method = 'other'       THEN v_delta ELSE 0 END),
    updated_at = now()
  WHERE id = NEW.caixa_id;
  RETURN NEW;
END;
$f$;

-- ── 1. Fechamento de comanda (atômico) ──────────────────────────────────────
-- O servidor recalcula o subtotal dos ITENS (verdade do banco), calcula taxa
-- de cartão/PIX, insere payments, incrementa o caixa numa única UPDATE
-- (sem read-modify-write) e dá baixa na fila. Tudo em UMA transação.
-- p_payments: [{"method","amount","notes","bank_account_id","card_brand_id","installments"}]
CREATE OR REPLACE FUNCTION public.rpc_fechar_comanda(
  p_comanda uuid,
  p_caixa uuid,
  p_payments jsonb DEFAULT '[]'::jsonb,
  p_discount numeric DEFAULT 0,
  p_allow_underpaid boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_salon uuid;
  v_comanda comandas%ROWTYPE;
  v_caixa caixas%ROWTYPE;
  v_subtotal numeric;
  v_total numeric;
  v_existing_paid numeric;
  v_new_paid numeric := 0;
  v_pay jsonb;
  v_method text;
  v_amount numeric;
  v_installments int;
  v_brand card_brands%ROWTYPE;
  v_fee numeric;
  v_pix_fee_pct numeric;
  v_inc_cash numeric := 0; v_inc_pix numeric := 0; v_inc_cc numeric := 0;
  v_inc_dc numeric := 0; v_inc_other numeric := 0;
BEGIN
  IF v_uid IS NULL OR NOT fn_role_financeiro(v_uid) THEN
    RAISE EXCEPTION 'Sem permissão para fechar comanda';
  END IF;
  v_salon := get_user_salon_id(v_uid);

  SELECT * INTO v_comanda FROM comandas WHERE id = p_comanda AND salon_id = v_salon FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comanda não encontrada'; END IF;
  IF v_comanda.closed_at IS NOT NULL THEN RAISE EXCEPTION 'Comanda já está fechada'; END IF;

  SELECT * INTO v_caixa FROM caixas WHERE id = p_caixa AND salon_id = v_salon FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Caixa não encontrado'; END IF;
  IF v_caixa.closed_at IS NOT NULL THEN RAISE EXCEPTION 'Caixa está fechado'; END IF;

  IF p_discount IS NULL OR p_discount < 0 THEN RAISE EXCEPTION 'Desconto inválido'; END IF;

  SELECT COALESCE(SUM(total_price), 0) INTO v_subtotal
    FROM comanda_items WHERE comanda_id = p_comanda;
  v_total := GREATEST(0, v_subtotal - p_discount);

  -- Pagamentos já vinculados (ex.: Asaas online) abatem do que falta pagar.
  SELECT COALESCE(SUM(amount), 0) INTO v_existing_paid
    FROM payments WHERE comanda_id = p_comanda AND voided = false;

  SELECT pix_fee_percent INTO v_pix_fee_pct
    FROM commission_settings WHERE salon_id = v_salon LIMIT 1;
  v_pix_fee_pct := COALESCE(v_pix_fee_pct, 0);

  FOR v_pay IN SELECT * FROM jsonb_array_elements(COALESCE(p_payments, '[]'::jsonb))
  LOOP
    v_method := v_pay ->> 'method';
    v_amount := (v_pay ->> 'amount')::numeric;
    v_installments := COALESCE((v_pay ->> 'installments')::int, 1);
    IF v_method NOT IN ('cash', 'pix', 'credit_card', 'debit_card', 'other') THEN
      RAISE EXCEPTION 'Método de pagamento inválido: %', v_method;
    END IF;
    IF v_amount IS NULL OR v_amount <= 0 THEN
      RAISE EXCEPTION 'Valor de pagamento inválido';
    END IF;

    v_fee := 0;
    IF v_method IN ('credit_card', 'debit_card') THEN
      IF (v_pay ->> 'card_brand_id') IS NULL THEN
        RAISE EXCEPTION 'Bandeira do cartão obrigatória';
      END IF;
      SELECT * INTO v_brand FROM card_brands
       WHERE id = (v_pay ->> 'card_brand_id')::uuid AND salon_id = v_salon;
      IF NOT FOUND THEN RAISE EXCEPTION 'Bandeira não encontrada'; END IF;
      v_fee := round(v_amount * fn_card_fee_percent(v_brand, v_method, v_installments) / 100, 2);
    ELSIF v_method = 'pix' AND v_pix_fee_pct > 0 THEN
      v_fee := round(v_amount * v_pix_fee_pct / 100, 2);
    END IF;

    INSERT INTO payments (comanda_id, salon_id, payment_method, payment_provider,
                          amount, notes, bank_account_id, card_brand_id,
                          installments, fee_amount, net_amount)
    VALUES (p_comanda, v_salon, v_method::payment_method,
            CASE WHEN v_method IN ('credit_card', 'debit_card') THEN 'pagbank' ELSE 'manual' END,
            v_amount, v_pay ->> 'notes',
            CASE WHEN v_method = 'pix' THEN (v_pay ->> 'bank_account_id')::uuid ELSE NULL END,
            CASE WHEN v_method IN ('credit_card', 'debit_card') THEN (v_pay ->> 'card_brand_id')::uuid ELSE NULL END,
            CASE WHEN v_method = 'credit_card' THEN v_installments ELSE 1 END,
            v_fee, v_amount - v_fee);

    v_new_paid := v_new_paid + v_amount;
    IF    v_method = 'cash'        THEN v_inc_cash  := v_inc_cash + v_amount;
    ELSIF v_method = 'pix'         THEN v_inc_pix   := v_inc_pix + v_amount;
    ELSIF v_method = 'credit_card' THEN v_inc_cc    := v_inc_cc + v_amount;
    ELSIF v_method = 'debit_card'  THEN v_inc_dc    := v_inc_dc + v_amount;
    ELSE                                v_inc_other := v_inc_other + v_amount;
    END IF;
  END LOOP;

  IF (v_existing_paid + v_new_paid) < (v_total - 0.01) AND NOT p_allow_underpaid THEN
    RAISE EXCEPTION 'Pagamento incompleto: pago % de %', v_existing_paid + v_new_paid, v_total;
  END IF;

  -- Incremento atômico (uma única UPDATE, caixa já travado por FOR UPDATE)
  UPDATE caixas SET
    total_cash        = COALESCE(total_cash, 0) + v_inc_cash,
    total_pix         = COALESCE(total_pix, 0) + v_inc_pix,
    total_credit_card = COALESCE(total_credit_card, 0) + v_inc_cc,
    total_debit_card  = COALESCE(total_debit_card, 0) + v_inc_dc,
    total_other       = COALESCE(total_other, 0) + v_inc_other,
    updated_at        = now()
  WHERE id = p_caixa;

  UPDATE comandas SET
    closed_at = now(), is_paid = true,
    subtotal = v_subtotal, discount = p_discount, total = v_total,
    caixa_id = p_caixa, updated_at = now()
  WHERE id = p_comanda;

  -- Baixa na fila: a cliente terminou
  IF v_comanda.client_id IS NOT NULL THEN
    UPDATE queue_entries
       SET status = 'completed', updated_at = now()
     WHERE salon_id = v_salon AND customer_id = v_comanda.client_id
       AND status IN ('waiting', 'checked_in', 'in_service');
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'comanda_id', p_comanda, 'subtotal', v_subtotal,
    'total', v_total, 'paid', v_existing_paid + v_new_paid);
END;
$$;

-- ── 2. Reabertura de comanda (auditável, preserva pagamento de provedor) ────
CREATE OR REPLACE FUNCTION public.rpc_reabrir_comanda(p_comanda uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_salon uuid;
  v_comanda comandas%ROWTYPE;
  v_caixa caixas%ROWTYPE;
  v_voided int := 0;
  v_kept int := 0;
  r record;
BEGIN
  IF v_uid IS NULL OR NOT fn_role_financeiro(v_uid) THEN
    RAISE EXCEPTION 'Sem permissão para reabrir comanda';
  END IF;
  v_salon := get_user_salon_id(v_uid);

  SELECT * INTO v_comanda FROM comandas WHERE id = p_comanda AND salon_id = v_salon FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comanda não encontrada'; END IF;
  IF v_comanda.closed_at IS NULL THEN RAISE EXCEPTION 'Comanda já está aberta'; END IF;

  IF v_comanda.caixa_id IS NOT NULL THEN
    SELECT * INTO v_caixa FROM caixas WHERE id = v_comanda.caixa_id FOR UPDATE;
    IF FOUND AND v_caixa.closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'O caixa precisa estar aberto para reabrir a comanda';
    END IF;
  END IF;

  -- Pagamentos MANUAIS viram void (estorno explícito e auditável).
  -- Pagamentos de PROVEDOR ONLINE (asaas) NÃO são apagados nem voidados:
  -- o dinheiro existe no provedor; segue abatendo no refechamento.
  FOR r IN
    SELECT payment_method::text AS method, SUM(amount) AS total, count(*) AS qtd
      FROM payments
     WHERE comanda_id = p_comanda AND voided = false
       AND (payment_provider IS DISTINCT FROM 'asaas')
     GROUP BY payment_method
  LOOP
    IF v_comanda.caixa_id IS NOT NULL THEN
      INSERT INTO caixa_movements (caixa_id, salon_id, user_id, type, amount, reason, payment_method)
      VALUES (v_comanda.caixa_id, v_salon, v_uid, 'estorno_reabertura', r.total,
              'Reabertura da comanda ' || COALESCE(v_comanda.comanda_number::text, p_comanda::text)
              || COALESCE(': ' || NULLIF(trim(p_reason), ''), ''),
              r.method);
    END IF;
    v_voided := v_voided + r.qtd;
  END LOOP;

  UPDATE payments
     SET voided = true, voided_at = now(),
         voided_reason = 'Reabertura da comanda' || COALESCE(': ' || NULLIF(trim(p_reason), ''), '')
   WHERE comanda_id = p_comanda AND voided = false
     AND (payment_provider IS DISTINCT FROM 'asaas');

  SELECT count(*) INTO v_kept
    FROM payments WHERE comanda_id = p_comanda AND voided = false;

  UPDATE comandas SET closed_at = NULL, is_paid = false, caixa_id = NULL, updated_at = now()
   WHERE id = p_comanda;

  RETURN jsonb_build_object('ok', true, 'voided_payments', v_voided, 'kept_provider_payments', v_kept);
END;
$$;

-- ── 3. Aplicar crédito da fila na comanda (atômico, sem corrida) ────────────
CREATE OR REPLACE FUNCTION public.rpc_aplicar_credito_fila(p_comanda uuid, p_credit uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_salon uuid;
  v_credit customer_credits%ROWTYPE;
  v_comanda comandas%ROWTYPE;
  v_new_discount numeric;
BEGIN
  IF v_uid IS NULL OR NOT fn_role_financeiro(v_uid) THEN
    RAISE EXCEPTION 'Sem permissão para aplicar crédito';
  END IF;
  v_salon := get_user_salon_id(v_uid);

  -- Lock no crédito: duas comandas em corrida não debitam o mesmo crédito.
  SELECT * INTO v_credit FROM customer_credits
   WHERE id = p_credit AND salon_id = v_salon FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Crédito não encontrado'; END IF;
  IF v_credit.used THEN RAISE EXCEPTION 'Crédito já utilizado'; END IF;
  IF v_credit.expires_at < now() THEN RAISE EXCEPTION 'Crédito expirado'; END IF;

  SELECT * INTO v_comanda FROM comandas WHERE id = p_comanda AND salon_id = v_salon FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comanda não encontrada'; END IF;
  IF v_comanda.closed_at IS NOT NULL THEN RAISE EXCEPTION 'Comanda já está fechada'; END IF;

  v_new_discount := COALESCE(v_comanda.discount, 0) + v_credit.amount;

  UPDATE customer_credits SET used = true, used_at = now() WHERE id = p_credit;
  UPDATE comandas
     SET discount = v_new_discount,
         total = GREATEST(0, COALESCE(subtotal, 0) - v_new_discount),
         updated_at = now()
   WHERE id = p_comanda;

  RETURN jsonb_build_object('ok', true, 'credit_amount', v_credit.amount, 'new_discount', v_new_discount);
END;
$$;

-- ── 4. Fechamento de caixa (trava server-side) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_fechar_caixa(
  p_caixa uuid, p_closing_balance numeric DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_salon uuid;
  v_caixa caixas%ROWTYPE;
  v_abertas int;
BEGIN
  IF v_uid IS NULL OR NOT fn_role_financeiro(v_uid) THEN
    RAISE EXCEPTION 'Sem permissão para fechar caixa';
  END IF;
  v_salon := get_user_salon_id(v_uid);

  SELECT * INTO v_caixa FROM caixas WHERE id = p_caixa AND salon_id = v_salon FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Caixa não encontrado'; END IF;
  IF v_caixa.closed_at IS NOT NULL THEN RAISE EXCEPTION 'Caixa já está fechado'; END IF;

  SELECT count(*) INTO v_abertas
    FROM comandas WHERE salon_id = v_salon AND closed_at IS NULL;
  IF v_abertas > 0 THEN
    RAISE EXCEPTION 'Existem % comanda(s) aberta(s). Feche todas antes de fechar o caixa.', v_abertas;
  END IF;

  UPDATE caixas
     SET closed_at = now(), closing_balance = p_closing_balance,
         notes = COALESCE(p_notes, notes), updated_at = now()
   WHERE id = p_caixa;

  RETURN jsonb_build_object('ok', true, 'caixa_id', p_caixa);
END;
$$;

-- ── 5. fila_creditos_fim_do_dia v2 — regra única + valor pago real ──────────
-- (a) SÓ waiting/checked_in pagos geram crédito (no_show/cancelled NÃO — a
--     recepção marcou de propósito, e cancelamento pago já gerou o crédito
--     na hora via fila_cancelar).
-- (b) Valor = paid_amount (snapshot do que foi PAGO), fallback = soma dos
--     serviços de service_ids (multi-serviço), nunca só o primeiro.
CREATE OR REPLACE FUNCTION public.fila_creditos_fim_do_dia()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_qtd int := 0;
  r record;
BEGIN
  FOR r IN
    SELECT qe.id, qe.salon_id, qe.customer_id, qe.customer_phone,
           COALESCE(
             qe.paid_amount,
             (SELECT SUM(COALESCE(s.price, 0))
                FROM jsonb_array_elements_text(COALESCE(qe.service_ids, to_jsonb(ARRAY[qe.service_id::text]))) AS sid
                JOIN services s ON s.id = sid::uuid),
             0) AS valor,
           COALESCE(qs.credit_validity_days, 30) AS validade
      FROM queue_entries qe
      LEFT JOIN queue_settings qs ON qs.salon_id = qe.salon_id
     WHERE (qe.created_at AT TIME ZONE 'America/Sao_Paulo')::date = v_hoje
       AND qe.payment_status = 'confirmed'
       AND qe.status IN ('waiting', 'checked_in')   -- regra única: no_show/cancelled NÃO
       AND NOT EXISTS (SELECT 1 FROM customer_credits cc WHERE cc.origin_queue_entry_id = qe.id)
  LOOP
    INSERT INTO customer_credits (salon_id, customer_id, customer_phone, amount,
                                  origin_queue_entry_id, expires_at, used)
    VALUES (r.salon_id, r.customer_id, r.customer_phone, r.valor,
            r.id, now() + make_interval(days => r.validade), false)
    ON CONFLICT DO NOTHING;

    UPDATE queue_entries
       SET status = 'no_show', payment_status = 'credit', updated_at = now()
     WHERE id = r.id;

    v_qtd := v_qtd + 1;
  END LOOP;

  RETURN jsonb_build_object('dia', v_hoje, 'creditos_gerados', v_qtd);
END;
$$;

-- ── 6. Grants (fail closed) ──────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.rpc_fechar_comanda(uuid, uuid, jsonb, numeric, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_reabrir_comanda(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_aplicar_credito_fila(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_fechar_caixa(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_fechar_comanda(uuid, uuid, jsonb, numeric, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_reabrir_comanda(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_aplicar_credito_fila(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_fechar_caixa(uuid, numeric, text) TO authenticated;
-- CREATE OR REPLACE preserva ACL, mas garante de novo (defensivo):
REVOKE EXECUTE ON FUNCTION public.fila_creditos_fim_do_dia() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fila_creditos_fim_do_dia() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fila_creditos_fim_do_dia() FROM authenticated;

-- ============================================================================
-- ROLLBACK (manual): DROP das funções rpc_*, fn_card_fee_percent,
--   fn_role_financeiro; restaurar apply_caixa_movement e o CHECK antigo de
--   caixa_movements (sem 'estorno_reabertura'); restaurar fila_creditos_fim_do_dia
--   da migration 20260704200000 (comportamento antigo tem as falhas 15/16).
-- ============================================================================
