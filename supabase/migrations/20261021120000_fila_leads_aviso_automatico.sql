-- Leads "me avisa quando a fila diminuir" com aviso AUTOMÁTICO (pedido do Cleiton 20/10).
-- Antes: a página prometia o aviso, mas só ia um e-mail pro dono; o botão Notificar da
-- recepção sempre "falhava" (front esperava messageId que o zapi-proxy não devolve).
--
-- 1. emailed: já existia em produção sem migration (criada direto em 15/08) → formaliza.
-- 2. atendimento_em: dia em que o lead vale (fila_data_atendimento: pedido depois do
--    fechamento vale pra próxima abertura). A aba mostra só os de hoje; o resto expira sozinho.
-- 3. notified_at / notify_attempts / notify_result: o queue-cron avisa 1 vez, até 3 tentativas,
--    e registra o que houve (enviado | manual | ja_na_fila | duplicado | telefone_invalido).

ALTER TABLE public.queue_leads ADD COLUMN IF NOT EXISTS emailed boolean NOT NULL DEFAULT false;
ALTER TABLE public.queue_leads ADD COLUMN IF NOT EXISTS atendimento_em date;
ALTER TABLE public.queue_leads ADD COLUMN IF NOT EXISTS notified_at timestamptz;
ALTER TABLE public.queue_leads ADD COLUMN IF NOT EXISTS notify_attempts int NOT NULL DEFAULT 0;
ALTER TABLE public.queue_leads ADD COLUMN IF NOT EXISTS notify_result text;

CREATE OR REPLACE FUNCTION public.queue_leads_set_atendimento_em()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.atendimento_em := public.fila_data_atendimento(NEW.salon_id, COALESCE(NEW.created_at, now()));
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.queue_leads_set_atendimento_em() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_queue_leads_atendimento_em ON public.queue_leads;
CREATE TRIGGER trg_queue_leads_atendimento_em
  BEFORE INSERT ON public.queue_leads
  FOR EACH ROW EXECUTE FUNCTION public.queue_leads_set_atendimento_em();

-- Leads antigos: calcula o dia (já passaram, então nenhum volta a ser avisado).
UPDATE public.queue_leads
   SET atendimento_em = public.fila_data_atendimento(salon_id, created_at)
 WHERE atendimento_em IS NULL;

CREATE INDEX IF NOT EXISTS idx_queue_leads_pendentes_dia
  ON public.queue_leads (salon_id, atendimento_em)
  WHERE notified = false;
