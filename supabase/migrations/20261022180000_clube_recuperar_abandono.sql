-- Clube da Escova: mensagem de carrinho abandonado pela Maia (Cleiton 22/10)
--
-- Lead que escolheu o plano no checkout (clube_leads) e não virou assinante em 15 min recebe
-- UMA mensagem no WhatsApp pela Maia (Evolution maia-express): finalizando até amanhã, a 1ª
-- visita ganha uma hidratação. O asaas-webhook olha recuperacao_enviada_em (3 dias) pra marcar
-- o presente no aviso de nova assinatura.
-- Regras: só 8h–21h de São Paulo (lead da noite recebe de manhã, janela de 12 h); 1 mensagem
-- por telefone a cada 30 dias; quem já é assinante (celular ou e-mail) não recebe.
-- O agendamento (pg_cron) entra só depois do ok do Cleiton no texto.
--
-- 22/10 TAMBÉM: o banco não alcança mais a VPS (pg_net dá timeout em toda porta de
-- 72.60.6.168; tcpdump na VPS não vê pacote). O alerta de lead pro Cleiton/Max/Vanessa
-- (alerta_clube_lead) estava falhando calado (provado: lead das 17h34 = 3 timeouts).
-- Os dois envios passam pela edge clube-whats (que alcança a Evolution) via clube_enviar_whats.
--
-- Reversão: 20261022180000_clube_recuperar_abandono.rollback.sql

ALTER TABLE public.clube_leads ADD COLUMN IF NOT EXISTS recuperacao_enviada_em timestamptz;

CREATE OR REPLACE FUNCTION public.clube_enviar_whats(p_number text, p_text text)
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select net.http_post(
    url := 'https://ewxiaxsmohxuabcmxuyc.supabase.co/functions/v1/clube-whats',
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'x-queue-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'queue_cron_secret')),
    body := jsonb_build_object('number', p_number, 'text', p_text),
    timeout_milliseconds := 30000
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.clube_enviar_whats(text, text) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.alerta_clube_lead()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare r record; msg text; destinos text[] := array['5511976847114','5511973836456','5511993939085']; d text;
begin
  for r in select * from clube_leads where alertado = false order by created_at loop
    -- marca ANTES de enviar (evita duplicar se dois ticks concorrerem); envio com timeout folgado
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
      perform clube_enviar_whats(d, msg);
    end loop;
  end loop;
end
$function$;

CREATE OR REPLACE FUNCTION public.clube_recuperar_abandono()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record; v_tel text; v_oito text; v_nome text; msg text; n int := 0;
  v_hora int := extract(hour from now() at time zone 'America/Sao_Paulo');
begin
  if v_hora < 8 or v_hora >= 21 then return 0; end if;

  for r in select * from clube_leads
            where recuperacao_enviada_em is null
              and created_at <= now() - interval '15 minutes'
              and created_at >= now() - interval '12 hours'
            order by created_at loop
    v_tel := regexp_replace(coalesce(r.whatsapp, ''), '\D', '', 'g');
    if length(v_tel) in (12, 13) and v_tel like '55%' then v_tel := substr(v_tel, 3); end if;
    if length(v_tel) not in (10, 11) then continue; end if;
    v_oito := right(v_tel, 8);

    -- já assinou (o checkout grava o lead antes do cartão)
    if exists (select 1 from clube_assinantes a
                where a.status <> 'cancelado'
                  and (right(regexp_replace(coalesce(a.celular, ''), '\D', '', 'g'), 8) = v_oito
                       or (nullif(trim(r.email), '') is not null and lower(trim(a.email)) = lower(trim(r.email))))) then
      continue;
    end if;

    -- 1 mensagem por telefone a cada 30 dias (tentou 2x = 1 mensagem)
    if exists (select 1 from clube_leads l
                where l.recuperacao_enviada_em > now() - interval '30 days'
                  and right(regexp_replace(coalesce(l.whatsapp, ''), '\D', '', 'g'), 8) = v_oito) then
      continue;
    end if;

    -- marca ANTES de enviar (dois ticks concorrentes não duplicam)
    update clube_leads set recuperacao_enviada_em = now() where id = r.id and recuperacao_enviada_em is null;
    if not found then continue; end if;

    v_nome := initcap(split_part(trim(coalesce(r.nome, '')), ' ', 1));
    msg := 'Oi' || case when v_nome <> '' then ', ' || v_nome else '' end || '! Aqui é a Maia, do NP Hair Express 🧡' || chr(10) || chr(10) ||
           'Vi que você começou a assinatura do Clube da Escova e não chegou a finalizar. Ficou alguma dúvida ou deu algum problema no pagamento?' || chr(10) || chr(10) ||
           'Finalizando até amanhã, sua primeira visita ganha uma *hidratação de presente* 🎁' || chr(10) || chr(10) ||
           'É só terminar por aqui: https://www.nphairexpress.com.br/clube/' || chr(10) || chr(10) ||
           'Se preferir, me responde aqui que eu te ajudo.';

    perform clube_enviar_whats('55' || v_tel, msg);
    n := n + 1;
  end loop;
  return n;
end
$function$;

REVOKE EXECUTE ON FUNCTION public.clube_recuperar_abandono() FROM public, anon, authenticated;
