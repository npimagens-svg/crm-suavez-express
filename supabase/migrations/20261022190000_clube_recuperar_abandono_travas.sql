-- Travas na mensagem de carrinho abandonado (revisão de segurança 22/10, antes de ligar o cron):
-- clube-lead é público (só honeypot + dedup 6 h), então: nome só letras (até 20), só celular BR
-- e no máximo 10 mensagens/dia. Reversão: reaplicar a função de 20261022180000_clube_recuperar_abandono.sql.

CREATE OR REPLACE FUNCTION public.clube_recuperar_abandono()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record; v_tel text; v_oito text; v_nome text; msg text; n int := 0; v_cota int;
  v_hora int := extract(hour from now() at time zone 'America/Sao_Paulo');
begin
  if v_hora < 8 or v_hora >= 21 then return 0; end if;
  -- teto diário: clube-lead é público; flood de números falsos não vira spam pela Maia (volume real ~12/mês)
  v_cota := 10 - (select count(*) from clube_leads
                   where recuperacao_enviada_em >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo');
  if v_cota <= 0 then return 0; end if;

  for r in select * from clube_leads
            where recuperacao_enviada_em is null
              and created_at <= now() - interval '15 minutes'
              and created_at >= now() - interval '12 hours'
            order by created_at loop
    v_tel := regexp_replace(coalesce(r.whatsapp, ''), '\D', '', 'g');
    if length(v_tel) in (12, 13) and v_tel like '55%' then v_tel := substr(v_tel, 3); end if;
    -- só celular BR (DDD + 9 + 8 dígitos)
    if length(v_tel) <> 11 or substr(v_tel, 3, 1) <> '9' then continue; end if;
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

    -- nome vem do formulário público: só letras, até 20 (nada de link/texto injetado na mensagem da Maia)
    v_nome := initcap(left(regexp_replace(split_part(trim(coalesce(r.nome, '')), ' ', 1), '[^[:alpha:]]', '', 'g'), 20));
    msg := 'Oi' || case when v_nome <> '' then ', ' || v_nome else '' end || '! Aqui é a Maia, do NP Hair Express 🧡' || chr(10) || chr(10) ||
           'Vi que você começou a assinatura do Clube da Escova e não chegou a finalizar. Ficou alguma dúvida ou deu algum problema no pagamento?' || chr(10) || chr(10) ||
           'Finalizando até amanhã, sua primeira visita ganha uma *hidratação de presente* 🎁' || chr(10) || chr(10) ||
           'É só terminar por aqui: https://www.nphairexpress.com.br/clube/' || chr(10) || chr(10) ||
           'Se preferir, me responde aqui que eu te ajudo.';

    perform clube_enviar_whats('55' || v_tel, msg);
    n := n + 1;
    if n >= v_cota then exit; end if;
  end loop;
  return n;
end
$function$;

REVOKE EXECUTE ON FUNCTION public.clube_recuperar_abandono() FROM public, anon, authenticated;
