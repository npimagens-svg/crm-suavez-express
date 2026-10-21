-- rollback de 20261021130000_fila_leads_trava_anon.sql: volta à versão de 20261021120000
CREATE OR REPLACE FUNCTION public.queue_leads_set_atendimento_em()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.atendimento_em := public.fila_data_atendimento(NEW.salon_id, COALESCE(NEW.created_at, now()));
  RETURN NEW;
END;
$$;
