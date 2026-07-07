-- Rotina diária (pedido do Cleiton 04/07): cliente que PAGOU pela fila e NÃO foi
-- atendida no dia vira crédito de 30 dias no fim do dia. Depois de expirar, paga de novo.
-- Cobre o caso Elizangela: pagamento confirmado sem atendimento não pode evaporar.

create extension if not exists pg_cron;

create or replace function public.fila_creditos_fim_do_dia()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_qtd int := 0;
  r record;
begin
  for r in
    select qe.id, qe.salon_id, qe.customer_id, qe.customer_phone, qe.customer_name,
           coalesce(s.price, 0) as valor
      from queue_entries qe
      left join services s on s.id = qe.service_id
     where (qe.created_at at time zone 'America/Sao_Paulo')::date = v_hoje
       and qe.payment_status = 'confirmed'          -- pagou de verdade
       and qe.status in ('waiting', 'checked_in', 'no_show', 'cancelled')  -- não foi atendida
       and not exists (select 1 from customer_credits cc where cc.origin_queue_entry_id = qe.id)
  loop
    insert into customer_credits (salon_id, customer_id, customer_phone, amount,
                                  origin_queue_entry_id, expires_at, used)
    values (r.salon_id, r.customer_id, r.customer_phone, r.valor,
            r.id, now() + interval '30 days', false);

    update queue_entries
       set status = 'no_show', payment_status = 'credit', updated_at = now()
     where id = r.id;

    v_qtd := v_qtd + 1;
  end loop;

  return jsonb_build_object('dia', v_hoje, 'creditos_gerados', v_qtd);
end;
$$;

-- roda todo dia 23:35 BRT (02:35 UTC), depois do fechamento
select cron.schedule(
  'fila-creditos-fim-do-dia',
  '35 2 * * *',
  $$select public.fila_creditos_fim_do_dia()$$
);
