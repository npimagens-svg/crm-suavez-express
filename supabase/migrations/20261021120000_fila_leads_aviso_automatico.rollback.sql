-- rollback de 20261021120000_fila_leads_aviso_automatico.sql (emailed fica: já existia antes)
DROP INDEX IF EXISTS public.idx_queue_leads_pendentes_dia;
DROP TRIGGER IF EXISTS trg_queue_leads_atendimento_em ON public.queue_leads;
DROP FUNCTION IF EXISTS public.queue_leads_set_atendimento_em();
ALTER TABLE public.queue_leads DROP COLUMN IF EXISTS notify_result;
ALTER TABLE public.queue_leads DROP COLUMN IF EXISTS notify_attempts;
ALTER TABLE public.queue_leads DROP COLUMN IF EXISTS notified_at;
ALTER TABLE public.queue_leads DROP COLUMN IF EXISTS atendimento_em;
