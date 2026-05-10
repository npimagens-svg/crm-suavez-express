-- ====================================================================
-- asaas_pending_leads: cliente clicou na fila online + gerou Asaas
-- mas ainda não pagou (PENDING). Captura como lead pra equipe seguir.
-- ====================================================================

CREATE TABLE IF NOT EXISTS asaas_pending_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  asaas_payment_id text NOT NULL UNIQUE,
  customer_name text,
  customer_phone text,
  customer_email text,
  value numeric(10, 2),
  billing_type text,
  description text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid_online', 'paid_in_salon', 'lost', 'cancelled')),
  queue_entry_id uuid REFERENCES queue_entries(id) ON DELETE SET NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_reason text,
  resolved_comanda_id uuid REFERENCES comandas(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_asaas_pending_leads_status
  ON asaas_pending_leads(salon_id, status, detected_at DESC);

ALTER TABLE asaas_pending_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "asaas_pending_leads_select_own"
  ON asaas_pending_leads FOR SELECT
  USING (salon_id IN (SELECT salon_id FROM profiles WHERE user_id = auth.uid()));

CREATE POLICY "asaas_pending_leads_update_own"
  ON asaas_pending_leads FOR UPDATE
  USING (salon_id IN (SELECT salon_id FROM profiles WHERE user_id = auth.uid()));

COMMENT ON TABLE asaas_pending_leads IS
  'Leads que clicaram pra entrar na fila online e geraram cobranca Asaas. Captura cliente mesmo se ela nao pagar - permite follow-up.';
