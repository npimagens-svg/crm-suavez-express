-- ============================================================================
-- P0 PERMISSÕES (5/6): RLS por PAPEL nas tabelas financeiras.
-- Falha coberta: 19.
-- Regra (spec Cleiton): financeiro/admin são os únicos que ALTERAM caixa,
-- pagamento, comissão, crédito, dívida, transação e estoque. Profissional só
-- acessa o necessário ao próprio atendimento (comanda aberta + itens).
-- Leitura continua escopada por salão (o app precisa exibir estado), exceto
-- onde já foi restringido (system_config allowlist, salon_secrets deny-all).
-- Em prod hoje: 1 admin + 11 professional → nenhuma operação ativa quebra.
-- ============================================================================

-- ── payments: escrita só financeiro; DELETE proibido (estorno = void via RPC) ─
DROP POLICY IF EXISTS "Users can insert payments in their salon" ON public.payments;
DROP POLICY IF EXISTS "Users can update payments in their salon" ON public.payments;
DROP POLICY IF EXISTS "Users can delete payments in their salon" ON public.payments;
CREATE POLICY "payments_insert_financeiro" ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (salon_id = get_user_salon_id(auth.uid()) AND fn_role_financeiro(auth.uid()));
CREATE POLICY "payments_update_financeiro" ON public.payments
  FOR UPDATE TO authenticated
  USING (salon_id = get_user_salon_id(auth.uid()) AND fn_role_financeiro(auth.uid()));
-- (sem policy de DELETE = ninguém deleta pagamento pelo client; auditoria via voided)

-- ── caixas: escrita só financeiro ────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can insert caixas in their salon" ON public.caixas;
DROP POLICY IF EXISTS "Users can update caixas in their salon" ON public.caixas;
CREATE POLICY "caixas_insert_financeiro" ON public.caixas
  FOR INSERT TO authenticated
  WITH CHECK (salon_id = get_user_salon_id(auth.uid()) AND user_id = auth.uid()
              AND fn_role_financeiro(auth.uid()));
CREATE POLICY "caixas_update_financeiro" ON public.caixas
  FOR UPDATE TO authenticated
  USING (salon_id = get_user_salon_id(auth.uid()) AND fn_role_financeiro(auth.uid()));

-- ── caixa_movements: sangria/suprimento só financeiro ────────────────────────
DROP POLICY IF EXISTS "Users can insert caixa movements in their salon" ON public.caixa_movements;
CREATE POLICY "caixa_movements_insert_financeiro" ON public.caixa_movements
  FOR INSERT TO authenticated
  WITH CHECK (salon_id = get_user_salon_id(auth.uid()) AND fn_role_financeiro(auth.uid()));

-- ── financial_transactions: escrita só financeiro ────────────────────────────
DROP POLICY IF EXISTS "Users can insert transactions in their salon" ON public.financial_transactions;
DROP POLICY IF EXISTS "Users can update transactions in their salon" ON public.financial_transactions;
DROP POLICY IF EXISTS "Users can delete transactions in their salon" ON public.financial_transactions;
CREATE POLICY "fin_tx_insert_financeiro" ON public.financial_transactions
  FOR INSERT TO authenticated
  WITH CHECK (salon_id = get_user_salon_id(auth.uid()) AND fn_role_financeiro(auth.uid()));
CREATE POLICY "fin_tx_update_financeiro" ON public.financial_transactions
  FOR UPDATE TO authenticated
  USING (salon_id = get_user_salon_id(auth.uid()) AND fn_role_financeiro(auth.uid()));
CREATE POLICY "fin_tx_delete_financeiro" ON public.financial_transactions
  FOR DELETE TO authenticated
  USING (salon_id = get_user_salon_id(auth.uid()) AND fn_role_financeiro(auth.uid()));

-- ── créditos e dívidas: escrita só financeiro ────────────────────────────────
DROP POLICY IF EXISTS "Users can insert credits in their salon" ON public.client_credits;
DROP POLICY IF EXISTS "Users can update credits in their salon" ON public.client_credits;
CREATE POLICY "client_credits_insert_financeiro" ON public.client_credits
  FOR INSERT TO authenticated
  WITH CHECK (salon_id = get_user_salon_id(auth.uid()) AND fn_role_financeiro(auth.uid()));
