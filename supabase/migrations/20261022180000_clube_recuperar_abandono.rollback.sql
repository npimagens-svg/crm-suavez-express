-- Reverte 20261022180000_clube_recuperar_abandono.sql
SELECT cron.unschedule('clube-recuperar-abandono') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'clube-recuperar-abandono');
DROP FUNCTION IF EXISTS public.clube_recuperar_abandono();
ALTER TABLE public.clube_leads DROP COLUMN IF EXISTS recuperacao_enviada_em;

-- alerta_clube_lead volta a falar direto com a Evolution (como era até 22/10)
CREATE OR REPLACE FUNCTION public.alerta_clube_lead()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare r record; msg text; destinos text[] := array['5511976847114','5511973836456','5511993939085']; d text;
begin
  for r in select * from clube_leads where alertado = false order by created_at loop
    update clube_leads set alertado = true, alertado_em = now() where id = r.id and alertado = false;
    if not found then continue; end if;
    msg := '*LEAD DO CLUBE DA ESCOVA*' || chr(10) || chr(10) ||
           'Nome: ' || coalesce(r.nome,'-') || chr(10) ||
           'WhatsApp: ' || coalesce(r.whatsapp,'-') || chr(10) ||
           'E-mail: ' || coalesce(r.email,'-') || chr(10) ||
           'Plano: ' || coalesce(r.plano,'-') || chr(10) ||
           'Valor: R$ ' || coalesce(r.valor::text,'-') || chr(10) ||
           'Onde parou: ' || coalesce(r.origem,'-') || chr(10) || chr(10) ||
           'Ela escolheu o plano e nao concluiu o pagamento. Ligar hoje.';
    foreach d in array destinos loop
      perform net.http_post(
        url := 'http://72.60.6.168:8082/message/sendText/maia-express',
        headers := jsonb_build_object('Content-Type','application/json','apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'evolution_apikey')),
        body := jsonb_build_object('number', d, 'delay', 1200, 'text', msg),
        timeout_milliseconds := 30000
      );
    end loop;
  end loop;
end
$function$;
DROP FUNCTION IF EXISTS public.clube_enviar_whats(text, text);
