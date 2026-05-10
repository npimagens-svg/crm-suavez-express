-- ====================================================================
-- Validação ao fechar comanda (BEFORE UPDATE is_paid -> true)
-- Cleiton pediu 10/05: "sistema não pode fechar comanda sem pagamento
-- nem com diferença entre total e itens".
--
-- Trigger é defense-in-depth: independe do caminho (UI ComandaModal,
-- closeComandaMutation, Edge Function, supabase-js direto). Sempre valida.
-- ====================================================================

CREATE OR REPLACE FUNCTION validate_comanda_close()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_items_sum numeric;
  v_payments_sum numeric;
  v_discount numeric;
BEGIN
  -- Apenas quando passa de "não paga" pra "paga"
  IF NEW.is_paid = true AND (OLD.is_paid IS DISTINCT FROM true) THEN

    -- 1) Comanda vazia: sem itens E total=0 → bloquear (caso real #129)
    SELECT COALESCE(SUM(total_price), 0) INTO v_items_sum
      FROM comanda_items WHERE comanda_id = NEW.id;

    IF v_items_sum = 0 AND COALESCE(NEW.total, 0) = 0 THEN
      RAISE EXCEPTION
        'Comanda #% nao pode ser fechada vazia. Adicione um serviço ou estorne.',
        NEW.comanda_number;
    END IF;

    -- 2) subtotal tem que bater com soma dos itens
    IF v_items_sum > 0 AND ABS(COALESCE(NEW.subtotal, NEW.total) - v_items_sum) > 0.01 THEN
      RAISE EXCEPTION
        'Comanda #%: subtotal R$ % nao bate com a soma dos itens R$ %. Recalcule.',
        NEW.comanda_number, COALESCE(NEW.subtotal, NEW.total), v_items_sum;
    END IF;

    -- 3) total tem que ser subtotal - discount (se houver)
    v_discount := COALESCE(NEW.discount, 0);
    IF NEW.subtotal IS NOT NULL
       AND ABS(NEW.total - (NEW.subtotal - v_discount)) > 0.01 THEN
      RAISE EXCEPTION
        'Comanda #%: total R$ % deveria ser R$ % (subtotal R$ % menos desconto R$ %).',
        NEW.comanda_number, NEW.total, (NEW.subtotal - v_discount),
        NEW.subtotal, v_discount;
    END IF;

    -- 4) total > 0 sem nenhum pagamento registrado → bloquear
    --    (excecao: total=0 já passou pelas validacoes acima — pode fechar)
    SELECT COALESCE(SUM(amount), 0) INTO v_payments_sum
      FROM payments WHERE comanda_id = NEW.id;

    IF NEW.total > 0 AND v_payments_sum = 0 THEN
      RAISE EXCEPTION
        'Comanda #%: total R$ % mas nenhum pagamento foi registrado. Registre dinheiro/PIX/cartao antes de fechar.',
        NEW.comanda_number, NEW.total;
    END IF;

  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_comanda_before_close ON comandas;
CREATE TRIGGER validate_comanda_before_close
  BEFORE UPDATE OF is_paid ON comandas
  FOR EACH ROW
  EXECUTE FUNCTION validate_comanda_close();
