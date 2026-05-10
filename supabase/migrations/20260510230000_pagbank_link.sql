-- ====================================================================
-- payments.pagbank_nsu — link 1-a-1 com transação PagBank EDI
-- Permite matching exato (valor + hora ±30min) em vez de agregado.
-- Pedido Cleiton 10/05: ver cada transação detalhada.
-- ====================================================================

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS pagbank_nsu text,
  ADD COLUMN IF NOT EXISTS pagbank_authorized_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_payments_pagbank_nsu
  ON payments(pagbank_nsu) WHERE pagbank_nsu IS NOT NULL;

COMMENT ON COLUMN payments.pagbank_nsu IS
  'NSU PagBank (Numero Sequencial Unico da transacao). Linka 1-a-1 com EDI.';
COMMENT ON COLUMN payments.pagbank_authorized_at IS
  'Timestamp exato da autorizacao na maquininha (data_venda_ajuste + hora_venda_ajuste do EDI).';