CREATE POLICY "client_credits_update_financeiro" ON public.client_credits
  FOR UPDATE TO authenticated
  USING (salon_id = get_user_salon_id(auth.uid()) AND fn_role_financeiro(auth.uid()));

DROP POLICY IF EXISTS "Users can insert debts in their salon" ON public.client_debts;
DROP POLICY IF EXISTS "Users can update debts in their salon" ON public.client_debts;
DROP POLICY IF EXISTS "Users can delete debts in their salon" ON public.client_debts;
CREATE POLICY "client_debts_insert_financeiro" ON public.client_debts
  FOR INSERT TO authenticated
  WITH CHECK (salon_id = get_user_salon_id(auth.uid()) AND fn_role_financeiro(auth.uid()));
CREATE POLICY "client_debts_update_financeiro" ON public.client_debts
  FOR UPDATE TO authenticated
  USING (salon_id = get_user_salon_id(auth.uid()) AND fn_role_financeiro(auth.uid()));
CREATE POLICY "client_debts_delete_financeiro" ON public.client_debts
  FOR DELETE TO authenticated
  USING (salon_id = get_user_salon_id(auth.uid()) AND fn_role_financeiro(auth.uid()));

-- customer_credits (crédito da fila): a policy FOR ALL por salão vira
-- SELECT por salão + escrita só financeiro (uso normal é via RPC/cron).
DROP POLICY IF EXISTS "customer_credits_salon" ON public.customer_credits;
CREATE POLICY "customer_credits_select_salon" ON public.customer_credits
  FOR SELECT TO authenticated
  USING (salon_id IN (SELECT salon_id FROM profiles WHERE user_id = auth.uid()));
CREATE POLICY "customer_credits_write_financeiro" ON public.customer_credits
  FOR ALL TO authenticated
  USING (salon_id = get_user_salon_id(auth.uid()) AND fn_role_financeiro(auth.uid()))
  WITH CHECK (salon_id = get_user_salon_id(auth.uid()) AND fn_role_financeiro(auth.uid()));

-- ── comissões: escrita só financeiro ─────────────────────────────────────────
DROP POLICY IF EXISTS "Users can insert commissions in their salon" ON public.professional_service_commissions;
DROP POLICY IF EXISTS "Users can update commissions in their salon" ON public.professional_service_commissions;
DROP POLICY IF EXISTS "Users can delete commissions in their salon" ON public.professional_service_commissions;
CREATE POLICY "psc_insert_financeiro" ON public.professional_service_commissions
  FOR INSERT TO authenticated
  WITH CHECK (fn_role_financeiro(auth.uid()) AND EXISTS (
    SELECT 1 FROM professionals p WHERE p.id = professional_id
      AND p.salon_id = get_user_salon_id(auth.uid())));
CREATE POLICY "psc_update_financeiro" ON public.professional_service_commissions
  FOR UPDATE TO authenticated
  USING (fn_role_financeiro(auth.uid()) AND EXISTS (
    SELECT 1 FROM professionals p WHERE p.id = professional_id
      AND p.salon_id = get_user_salon_id(auth.uid())));
CREATE POLICY "psc_delete_financeiro" ON public.professional_service_commissions
  FOR DELETE TO authenticated
  USING (fn_role_financeiro(auth.uid()) AND EXISTS (
    SELECT 1 FROM professionals p WHERE p.id = professional_id
      AND p.salon_id = get_user_salon_id(auth.uid())));

-- commission_payments (nomes de policy vigentes em prod: view/insert/update/delete)
DROP POLICY IF EXISTS "insert commission_payments" ON public.commission_payments;
DROP POLICY IF EXISTS "update commission_payments" ON public.commission_payments;
DROP POLICY IF EXISTS "delete commission_payments" ON public.commission_payments;
CREATE POLICY "commission_payments_insert_financeiro" ON public.commission_payments
  FOR INSERT TO authenticated
  WITH CHECK (salon_id = get_user_salon_id(auth.uid()) AND fn_role_financeiro(auth.uid()));
