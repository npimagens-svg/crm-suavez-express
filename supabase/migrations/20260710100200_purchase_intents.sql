-- ============================================================================
-- P0 PAGAMENTO (3/6): intenção de compra server-side com snapshot de valor,
-- idempotência ponta a ponta e constraints únicas.
-- Falhas cobertas: 3 (parcial — snapshot), 10 (parcial), 11, 12 (parcial).
-- ============================================================================

-- ── 1. Tabela de intenções ───────────────────────────────────────────────────
-- Criada pela Edge Function asaas-checkout ANTES do pagamento. O webhook usa o
-- externalReference (= id da intent) para criar a queue_entry de forma
-- idempotente, mesmo que o browser feche.
CREATE TABLE IF NOT EXISTS public.purchase_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  customer_email text,
  service_ids jsonb NOT NULL,           -- uuids dos serviços no momento da compra
  description text,
  total numeric NOT NULL CHECK (total >= 0),  -- SNAPSHOT do valor cobrado
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'queued', 'cancelled', 'refunded', 'chargeback')),
  billing_type text,
  asaas_customer_id text,
  asaas_payment_id text,
  idempotency_key text,
  queue_entry_id uuid REFERENCES public.queue_entries(id),
  notify_minutes_before integer DEFAULT 40,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unicidade/idempotência
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_intents_asaas_payment
  ON public.purchase_intents (asaas_payment_id) WHERE asaas_payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_intents_idempotency
  ON public.purchase_intents (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_intents_queue_entry
  ON public.purchase_intents (queue_entry_id) WHERE queue_entry_id IS NOT NULL;

ALTER TABLE public.purchase_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.purchase_intents FROM PUBLIC, anon;
-- Staff do salão enxerga (auditoria); escrita só via service_role (functions).
CREATE POLICY purchase_intents_staff_read ON public.purchase_intents
  FOR SELECT TO authenticated
  USING (salon_id = get_user_salon_id(auth.uid()));

-- ── 2. Unicidade em queue_entries e customer_credits ────────────────────────
-- Um pagamento Asaas → no máximo UMA entrada de fila.
-- ⚠️ Prod tem duplicatas HISTÓRICAS (pay_vqgbmvamcx0282f7 ×7, pay_c83gzbk8ms3jz98r ×2
-- — verificado em 10/07/2026, prova viva da falha). Índice escopado no tempo
-- para não travar a aplicação; após limpeza manual das linhas antigas,
-- substituir pelo índice pleno (comando no rollback/report).
CREATE UNIQUE INDEX IF NOT EXISTS uq_queue_entries_payment_id
  ON public.queue_entries (payment_id)
  WHERE payment_id IS NOT NULL AND created_at >= '2026-07-10T12:00:00Z';
-- Uma intent → no máximo UMA entrada de fila.
CREATE UNIQUE INDEX IF NOT EXISTS uq_queue_entries_intent_id
  ON public.queue_entries (intent_id) WHERE intent_id IS NOT NULL;
-- Uma entrada de fila → no máximo UM crédito gerado.
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_credits_origin
  ON public.customer_credits (origin_queue_entry_id) WHERE origin_queue_entry_id IS NOT NULL;

-- ── 3. payments: vínculo com provedor + void auditável ──────────────────────
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS provider_payment_id text,
  ADD COLUMN IF NOT EXISTS voided boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_reason text;

-- Um pagamento de provedor → no máximo UM payment interno NÃO-voidado.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_provider_payment
  ON public.payments (salon_id, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL AND voided = false;

-- ── 4. RPC pública de status da intent (browser conhece só o próprio uuid) ──
CREATE OR REPLACE FUNCTION public.fila_intent_status(p_intent uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_token uuid;
BEGIN
  SELECT pi.status, qe.tracking_token
    INTO v_status, v_token
    FROM purchase_intents pi
    LEFT JOIN queue_entries qe ON qe.id = pi.queue_entry_id
   WHERE pi.id = p_intent;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  RETURN jsonb_build_object(
    'found', true,
    'status', v_status,
    'tracking_token', CASE WHEN v_status = 'queued' THEN v_token ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fila_intent_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fila_intent_status(uuid) TO anon, authenticated;

-- ============================================================================
-- ROLLBACK (manual): DROP FUNCTION fila_intent_status(uuid);
--   DROP TABLE purchase_intents; DROP INDEX uq_queue_entries_payment_id,
--   uq_queue_entries_intent_id, uq_customer_credits_origin,
--   uq_payments_provider_payment; colunas novas de payments podem ficar.
-- ⚠️ uq_queue_entries_payment_id: se houver payment_id duplicado histórico,
--   a migration FALHA — conferir antes com o SELECT do relatório (dedup manual).
-- ============================================================================
