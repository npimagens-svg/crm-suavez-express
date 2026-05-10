-- ====================================================================
-- payment_provider em payments
-- Cleiton 10/05: identificar de qual banco/gateway veio o pagamento
-- (pagbank | asaas | manual). Permite cruzamento separado nos relatórios.
-- ====================================================================

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS payment_provider text
    DEFAULT 'manual'
    CHECK (payment_provider IN ('pagbank', 'asaas', 'manual'));

CREATE INDEX IF NOT EXISTS idx_payments_provider
  ON payments(salon_id, payment_provider, created_at DESC);

COMMENT ON COLUMN payments.payment_provider IS
  'Gateway/banco do pagamento: pagbank (maquininha), asaas (fila online), manual (PIX direto/dinheiro/registrado a mao)';

-- Backfill: payments existentes ficam 'manual' (default já cobre).
-- A partir de agora, ComandaModal grava 'pagbank' pra cartao e Fila.tsx
-- grava 'asaas' pra pagamento online da fila.
