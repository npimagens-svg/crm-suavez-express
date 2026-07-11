-- ============================================================================
-- CATÁLOGO POR COMPRIMENTO (11/07/2026)
-- Fim dos adicionais de escova: cada serviço passa a ter preço final explícito
-- (CURTO/MÉDIO × LONGO). A fila pública ganha ordenação estável (sort_order),
-- categoria e descrição no payload. O Clube passa a escolher a escova pelo
-- plano da assinante (4x/8x LONGO → ESCOVA LISA - LONGO).
-- Os dados (renomes, novas variantes LONGO, cópia de comissões, curadoria da
-- fila) são aplicados por script de dados — esta migration só muda DDL/RPCs.
-- ============================================================================

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 500;

-- ── fila_public_bootstrap: + category/description, ordem por sort_order ─────
CREATE OR REPLACE FUNCTION public.fila_public_bootstrap()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_salon uuid;
  v_profs int;
  v_total_min numeric;
  v_count int;
BEGIN
  SELECT id INTO v_salon FROM salons ORDER BY created_at LIMIT 1;
  IF v_salon IS NULL THEN
    RETURN jsonb_build_object('salon_id', NULL);
  END IF;

  SELECT count(*)::int INTO v_profs
    FROM professionals WHERE salon_id = v_salon AND is_active = true;
  IF v_profs = 0 THEN v_profs := 1; END IF;

  SELECT count(*)::int,
         COALESCE(SUM(entry_min.total), 0)
    INTO v_count, v_total_min
    FROM queue_entries qe
    CROSS JOIN LATERAL (
      SELECT COALESCE(
               (SELECT SUM(COALESCE(s.duration_minutes, 45))
                  FROM jsonb_array_elements_text(COALESCE(qe.service_ids, to_jsonb(ARRAY[qe.service_id::text]))) AS sid
                  JOIN services s ON s.id = sid::uuid),
               45) AS total
    ) entry_min
   WHERE qe.salon_id = v_salon
     AND qe.status IN ('waiting', 'checked_in');

  RETURN jsonb_build_object(
    'salon_id', v_salon,
    'settings', (SELECT jsonb_build_object(
                   'inflation_factor', inflation_factor,
                   'credit_validity_days', credit_validity_days,
                   'notify_options', notify_options)
                   FROM queue_settings WHERE salon_id = v_salon),
    'services', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                   'id', id, 'name', name, 'price', price,
                   'duration_minutes', duration_minutes,
                   'category', category, 'description', description)
                   ORDER BY sort_order, price, name)
                   FROM services
                  WHERE salon_id = v_salon AND is_active = true AND queue_enabled = true), '[]'::jsonb),
    'stats', jsonb_build_object(
      'total_in_queue', v_count,
      'estimated_minutes', CEIL(v_total_min / v_profs),
      'active_professionals', v_profs)
  );
END;
$$;

-- ── clube_entrar_fila: escova escolhida pelo PLANO da assinante ──────────────
CREATE OR REPLACE FUNCTION public.clube_entrar_fila(p_celular text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- escova do Clube pelo PLANO: 4x_longo/8x_longo → ESCOVA LISA - LONGO;
  -- demais planos → variante curto/médio (menor preço). Fallback: qualquer
  -- ESCOVA LISA ativa (catálogo antigo), mais barata primeiro.
  select id into v_service
    from services
   where salon_id = v_salon and is_active = true
     and name ilike 'ESCOVA LISA%'
     and (case when coalesce(v_ass.plano, '') ilike '%longo%'
               then name ilike '%LONGO'
               else name not ilike '%LONGO' end)
   order by price asc
   limit 1;
  if v_service is null then
    select id into v_service
      from services
     where salon_id = v_salon and is_active = true and name ilike 'ESCOVA LISA%'
     order by price asc
     limit 1;
  end if;

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
