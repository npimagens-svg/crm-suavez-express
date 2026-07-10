-- ============================================================================
-- P0 SEGURANÇA (2/6): fila pública deixa de acessar tabelas e passa a usar
-- RPCs SECURITY DEFINER de escopo mínimo, com token opaco de acompanhamento.
-- Falhas cobertas: 1, 2 (anon read/insert), 13 (parcial — posse por token).
-- ============================================================================

-- ── 1. Colunas novas em queue_entries ────────────────────────────────────────
-- tracking_token: prova de posse opaca (browser só conhece o token da PRÓPRIA
-- entrada). gen_random_uuid() é volátil → Postgres preenche linha a linha,
-- então entradas antigas também ganham token único.
ALTER TABLE public.queue_entries
  ADD COLUMN IF NOT EXISTS tracking_token uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS paid_amount numeric,
  ADD COLUMN IF NOT EXISTS intent_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_queue_entries_tracking_token
  ON public.queue_entries (tracking_token);

-- ── 2. Fim do acesso anônimo direto ──────────────────────────────────────────
DROP POLICY IF EXISTS "queue_entries_anon_read"   ON public.queue_entries;
DROP POLICY IF EXISTS "queue_entries_anon_insert" ON public.queue_entries;
DROP POLICY IF EXISTS "queue_settings_anon_read"  ON public.queue_settings;
-- Policies criadas direto em prod (não existem no repo) — cobertas pela RPC:
DROP POLICY IF EXISTS "salons_anon_read"   ON public.salons;
DROP POLICY IF EXISTS "services_anon_read" ON public.services;

-- ── 3. RPCs públicas (escopo mínimo, zero PII, zero segredo) ─────────────────

-- Bootstrap da página pública: salão, config não sensível, serviços e stats.
CREATE OR REPLACE FUNCTION public.fila_public_bootstrap()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_salon uuid;
  v_profs int;
  v_total_min numeric;
  v_count int;
BEGIN
  SELECT id INTO v_salon FROM salons ORDER BY created_at LIMIT 1;
  IF v_salon IS NULL THEN
    RETURN jsonb_build_object('salon_id', NULL);
  END IF;

  SELECT count(*)::int INTO v_profs
    FROM professionals WHERE salon_id = v_salon AND is_active = true;
  IF v_profs = 0 THEN v_profs := 1; END IF;

  -- Duração total das entradas ativas (multi-serviço via service_ids).
  SELECT count(*)::int,
         COALESCE(SUM(entry_min.total), 0)
    INTO v_count, v_total_min
    FROM queue_entries qe
    CROSS JOIN LATERAL (
      SELECT COALESCE(
               (SELECT SUM(COALESCE(s.duration_minutes, 45))
                  FROM jsonb_array_elements_text(COALESCE(qe.service_ids, to_jsonb(ARRAY[qe.service_id::text]))) AS sid
                  JOIN services s ON s.id = sid::uuid),
               45) AS total
    ) entry_min
   WHERE qe.salon_id = v_salon
     AND qe.status IN ('waiting', 'checked_in');

  RETURN jsonb_build_object(
    'salon_id', v_salon,
    'settings', (SELECT jsonb_build_object(
                   'inflation_factor', inflation_factor,
                   'credit_validity_days', credit_validity_days,
                   'notify_options', notify_options)
                   FROM queue_settings WHERE salon_id = v_salon),
    'services', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                   'id', id, 'name', name, 'price', price,
                   'duration_minutes', duration_minutes) ORDER BY name)
                   FROM services
                  WHERE salon_id = v_salon AND is_active = true AND queue_enabled = true), '[]'::jsonb),
    'stats', jsonb_build_object(
      'total_in_queue', v_count,
      'estimated_minutes', CEIL(v_total_min / v_profs),
      'active_professionals', v_profs)
  );
END;
$$;

