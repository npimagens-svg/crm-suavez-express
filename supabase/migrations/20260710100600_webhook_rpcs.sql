-- ============================================================================
-- P0 PAGAMENTO (7/7): RPCs transacionais do asaas-webhook.
-- Falhas cobertas: 10, 11, 14.
-- Chamadas APENAS pela Edge Function asaas-webhook (service_role).
-- ============================================================================

-- ── Pagamento confirmado: cria/atualiza a queue_entry de forma IDEMPOTENTE ──
-- O lock FOR UPDATE na intent garante: N retries/duplicatas do webhook → 1 entry.
CREATE OR REPLACE FUNCTION public.webhook_pagamento_confirmado(
  p_asaas_payment_id text,
  p_external_reference text DEFAULT NULL,
  p_value numeric DEFAULT NULL,
  p_billing_type text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intent purchase_intents%ROWTYPE;
  v_entry_id uuid;
  v_token uuid;
  v_pos int;
  v_first_service uuid;
  v_rows int;
BEGIN
  -- Localiza a intent pelo payment id ou pelo externalReference (= intent.id)
  SELECT * INTO v_intent FROM purchase_intents
   WHERE asaas_payment_id = p_asaas_payment_id
   FOR UPDATE;
  IF NOT FOUND AND p_external_reference ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO v_intent FROM purchase_intents
     WHERE id = p_external_reference::uuid
     FOR UPDATE;
    IF FOUND AND v_intent.asaas_payment_id IS NULL THEN
      UPDATE purchase_intents SET asaas_payment_id = p_asaas_payment_id, updated_at = now()
       WHERE id = v_intent.id;
    END IF;
  END IF;

  -- LEGADO (fluxo antigo, sem intent): sincroniza a entry existente pelo payment_id
  IF v_intent.id IS NULL THEN
    UPDATE queue_entries
       SET payment_status = 'confirmed',
           paid_amount = COALESCE(paid_amount, p_value),
           updated_at = now()
     WHERE payment_id = p_asaas_payment_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN jsonb_build_object('mode', 'legacy', 'updated_rows', v_rows);
  END IF;

  -- Idempotência: entry já criada → só garante o status
  IF v_intent.queue_entry_id IS NOT NULL THEN
    UPDATE queue_entries
       SET payment_status = 'confirmed',
           paid_amount = COALESCE(paid_amount, p_value, v_intent.total),
           updated_at = now()
     WHERE id = v_intent.queue_entry_id AND payment_status <> 'confirmed';
    RETURN jsonb_build_object('mode', 'idempotent', 'queue_entry_id', v_intent.queue_entry_id);
  END IF;

  -- Cria a entry SERVER-SIDE (mesmo com o browser fechado — falha 10)
  v_first_service := (v_intent.service_ids ->> 0)::uuid;
  SELECT COALESCE(MAX(position), 0) + 1 INTO v_pos
    FROM queue_entries
   WHERE salon_id = v_intent.salon_id
     AND status IN ('waiting', 'checked_in', 'in_service');

  INSERT INTO queue_entries (
    salon_id, customer_id, customer_name, customer_phone, customer_email,
    service_id, service_ids, source, position, notify_minutes_before,
    payment_id, payment_status, paid_amount, intent_id, status
  )
  SELECT v_intent.salon_id,
         (SELECT id FROM clients c
           WHERE c.salon_id = v_intent.salon_id
             AND right(regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g'), 8)
                 = right(v_intent.customer_phone, 8)
           LIMIT 1),
         v_intent.customer_name, v_intent.customer_phone, v_intent.customer_email,
         v_first_service, v_intent.service_ids, 'online', v_pos,
         COALESCE(v_intent.notify_minutes_before, 40),
         p_asaas_payment_id, 'confirmed',
         COALESCE(p_value, v_intent.total), v_intent.id, 'waiting'
  RETURNING id, tracking_token INTO v_entry_id, v_token;

  UPDATE purchase_intents
     SET status = 'queued', queue_entry_id = v_entry_id,
         paid_at = COALESCE(paid_at, now()), updated_at = now()
   WHERE id = v_intent.id;

  RETURN jsonb_build_object('mode', 'created', 'queue_entry_id', v_entry_id,
                            'tracking_token', v_token, 'position', v_pos);
END;
$$;

-- ── Refund / chargeback / cancelamento: reconciliação completa ───────────────
-- Fila (cancela se não atendida), crédito (expira o não usado), pagamento
-- interno (void) e caixa (estorno auditado se o caixa ainda estiver aberto).
CREATE OR REPLACE FUNCTION public.webhook_pagamento_revertido(
  p_asaas_payment_id text,
  p_event text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intent purchase_intents%ROWTYPE;
  v_new_status text;
  v_entry queue_entries%ROWTYPE;
  v_credits int := 0;
  v_voided int := 0;
  v_caixa_ajustado boolean := false;
  v_caixa_pendente boolean := false;
  r record;
BEGIN
  v_new_status := CASE
    WHEN p_event LIKE 'PAYMENT_CHARGEBACK%' OR p_event = 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL'
      THEN 'chargeback'
    ELSE 'refunded'
  END;

  SELECT * INTO v_intent FROM purchase_intents
   WHERE asaas_payment_id = p_asaas_payment_id FOR UPDATE;
  IF FOUND THEN
    UPDATE purchase_intents SET status = v_new_status, updated_at = now()
     WHERE id = v_intent.id;
  END IF;

  -- Entry da fila (via intent OU legado via payment_id)
  SELECT * INTO v_entry FROM queue_entries
   WHERE id = COALESCE(v_intent.queue_entry_id,
                       (SELECT id FROM queue_entries WHERE payment_id = p_asaas_payment_id
                         ORDER BY created_at DESC LIMIT 1))
   FOR UPDATE;

  IF FOUND THEN
    UPDATE queue_entries
       SET payment_status = 'refunded',
           status = CASE WHEN status IN ('waiting', 'checked_in') THEN 'cancelled' ELSE status END,
           updated_at = now()
     WHERE id = v_entry.id;

    -- Crédito gerado a partir dessa entry e ainda não usado → expira AGORA
    UPDATE customer_credits
       SET expires_at = now()
     WHERE origin_queue_entry_id = v_entry.id
       AND used = false
       AND expires_at > now();
    GET DIAGNOSTICS v_credits = ROW_COUNT;
  END IF;

  -- Pagamentos internos vinculados a esse pagamento de provedor → void
  FOR r IN
    SELECT p.id, p.comanda_id, p.salon_id, p.amount, p.payment_method::text AS method,
           c.caixa_id, cx.closed_at AS caixa_closed
      FROM payments p
      LEFT JOIN comandas c ON c.id = p.comanda_id
      LEFT JOIN caixas cx ON cx.id = c.caixa_id
     WHERE p.provider_payment_id = p_asaas_payment_id
       AND p.voided = false
  LOOP
    UPDATE payments
       SET voided = true, voided_at = now(),
           voided_reason = 'Asaas ' || p_event
     WHERE id = r.id;
    v_voided := v_voided + 1;

    IF r.caixa_id IS NOT NULL AND r.caixa_closed IS NULL THEN
      INSERT INTO caixa_movements (caixa_id, salon_id, user_id, type, amount, reason, payment_method)
      SELECT r.caixa_id, r.salon_id, cx.user_id, 'estorno_reabertura', r.amount,
             'Estorno automático (Asaas ' || p_event || ') pagamento ' || p_asaas_payment_id,
             CASE WHEN r.method IN ('cash','pix','credit_card','debit_card') THEN r.method ELSE 'other' END
        FROM caixas cx WHERE cx.id = r.caixa_id;
      v_caixa_ajustado := true;
    ELSIF r.caixa_id IS NOT NULL THEN
      v_caixa_pendente := true;  -- caixa já fechado: reconciliar manualmente
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true, 'event', p_event, 'status', v_new_status,
    'entry_cancelled', v_entry.id IS NOT NULL,
    'credits_expirados', v_credits,
    'payments_voided', v_voided,
    'caixa_ajustado', v_caixa_ajustado,
    'caixa_pendente_manual', v_caixa_pendente);
END;
$$;

-- Só service_role executa (webhook). Nada de anon/authenticated.
REVOKE ALL ON FUNCTION public.webhook_pagamento_confirmado(text, text, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.webhook_pagamento_revertido(text, text) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- ROLLBACK (manual): DROP FUNCTION webhook_pagamento_confirmado(text,text,numeric,text);
--   DROP FUNCTION webhook_pagamento_revertido(text,text);
-- ============================================================================
