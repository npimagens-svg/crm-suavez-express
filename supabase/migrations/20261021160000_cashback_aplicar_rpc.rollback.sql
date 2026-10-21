-- Reverte 20261021160000_cashback_aplicar_rpc.sql
-- (o front anterior fazia UPDATE direto em client_credits; reverter junto o ComandaModal)
DROP FUNCTION IF EXISTS public.rpc_aplicar_credito_cliente(uuid, uuid);
UPDATE system_config SET value = '120' WHERE key = 'cashback_min_purchase';
