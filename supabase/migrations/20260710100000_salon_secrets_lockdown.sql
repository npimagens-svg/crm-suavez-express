-- ============================================================================
-- P0 SEGURANÇA (1/6): segredos fora de queue_settings/system_config,
-- system_config com allowlist, revoke em fila_creditos_fim_do_dia.
-- Falhas cobertas: 1 (parcial), 6, 7.
-- Aditiva e reversível (rollback comentado no fim).
-- ============================================================================

-- ── 1. Cofre backend-only por salão ─────────────────────────────────────────
-- Acessível EXCLUSIVAMENTE por Edge Functions com service_role (bypassa RLS).
-- RLS habilitado SEM policy nenhuma + REVOKE explícito = deny para anon e
-- authenticated por construção.
CREATE TABLE IF NOT EXISTS public.salon_secrets (
  salon_id uuid PRIMARY KEY REFERENCES public.salons(id) ON DELETE CASCADE,
  asaas_api_key text,
  zapi_instance_id text,
  zapi_token text,
  zapi_client_token text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.salon_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.salon_secrets FROM PUBLIC, anon, authenticated;

-- ── 2. Migrar segredos de queue_settings → salon_secrets e LIMPAR origem ────
-- Coluna zapi_client_token pode existir só em prod (adicionada fora do repo):
-- garante a coluna antes de copiar para não quebrar em shadow db.
ALTER TABLE public.queue_settings ADD COLUMN IF NOT EXISTS zapi_client_token text;

INSERT INTO public.salon_secrets (salon_id, asaas_api_key, zapi_instance_id, zapi_token, zapi_client_token)
SELECT salon_id, asaas_api_key, zapi_instance_id, zapi_token, zapi_client_token
  FROM public.queue_settings
    ON CONFLICT (salon_id) DO UPDATE
   SET asaas_api_key     = COALESCE(EXCLUDED.asaas_api_key, salon_secrets.asaas_api_key),
       zapi_instance_id  = COALESCE(EXCLUDED.zapi_instance_id, salon_secrets.zapi_instance_id),
       zapi_token        = COALESCE(EXCLUDED.zapi_token, salon_secrets.zapi_token),
       zapi_client_token = COALESCE(EXCLUDED.zapi_client_token, salon_secrets.zapi_client_token),
       updated_at        = now();

UPDATE public.queue_settings
   SET asaas_api_key = NULL,
       zapi_instance_id = NULL,
       zapi_token = NULL,
       zapi_client_token = NULL;

-- ── 3. system_config: allowlist de leitura + escrita só admin/financeiro ────
-- Chaves não-sensíveis que o front usa hoje (cashback + master email).
-- Chave nova só entra na leitura do client se for adicionada aqui (fail closed).
DROP POLICY IF EXISTS "Authenticated users can read system config" ON public.system_config;
DROP POLICY IF EXISTS "Authenticated users can insert system config" ON public.system_config;
DROP POLICY IF EXISTS "Authenticated users can update system config" ON public.system_config;

CREATE POLICY "system_config_read_allowlist" ON public.system_config
  FOR SELECT TO authenticated
  USING (key IN (
    'cashback_enabled', 'cashback_min_purchase', 'cashback_percent',
    'cashback_validity_days', 'master_user_email'
  ));

CREATE POLICY "system_config_admin_insert" ON public.system_config
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'financial'::app_role));

CREATE POLICY "system_config_admin_update" ON public.system_config
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'financial'::app_role));

-- resend_api_key era legível por QUALQUER autenticado → considerada vazada.
-- Fonte passa a ser exclusivamente Supabase Secrets (RESEND_API_KEY).
-- ⚠️ OPERACIONAL: `supabase secrets set RESEND_API_KEY=<nova>` ANTES do deploy
-- das functions, senão e-mail falha fechado (comportamento desejado).
DELETE FROM public.system_config WHERE key = 'resend_api_key';

-- ── 4. fila_creditos_fim_do_dia: só cron/service_role executa ───────────────
REVOKE EXECUTE ON FUNCTION public.fila_creditos_fim_do_dia() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fila_creditos_fim_do_dia() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fila_creditos_fim_do_dia() FROM authenticated;

-- ============================================================================
-- ROLLBACK (manual, se necessário):
--   UPDATE queue_settings qs SET asaas_api_key = ss.asaas_api_key,
--     zapi_instance_id = ss.zapi_instance_id, zapi_token = ss.zapi_token,
--     zapi_client_token = ss.zapi_client_token
--     FROM salon_secrets ss WHERE ss.salon_id = qs.salon_id;
--   DROP TABLE salon_secrets;
--   DROP POLICY system_config_read_allowlist ON system_config;
--   DROP POLICY system_config_admin_insert ON system_config;
--   DROP POLICY system_config_admin_update ON system_config;
--   CREATE POLICY "Authenticated users can read system config" ON system_config FOR SELECT TO authenticated USING (true);
--   CREATE POLICY "Authenticated users can insert system config" ON system_config FOR INSERT TO authenticated WITH CHECK (true);
--   CREATE POLICY "Authenticated users can update system config" ON system_config FOR UPDATE TO authenticated USING (true);
--   GRANT EXECUTE ON FUNCTION fila_creditos_fim_do_dia() TO authenticated;
--   (resend_api_key: recadastrar nova chave — a antiga deve ser rotacionada de qualquer forma)
-- ============================================================================
