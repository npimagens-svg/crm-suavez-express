-- Cashback do Express (Cleiton 21/10, nova gerente Dani)
--
-- 1) Aplicar cashback/crédito de troco (client_credits) passa a ser uma RPC atômica.
--    Antes o front fazia UPDATE direto em client_credits, mas a policy de UPDATE só aceita
--    admin/financial: na recepção o UPDATE afetava 0 linhas SEM erro, o desconto entrava na
--    comanda e o crédito continuava disponível (dava pra usar de novo). Mesmo molde da
--    rpc_aplicar_credito_fila: trava crédito e comanda, marca usado e recalcula o total.
-- 2) Compra mínima para usar o cashback: R$ 120 → sem mínimo (decisão do Cleiton 21/10).
--
-- Reversão: 20261021160000_cashback_aplicar_rpc.rollback.sql

CREATE OR REPLACE FUNCTION public.rpc_aplicar_credito_cliente(p_comanda uuid, p_credit uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_salon uuid;
  v_credit client_credits%ROWTYPE;
  v_comanda comandas%ROWTYPE;
  v_new_discount numeric;
BEGIN
  PERFORM set_config('app.via_rpc', '1', true);
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sem permissão para aplicar crédito';
  END IF;
  v_salon := get_user_salon_id(v_uid);

  -- Lock no crédito: duas comandas em corrida não usam o mesmo cashback.
  SELECT * INTO v_credit FROM client_credits
   WHERE id = p_credit AND salon_id = v_salon FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Crédito não encontrado'; END IF;
  IF v_credit.is_used THEN RAISE EXCEPTION 'Crédito já utilizado'; END IF;
  IF COALESCE(v_credit.is_expired, false) OR v_credit.expires_at < now() THEN
    RAISE EXCEPTION 'Crédito expirado';
  END IF;

  SELECT * INTO v_comanda FROM comandas WHERE id = p_comanda AND salon_id = v_salon FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comanda não encontrada'; END IF;
  IF v_comanda.closed_at IS NOT NULL THEN RAISE EXCEPTION 'Comanda já está fechada'; END IF;
  IF v_comanda.client_id IS DISTINCT FROM v_credit.client_id THEN
    RAISE EXCEPTION 'Este crédito é de outra cliente';
  END IF;
  IF NOT (fn_pode(v_uid, 'comanda.fechar_qualquer')
          OR (fn_pode(v_uid, 'comanda.fechar_propria') AND EXISTS (
                SELECT 1 FROM professionals p WHERE p.id = v_comanda.professional_id AND p.user_id = v_uid))) THEN
    RAISE EXCEPTION 'Sem permissão para aplicar crédito na comanda de outra profissional';
  END IF;
  IF COALESCE(v_comanda.subtotal, 0) < COALESCE(v_credit.min_purchase_amount, 0) THEN
    RAISE EXCEPTION 'Compra mínima de R$ % para usar este crédito', v_credit.min_purchase_amount;
  END IF;

  v_new_discount := COALESCE(v_comanda.discount, 0) + v_credit.credit_amount;

  UPDATE client_credits
     SET is_used = true, used_at = now(), used_in_comanda_id = p_comanda
   WHERE id = p_credit;
  UPDATE comandas
     SET discount = v_new_discount,
         total = GREATEST(0, COALESCE(subtotal, 0) - v_new_discount),
         updated_at = now()
   WHERE id = p_comanda;

  RETURN jsonb_build_object('ok', true, 'credit_amount', v_credit.credit_amount, 'new_discount', v_new_discount);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_aplicar_credito_cliente(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_aplicar_credito_cliente(uuid, uuid) TO authenticated, service_role;

UPDATE system_config SET value = '0' WHERE key = 'cashback_min_purchase';
