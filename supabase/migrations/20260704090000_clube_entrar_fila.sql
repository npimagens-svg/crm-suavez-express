-- Fila "Sou do Clube": assinante do Clube da Escova entra na fila digital sem pagar,
-- identificada pelo celular. Valida assinatura ativa + teto do mês (clube_creditos)
-- e desconta 1 escova ao entrar. RLS das tabelas clube_* segue fechada (0 policies);
-- o front (anon) só acessa por esta RPC.

create or replace function public.clube_entrar_fila(p_celular text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_digits text := regexp_replace(coalesce(p_celular, ''), '\D', '', 'g');
  v_ass clube_assinantes%rowtype;
  v_salon uuid;
  v_comp text;
  v_cred clube_creditos%rowtype;
  v_existing_id uuid;
  v_existing_pos int;
  v_client uuid;
  v_service uuid;
  v_pos int;
  v_entry_id uuid;
begin
  if length(v_digits) < 8 then
    return jsonb_build_object('ok', false, 'erro', 'celular_invalido');
  end if;

  -- match pelos últimos 9 dígitos (tolera DDD/55/9 extra); fallback 8 dígitos
  select * into v_ass
    from clube_assinantes
   where status = 'ativo'
     and right(regexp_replace(coalesce(celular, ''), '\D', '', 'g'), 9) = right(v_digits, 9)
   order by updated_at desc
   limit 1;
  if not found then
    select * into v_ass
      from clube_assinantes
     where status = 'ativo'
       and right(regexp_replace(coalesce(celular, ''), '\D', '', 'g'), 8) = right(v_digits, 8)
     order by updated_at desc
     limit 1;
  end if;
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'nao_encontrado');
  end if;

  select id into v_salon from salons limit 1;

  -- já está na fila ativa?
  select id, position into v_existing_id, v_existing_pos
    from queue_entries
   where salon_id = v_salon
     and status in ('waiting', 'checked_in', 'in_service')
     and right(regexp_replace(coalesce(customer_phone, ''), '\D', '', 'g'), 8) = right(v_digits, 8)
   limit 1;
  if v_existing_id is not null then
    return jsonb_build_object('ok', false, 'erro', 'ja_na_fila',
      'entry_id', v_existing_id, 'position', v_existing_pos);
  end if;

  -- créditos da competência atual (assinatura ativa garante o mês, mesmo antes do webhook)
  v_comp := to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM');
  insert into clube_creditos (assinante_id, competencia, creditos_total, creditos_usados)
  values (v_ass.id, v_comp, coalesce(v_ass.teto_mensal, 4), 0)
  on conflict (assinante_id, competencia) do nothing;

  select * into v_cred
    from clube_creditos
   where assinante_id = v_ass.id and competencia = v_comp
   for update;
  if v_cred.creditos_usados >= v_cred.creditos_total then
    return jsonb_build_object('ok', false, 'erro', 'teto_atingido',
      'usadas', v_cred.creditos_usados, 'total', v_cred.creditos_total);
  end if;

  -- cliente do CRM (acha pelo telefone ou cria)
  select id into v_client
    from clients
   where salon_id = v_salon
     and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 8) = right(v_digits, 8)
   limit 1;
  if v_client is null then
    insert into clients (salon_id, name, phone, email)
    values (v_salon, coalesce(v_ass.nome, 'Assinante Clube'), v_digits, v_ass.email)
    returning id into v_client;
  end if;

  -- escova do Clube = ESCOVA LISA (modelada é +R$10 na comanda)
  select id into v_service
    from services
   where salon_id = v_salon and is_active = true and name ilike 'ESCOVA LISA%'
   order by price asc
   limit 1;

  select coalesce(max(position), 0) + 1 into v_pos
    from queue_entries
   where salon_id = v_salon and status in ('waiting', 'checked_in', 'in_service');

  insert into queue_entries (
    salon_id, customer_id, customer_name, customer_phone, customer_email,
    service_id, source, position, notify_minutes_before,
    payment_status, payment_method, status
  ) values (
    v_salon, v_client, coalesce(v_ass.nome, 'Assinante Clube'), v_digits, v_ass.email,
    v_service, 'online', v_pos, 40,
    'credit', 'clube', 'waiting'
  ) returning id into v_entry_id;

  update clube_creditos
     set creditos_usados = creditos_usados + 1
   where assinante_id = v_ass.id and competencia = v_comp;

  return jsonb_build_object('ok', true,
    'entry_id', v_entry_id, 'position', v_pos,
    'nome', v_ass.nome,
    'usadas', v_cred.creditos_usados + 1, 'total', v_cred.creditos_total);
end;
$$;

revoke all on function public.clube_entrar_fila(text) from public;
grant execute on function public.clube_entrar_fila(text) to anon, authenticated, service_role;
