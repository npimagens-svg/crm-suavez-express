-- Sangrias e suprimentos do caixa.
-- Sangria = saída de dinheiro (motivo obrigatório, ex: pagar entregador, troco)
-- Suprimento = entrada extra (ex: troco trazido do banco)
-- Trigger ajusta total_<metodo> do caixa automaticamente.

CREATE TABLE IF NOT EXISTS public.caixa_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caixa_id uuid NOT NULL REFERENCES public.caixas(id) ON DELETE CASCADE,
  salon_id uuid NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  type text NOT NULL CHECK (type IN ('sangria','suprimento')),
  amount numeric NOT NULL CHECK (amount > 0),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  payment_method text NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','pix','credit_card','debit_card','other')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_caixa_movements_caixa ON public.caixa_movements(caixa_id);
CREATE INDEX IF NOT EXISTS idx_caixa_movements_salon ON public.caixa_movements(salon_id, created_at DESC);

ALTER TABLE public.caixa_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view caixa movements in their salon" ON public.caixa_movements;
CREATE POLICY "Users can view caixa movements in their salon"
  ON public.caixa_movements FOR SELECT TO authenticated
  USING (salon_id = get_user_salon_id(auth.uid()));

DROP POLICY IF EXISTS "Users can insert caixa movements in their salon" ON public.caixa_movements;
CREATE POLICY "Users can insert caixa movements in their salon"
  ON public.caixa_movements FOR INSERT TO authenticated
  WITH CHECK (salon_id = get_user_salon_id(auth.uid()));

CREATE OR REPLACE FUNCTION public.apply_caixa_movement()
RETURNS trigger LANGUAGE plpgsql AS $f$
DECLARE
  v_caixa public.caixas%ROWTYPE;
  v_delta numeric;
  v_col text;
BEGIN
  SELECT * INTO v_caixa FROM public.caixas WHERE id = NEW.caixa_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caixa nao encontrado';
  END IF;
  IF v_caixa.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Nao e possivel movimentar um caixa fechado';
  END IF;
  v_delta := CASE WHEN NEW.type = 'sangria' THEN -NEW.amount ELSE NEW.amount END;
  v_col := CASE NEW.payment_method
    WHEN 'cash' THEN 'total_cash'
    WHEN 'pix' THEN 'total_pix'
    WHEN 'credit_card' THEN 'total_credit_card'
    WHEN 'debit_card' THEN 'total_debit_card'
    ELSE 'total_other'
  END;
  EXECUTE format('UPDATE public.caixas SET %I = COALESCE(%I,0) + $1, updated_at = now() WHERE id = $2', v_col, v_col)
    USING v_delta, NEW.caixa_id;
  RETURN NEW;
END $f$;

DROP TRIGGER IF EXISTS trg_apply_caixa_movement ON public.caixa_movements;
CREATE TRIGGER trg_apply_caixa_movement
  AFTER INSERT ON public.caixa_movements
  FOR EACH ROW EXECUTE FUNCTION public.apply_caixa_movement();
