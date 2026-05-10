-- ====================================================================
-- Asaas em daily-report:
--   1) Novo issue_type: asaas_payment_pending
--   2) Coluna asaas_raw em daily_reports pra guardar payload bruto
-- Cleiton 10/05: integração Asaas em daily-report.
-- ====================================================================

ALTER TABLE closure_issues DROP CONSTRAINT IF EXISTS closure_issues_issue_type_check;

ALTER TABLE closure_issues ADD CONSTRAINT closure_issues_issue_type_check
  CHECK (issue_type IN (
    'payment_method_mismatch',
    'value_mismatch',
    'comanda_open_24h',
    'professional_missing',
    'duplicate_service_same_client',
    'paid_without_payment',
    'payment_without_paid_flag',
    'pagbank_orphan_transaction',
    'cashback_overdraft',
    'asaas_payment_pending'
  ));

ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS asaas_raw jsonb;

COMMENT ON COLUMN daily_reports.asaas_raw IS
  'Payload bruto Asaas { payments: AsaasPayment[], unavailable: boolean } do dia';
