-- Trava do formulário público (revisão de segurança 21/10): o insert anônimo não controla
-- os campos do aviso automático. O trigger força estado inicial, data de criação e limites.
CREATE OR REPLACE FUNCTION public.queue_leads_set_atendimento_em()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.created_at      := now();
  NEW.notified        := false;
  NEW.notified_at     := NULL;
  NEW.notify_result   := NULL;
  NEW.notify_attempts := 0;
  NEW.emailed         := false;
  NEW.name            := left(btrim(coalesce(NEW.name, '')), 60);
  NEW.phone           := left(btrim(coalesce(NEW.phone, '')), 20);
  NEW.max_queue_size  := least(greatest(coalesce(NEW.max_queue_size, 3), 1), 5);
  NEW.atendimento_em  := public.fila_data_atendimento(NEW.salon_id, NEW.created_at);
  RETURN NEW;
END;
$$;
