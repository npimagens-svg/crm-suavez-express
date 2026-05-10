-- ====================================================================
-- Fechamento Diário NP Hair Express
-- Spec: docs/superpowers/specs/2026-05-10-fechamento-diario-design.md
-- ====================================================================

-- 1) Relatório consolidado por dia
CREATE TABLE IF NOT EXISTS daily_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  report_date date NOT NULL,
  kpis jsonb NOT NULL,
  pagbank_raw jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  generated_by text NOT NULL DEFAULT 'cron'
    CHECK (generated_by IN ('cron','manual','admin_command','backfill')),
  generated_by_user_id uuid REFERENCES profiles(id),
  UNIQUE (salon_id, report_date)
);

-- 2) Pendências detectadas no fechamento
CREATE TABLE IF NOT EXISTS closure_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  comanda_id uuid REFERENCES comandas(id) ON DELETE SET NULL,
  professional_id uuid REFERENCES professionals(id) ON DELETE SET NULL,
  detected_date date NOT NULL,
  issue_type text NOT NULL CHECK (issue_type IN (
    'payment_method_mismatch',
    'value_mismatch',
    'comanda_open_24h',
    'professional_missing',
    'duplicate_service_same_client',
    'paid_without_payment',
    'payment_without_paid_flag',
    'pagbank_orphan_transaction',
    'cashback_overdraft'
  )),
  severity text NOT NULL CHECK (severity IN ('high','medium','low')),
  description text NOT NULL,
  expected_value jsonb,
  actual_value jsonb,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','in_correction','auto_resolved','marked_resolved','resolved','reopened','ignored')),
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  ignored_reason text,
  ignored_by uuid REFERENCES profiles(id)
);

-- 3) Histórico de ações sobre pendências
CREATE TABLE IF NOT EXISTS closure_issue_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL REFERENCES closure_issues(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN (
    'requested_correction','reminded','marked_resolved',
    'auto_resolved','reopened','ignored'
  )),
  user_id uuid REFERENCES profiles(id),
  message text,
  whatsapp_message_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_closure_issues_status
  ON closure_issues(salon_id, status, detected_date DESC);
CREATE INDEX IF NOT EXISTS idx_closure_issues_comanda
  ON closure_issues(comanda_id) WHERE comanda_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_daily_reports_date
  ON daily_reports(salon_id, report_date DESC);
CREATE INDEX IF NOT EXISTS idx_closure_issue_actions_issue
  ON closure_issue_actions(issue_id, created_at DESC);

-- ====================================================================
-- RLS Policies
-- ====================================================================

ALTER TABLE daily_reports        ENABLE ROW LEVEL SECURITY;
ALTER TABLE closure_issues       ENABLE ROW LEVEL SECURITY;
ALTER TABLE closure_issue_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_reports_select_own_salon"
  ON daily_reports FOR SELECT
  USING (salon_id IN (SELECT salon_id FROM profiles WHERE user_id = auth.uid()));

CREATE POLICY "daily_reports_insert_own_salon"
  ON daily_reports FOR INSERT
  WITH CHECK (salon_id IN (SELECT salon_id FROM profiles WHERE user_id = auth.uid()));

CREATE POLICY "daily_reports_update_own_salon"
  ON daily_reports FOR UPDATE
  USING (salon_id IN (SELECT salon_id FROM profiles WHERE user_id = auth.uid()));

CREATE POLICY "closure_issues_select_own_salon"
  ON closure_issues FOR SELECT
  USING (salon_id IN (SELECT salon_id FROM profiles WHERE user_id = auth.uid()));

CREATE POLICY "closure_issues_insert_own_salon"
  ON closure_issues FOR INSERT
  WITH CHECK (salon_id IN (SELECT salon_id FROM profiles WHERE user_id = auth.uid()));

CREATE POLICY "closure_issues_update_own_salon"
  ON closure_issues FOR UPDATE
  USING (salon_id IN (SELECT salon_id FROM profiles WHERE user_id = auth.uid()));

CREATE POLICY "closure_issue_actions_select_own_salon"
  ON closure_issue_actions FOR SELECT
  USING (issue_id IN (
    SELECT id FROM closure_issues
    WHERE salon_id IN (SELECT salon_id FROM profiles WHERE user_id = auth.uid())
  ));

CREATE POLICY "closure_issue_actions_insert_own_salon"
  ON closure_issue_actions FOR INSERT
  WITH CHECK (issue_id IN (
    SELECT id FROM closure_issues
    WHERE salon_id IN (SELECT salon_id FROM profiles WHERE user_id = auth.uid())
  ));

-- ====================================================================
-- Trigger: re-avalia closure_issues quando comanda/payment muda
-- ====================================================================

CREATE OR REPLACE FUNCTION recheck_closure_issues_on_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_comanda_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'comandas' THEN
    v_comanda_id := COALESCE(NEW.id, OLD.id);
  ELSIF TG_TABLE_NAME = 'payments' THEN
    v_comanda_id := COALESCE(NEW.comanda_id, OLD.comanda_id);
  END IF;

  IF v_comanda_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Marca issues open/in_correction/reopened como auto_resolved
  -- A revalidação completa ocorre no próximo cron (Edge Function)
  UPDATE closure_issues
     SET status = 'auto_resolved',
         resolved_at = now()
   WHERE comanda_id = v_comanda_id
     AND status IN ('open','in_correction','reopened');

  -- Log da ação
  INSERT INTO closure_issue_actions (issue_id, action, message)
  SELECT id, 'auto_resolved',
         format('Trigger %s em %s detectou alteracao', TG_OP, TG_TABLE_NAME)
    FROM closure_issues
   WHERE comanda_id = v_comanda_id
     AND status = 'auto_resolved'
     AND resolved_at >= now() - interval '1 second';

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS recheck_closure_on_comanda_update ON comandas;
CREATE TRIGGER recheck_closure_on_comanda_update
  AFTER UPDATE OF total, is_paid ON comandas
  FOR EACH ROW
  EXECUTE FUNCTION recheck_closure_issues_on_change();

DROP TRIGGER IF EXISTS recheck_closure_on_payment_change ON payments;
CREATE TRIGGER recheck_closure_on_payment_change
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION recheck_closure_issues_on_change();
