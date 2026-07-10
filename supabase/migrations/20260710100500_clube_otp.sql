-- ============================================================================
-- P0 CLUBE (6/6): entrar na fila pelo Clube exige OTP (prova de posse do
-- telefone), não apenas o número. Débito de crédito continua atômico
-- (FOR UPDATE já existia; mantido).
-- Falha coberta: 13.
-- Fluxo: Edge Function clube-otp (service_role) gera código de 6 dígitos,
-- grava HASH aqui e envia via WhatsApp (Z-API, segredos em salon_secrets).
-- A RPC clube_entrar_fila(p_celular, p_otp) valida hash+expiração+tentativas.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.clube_otp (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  celular_digits text NOT NULL,
  code_hash text NOT NULL,           -- sha256(codigo || id) — nunca o código puro
  expires_at timestamptz NOT NULL,
  used boolean NOT NULL DEFAULT false,
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clube_otp_phone ON public.clube_otp (celular_digits, created_at DESC);

ALTER TABLE public.clube_otp ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clube_otp FROM PUBLIC, anon, authenticated;
-- (zero policies: só service_role escreve/lê)

-- Assinatura ANTIGA (só telefone) é REMOVIDA — era a falha.
DROP FUNCTION IF EXISTS public.clube_entrar_fila(text);

CREATE OR REPLACE FUNCTION public.clube_entrar_fila(p_celular text, p_otp text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_digits text := regexp_replace(COALESCE(p_celular, ''), '\D', '', 'g');
  v_otp clube_otp%ROWTYPE;
  v_ass clube_assinantes%ROWTYPE;
  v_salon uuid;
  v_comp text;
  v_cred clube_creditos%ROWTYPE;
  v_existing_id uuid;
  v_existing_pos int;
  v_client uuid;
  v_service uuid;
  v_pos int;
  v_entry_id uuid;
  v_token uuid;
BEGIN
  IF length(v_digits) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'celular_invalido');
  END IF;
  IF p_otp IS NULL OR length(trim(p_otp)) <> 6 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'otp_invalido');
  END IF;

  -- ── Prova de posse: OTP válido, não usado, não expirado, < 5 tentativas ──
  SELECT * INTO v_otp
    FROM clube_otp
   WHERE right(celular_digits, 8) = right(v_digits, 8)
     AND used = false
     AND expires_at > now()
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'otp_expirado');
  END IF;
  IF v_otp.attempts >= 5 THEN
    UPDATE clube_otp SET used = true WHERE id = v_otp.id;
    RETURN jsonb_build_object('ok', false, 'erro', 'otp_bloqueado');
  END IF;
  IF v_otp.code_hash <> encode(digest(trim(p_otp) || v_otp.id::text, 'sha256'), 'hex') THEN
    UPDATE clube_otp SET attempts = attempts + 1 WHERE id = v_otp.id;
    RETURN jsonb_build_object('ok', false, 'erro', 'otp_incorreto');
  END IF;
  UPDATE clube_otp SET used = true WHERE id = v_otp.id;

  -- ── Daqui pra baixo: mesma lógica de negócio da versão anterior ──────────
  SELECT * INTO v_ass
    FROM clube_assinantes
   WHERE status = 'ativo'
     AND right(regexp_replace(COALESCE(celular, ''), '\D', '', 'g'), 9) = right(v_digits, 9)
   ORDER BY updated_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    SELECT * INTO v_ass
      FROM clube_assinantes
     WHERE status = 'ativo'
       AND right(regexp_replace(COALESCE(celular, ''), '\D', '', 'g'), 8) = right(v_digits, 8)
     ORDER BY updated_at DESC
     LIMIT 1;
  END IF;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado');
  END IF;

  SELECT id INTO v_salon FROM salons ORDER BY created_at LIMIT 1;

  SELECT id, position INTO v_existing_id, v_existing_pos
    FROM queue_entries
   WHERE salon_id = v_salon
     AND status IN ('waiting', 'checked_in', 'in_service')
     AND right(regexp_replace(COALESCE(customer_phone, ''), '\D', '', 'g'), 8) = right(v_digits, 8)
   LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'ja_na_fila', 'position', v_existing_pos);
  END IF;

  v_comp := to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM');
  INSERT INTO clube_creditos (assinante_id, competencia, creditos_total, creditos_usados)
  VALUES (v_ass.id, v_comp, COALESCE(v_ass.teto_mensal, 4), 0)
  ON CONFLICT (assinante_id, competencia) DO NOTHING;

  SELECT * INTO v_cred
    FROM clube_creditos
   WHERE assinante_id = v_ass.id AND competencia = v_comp
   FOR UPDATE;
  IF v_cred.creditos_usados >= v_cred.creditos_total THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'teto_atingido',
      'usadas', v_cred.creditos_usados, 'total', v_cred.creditos_total);
  END IF;

  SELECT id INTO v_client
    FROM clients
   WHERE salon_id = v_salon
     AND right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 8) = right(v_digits, 8)
   LIMIT 1;
  IF v_client IS NULL THEN
    INSERT INTO clients (salon_id, name, phone, email)
    VALUES (v_salon, COALESCE(v_ass.nome, 'Assinante Clube'), v_digits, v_ass.email)
    RETURNING id INTO v_client;
  END IF;

  SELECT id INTO v_service
    FROM services
   WHERE salon_id = v_salon AND is_active = true AND name ILIKE 'ESCOVA LISA%'
   ORDER BY price ASC
   LIMIT 1;

  SELECT COALESCE(MAX(position), 0) + 1 INTO v_pos
    FROM queue_entries
   WHERE salon_id = v_salon AND status IN ('waiting', 'checked_in', 'in_service');

  INSERT INTO queue_entries (
    salon_id, customer_id, customer_name, customer_phone, customer_email,
    service_id, source, position, notify_minutes_before,
    payment_status, payment_method, status
  ) VALUES (
    v_salon, v_client, COALESCE(v_ass.nome, 'Assinante Clube'), v_digits, v_ass.email,
    v_service, 'online', v_pos, 40,
    'credit', 'clube', 'waiting'
  ) RETURNING id, tracking_token INTO v_entry_id, v_token;

  UPDATE clube_creditos
     SET creditos_usados = creditos_usados + 1
   WHERE assinante_id = v_ass.id AND competencia = v_comp;

  -- Devolve o TOKEN opaco (acompanhamento), não o id interno.
  RETURN jsonb_build_object('ok', true,
    'tracking_token', v_token, 'position', v_pos,
    'nome', v_ass.nome,
    'usadas', v_cred.creditos_usados + 1, 'total', v_cred.creditos_total);
END;
$$;

REVOKE ALL ON FUNCTION public.clube_entrar_fila(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clube_entrar_fila(text, text) TO anon, authenticated, service_role;

-- ============================================================================
-- ROLLBACK (manual): DROP FUNCTION clube_entrar_fila(text,text);
--   DROP TABLE clube_otp; recriar clube_entrar_fila(text) da migration
--   20260704090000 (versão SEM prova de posse — a falha volta).
-- ============================================================================