-- Situação da PRÓPRIA entrada, via token opaco. Nada de listar a fila inteira.
CREATE OR REPLACE FUNCTION public.fila_minha_situacao(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry queue_entries%ROWTYPE;
  v_ahead int;
  v_profs int;
  v_ahead_min numeric;
  v_names text;
BEGIN
  SELECT * INTO v_entry FROM queue_entries WHERE tracking_token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT count(*)::int INTO v_profs
    FROM professionals WHERE salon_id = v_entry.salon_id AND is_active = true;
  IF v_profs = 0 THEN v_profs := 1; END IF;

  SELECT count(*)::int,
         COALESCE(SUM(m.total), 0)
    INTO v_ahead, v_ahead_min
    FROM queue_entries qe
    CROSS JOIN LATERAL (
      SELECT COALESCE(
               (SELECT SUM(COALESCE(s.duration_minutes, 45))
                  FROM jsonb_array_elements_text(COALESCE(qe.service_ids, to_jsonb(ARRAY[qe.service_id::text]))) AS sid
                  JOIN services s ON s.id = sid::uuid),
               45) AS total
    ) m
   WHERE qe.salon_id = v_entry.salon_id
     AND qe.status IN ('waiting', 'checked_in')
     AND qe.position < v_entry.position;

  SELECT string_agg(s.name, ' + ' ORDER BY s.name) INTO v_names
    FROM jsonb_array_elements_text(COALESCE(v_entry.service_ids, to_jsonb(ARRAY[v_entry.service_id::text]))) AS sid
    JOIN services s ON s.id = sid::uuid;

  RETURN jsonb_build_object(
    'found', true,
    'status', v_entry.status,
    'payment_status', v_entry.payment_status,
    'people_ahead', v_ahead,
    'estimated_minutes', CEIL(v_ahead_min / v_profs),
    'service_names', COALESCE(v_names, ''),
    'customer_first_name', split_part(v_entry.customer_name, ' ', 1)
  );
END;
$$;

-- Cancelamento pela própria cliente: exige o token opaco (prova de posse).
-- REGRA ÚNICA DE CRÉDITO (falha 16): crédito nasce de
--   (a) cancelamento com pagamento confirmado (aqui), ou
--   (b) fim de dia pago sem atendimento em waiting/checked_in (cron v2).
-- no_show NUNCA gera crédito. Índice único em origin_queue_entry_id impede duplo.
CREATE OR REPLACE FUNCTION public.fila_cancelar(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry queue_entries%ROWTYPE;
  v_validity int;
BEGIN
  SELECT * INTO v_entry FROM queue_entries
   WHERE tracking_token = p_token
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_entry.status NOT IN ('waiting', 'checked_in') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'status_' || v_entry.status);
  END IF;

  IF v_entry.payment_status = 'confirmed' THEN
    SELECT COALESCE(credit_validity_days, 30) INTO v_validity
      FROM queue_settings WHERE salon_id = v_entry.salon_id;
    INSERT INTO customer_credits (salon_id, customer_id, customer_phone, amount,
                                  origin_queue_entry_id, expires_at, used)
    VALUES (v_entry.salon_id, v_entry.customer_id, v_entry.customer_phone,
            COALESCE(v_entry.paid_amount, 0), v_entry.id,
            now() + make_interval(days => COALESCE(v_validity, 30)), false)
    ON CONFLICT DO NOTHING;

    UPDATE queue_entries
       SET status = 'cancelled', payment_status = 'credit', updated_at = now()
     WHERE id = v_entry.id;
    RETURN jsonb_build_object('ok', true, 'credit', true);
  END IF;

  UPDATE queue_entries
     SET status = 'cancelled', updated_at = now()
   WHERE id = v_entry.id;
  RETURN jsonb_build_object('ok', true, 'credit', false);
END;
$$;

-- (fila_intent_status vive na migration 20260710100200, junto da tabela
--  purchase_intents que ela consulta.)

-- ── 4. Grants explícitos (fail closed por padrão) ───────────────────────────
REVOKE ALL ON FUNCTION public.fila_public_bootstrap() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fila_minha_situacao(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fila_cancelar(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fila_public_bootstrap() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fila_minha_situacao(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fila_cancelar(uuid) TO anon, authenticated;

-- ============================================================================
-- ROLLBACK (manual): recriar as policies anon antigas (20260414_queue_tables.sql
-- linhas 92-102 + salons_anon_read/services_anon_read) e dropar as 4 functions.
-- As colunas novas são inofensivas se ficarem.
-- ============================================================================