CREATE POLICY "commission_payments_update_financeiro" ON public.commission_payments
  FOR UPDATE TO authenticated
  USING (salon_id = get_user_salon_id(auth.uid()) AND fn_role_financeiro(auth.uid()));
CREATE POLICY "commission_payments_delete_financeiro" ON public.commission_payments
  FOR DELETE TO authenticated
  USING (salon_id = get_user_salon_id(auth.uid()) AND fn_role_financeiro(auth.uid()));

-- ── estoque: movimentação só financeiro ──────────────────────────────────────
DROP POLICY IF EXISTS "Users can insert stock movements in their salon" ON public.stock_movements;
CREATE POLICY "stock_movements_insert_financeiro" ON public.stock_movements
  FOR INSERT TO authenticated
  WITH CHECK (salon_id = get_user_salon_id(auth.uid()) AND fn_role_financeiro(auth.uid()));

-- ── comandas: profissional não mexe em campo financeiro nem deleta ───────────
DROP POLICY IF EXISTS "Users can delete comandas in their salon" ON public.comandas;
CREATE POLICY "comandas_delete_financeiro" ON public.comandas
  FOR DELETE TO authenticated
  USING (salon_id = get_user_salon_id(auth.uid()) AND fn_role_financeiro(auth.uid()));

-- Trigger de guarda: usuário SEM papel financeiro (ex.: professional no
-- terminal) pode atualizar a comanda ABERTA (subtotal/total dos itens), mas
-- NÃO pode fechar/reabrir, mudar caixa, desconto ou marcar como paga.
CREATE OR REPLACE FUNCTION public.fn_guard_comanda_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  -- service_role / cron: auth.uid() é NULL → sem restrição
  IF v_uid IS NULL OR fn_role_financeiro(v_uid) THEN
    RETURN NEW;
  END IF;
  IF NEW.closed_at IS DISTINCT FROM OLD.closed_at
     OR NEW.is_paid IS DISTINCT FROM OLD.is_paid
     OR NEW.caixa_id IS DISTINCT FROM OLD.caixa_id
     OR NEW.discount IS DISTINCT FROM OLD.discount THEN
    RAISE EXCEPTION 'Apenas admin/financeiro pode alterar fechamento, caixa ou desconto da comanda';
  END IF;
  IF OLD.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Comanda fechada: apenas admin/financeiro pode alterá-la';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_comanda_update ON public.comandas;
CREATE TRIGGER trg_guard_comanda_update
  BEFORE UPDATE ON public.comandas
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_comanda_update();

-- comanda_items: profissional só mexe em item de comanda ABERTA
DROP POLICY IF EXISTS "Users can insert comanda items" ON public.comanda_items;
DROP POLICY IF EXISTS "Users can update comanda items" ON public.comanda_items;
DROP POLICY IF EXISTS "Users can delete comanda items" ON public.comanda_items;
CREATE POLICY "comanda_items_insert_staff" ON public.comanda_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM comandas c WHERE c.id = comanda_id
      AND c.salon_id = get_user_salon_id(auth.uid())
      AND (fn_role_financeiro(auth.uid()) OR c.closed_at IS NULL)));
CREATE POLICY "comanda_items_update_staff" ON public.comanda_items
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM comandas c WHERE c.id = comanda_id
      AND c.salon_id = get_user_salon_id(auth.uid())
      AND (fn_role_financeiro(auth.uid()) OR c.closed_at IS NULL)));
CREATE POLICY "comanda_items_delete_staff" ON public.comanda_items
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM comandas c WHERE c.id = comanda_id
      AND c.salon_id = get_user_salon_id(auth.uid())
      AND (fn_role_financeiro(auth.uid()) OR c.closed_at IS NULL)));

-- ============================================================================
-- ROLLBACK (manual): recriar as policies "Users can ..." originais
-- (src/lib/setupSchemaSQL.ts:749-786, 880-882 e 20260522210000) e
-- DROP TRIGGER trg_guard_comanda_update / FUNCTION fn_guard_comanda_update.
-- ============================================================================
