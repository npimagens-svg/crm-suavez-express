-- ====================================================================
-- Validação ao CRIAR comanda (BEFORE INSERT)
-- Bug real 26/05/2026: caixa de 23/05 não fechava porque 2 comandas
-- fantasmas (#252 ano 0006 e #259 mês 06/2026) ficaram penduradas
-- como órfãs. Vieram de Comandas.tsx (master pickando data manual)
-- com data inválida — front aceitou, banco aceitou, ninguém validou.
--
-- O trigger existente validate_comanda_close só dispara em UPDATE
-- de is_paid; não cobre INSERT. Esta migration adiciona a guarda.
-- ====================================================================

CREATE OR REPLACE FUNCTION validate_comanda_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.created_at IS NOT NULL
     AND (NEW.created_at < now() - interval '60 days'
          OR NEW.created_at > now() + interval '2 days') THEN
    RAISE EXCEPTION
      'Data invalida na comanda: % esta fora da faixa permitida (60 dias atras ate amanha). Verifique o campo Data da Comanda.',
      NEW.created_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_comanda_before_insert ON comandas;
CREATE TRIGGER validate_comanda_before_insert
  BEFORE INSERT ON comandas
  FOR EACH ROW
  EXECUTE FUNCTION validate_comanda_insert();
