-- Rollback de 20261028170000: volta a versão anterior (quebrada) da função.
CREATE OR REPLACE FUNCTION public.clube_entrar_fila(p_celular text, p_otp text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_digits text := regexp_replace(COALESCE(p_celular, ''), '\D', '', 'g');
  v_otp clube_otp%ROWTYPE;
  v_ass clube_assinantes%ROWTYPE;
  v_salon uuid;
  v_comp text;
  v_cred clube_creditos%ROWTYPE;
  v_existing_id uuid;
  v_existing_pos int;
  v_client uuid;
  v_service uuid;
  v_pos int;
  v_entry_id uuid;
  v_token uuid;
BEGIN
  IF length(v_digits) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'celular_invalido');
  END IF;
  IF p_otp IS NULL OR length(trim(p_otp)) <> 6 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'otp_invalido');
  END IF;

  -- ── Prova de posse: OTP válido, não usado, não expirado, < 5 tentativas ──
  SELECT * INTO v_otp
    FROM clube_otp
   WHERE right(celular_digits, 8) = right(v_digits, 8)
     AND used = false
     AND expires_at > now()
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'otp_expirado');
  END IF;
  IF v_otp.attempts >= 5 THEN
    UPDATE clube_otp SET used = true WHERE id = v_otp.id;
    RETURN jsonb_build_object('ok', false, 'erro', 'otp_bloqueado');
  END IF;
  IF v_otp.code_hash <> encode(digest(trim(p_otp) || v_otp.id::text, 'sha256'), 'hex') THEN
    UPDATE clube_otp SET attempts = attempts + 1 WHERE id = v_otp.id;
    RETURN jsonb_build_object('ok', false, 'erro', 'otp_incorreto');
  END IF;
  UPDATE clube_otp SET used = true WHERE id = v_otp.id;

  -- ── Daqui pra baixo: mesma lógica de negócio da versão anterior ──────────
  SELECT * INTO v_ass
    FROM clube_assinantes
   WHERE status = 'ativo'
     AND right(regexp_replace(COALESCE(celular, ''), '\D', '', 'g'), 9) = right(v_digits, 9)
   ORDER BY updated_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    SELECT * INTO v_ass
      FROM clube_assinantes
     WHERE status = 'ativo'
       AND right(regexp_replace(COALESCE(celular, ''), '\D', '', 'g'), 8) = right(v_digits, 8)
     ORDER BY updated_at DESC
     LIMIT 1;
  END IF;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado');
  END IF;

  SELECT id INTO v_salon FROM salons ORDER BY created_at LIMIT 1;

  SELECT id, position INTO v_existing_id, v_existing_pos
    FROM queue_entries
   WHERE salon_id = v_salon
     AND status IN ('waiting', 'checked_in', 'in_service')
     AND right(regexp_replace(COALESCE(customer_phone, ''), '\D', '', 'g'), 8) = right(v_digits, 8)
   LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'ja_na_fila', 'position', v_existing_pos);
  END IF;

  -- 16/09/2026 (ciclo): crédito só nasce no webhook; aqui só procura o CICLO ATIVO (inicio <= agora < fim) e trava.
  select * into v_cred
    from clube_creditos
   where assinante_id = v_ass.id and not bloqueado and origem in ('asaas_pagamento','asaas_assinatura_backfill','legado_manual')
     and inicio <= now() and now() < fim and creditos_usados < creditos_total
   order by fim asc
   limit 1
   for update;
  if not found then
    select * into v_cred from clube_creditos
     where assinante_id = v_ass.id and not bloqueado and origem in ('asaas_pagamento','asaas_assinatura_backfill','legado_manual')
       and inicio <= now() and now() < fim
     order by fim asc limit 1;
    if found then
      return jsonb_build_object('ok', false, 'erro', 'teto_atingido',
        'usadas', v_cred.creditos_usados, 'total', v_cred.creditos_total, 'valido_ate', v_cred.fim);
    end if;
    return jsonb_build_object('ok', false, 'erro', 'sem_mensalidade', 'mensagem', 'Não há mensalidade confirmada do Clube válida para hoje. Faça a renovação no cartão antes de liberar a escova.');
  end if;

  SELECT id INTO v_client
    FROM clients
   WHERE salon_id = v_salon
     AND right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 8) = right(v_digits, 8)
   LIMIT 1;
  IF v_client IS NULL THEN
    INSERT INTO clients (salon_id, name, phone, email)
    VALUES (v_salon, COALESCE(v_ass.nome, 'Assinante Clube'), v_digits, v_ass.email)
    RETURNING id INTO v_client;
  END IF;

  SELECT id INTO v_service
    FROM services
   WHERE salon_id = v_salon AND is_active = true AND name ILIKE 'ESCOVA LISA%'
   ORDER BY price ASC
   LIMIT 1;

  SELECT COALESCE(MAX(position), 0) + 1 INTO v_pos
    FROM queue_entries
   WHERE salon_id = v_salon AND status IN ('waiting', 'checked_in', 'in_service');

  INSERT INTO queue_entries (
    salon_id, customer_id, customer_name, customer_phone, customer_email,
    service_id, source, position, notify_minutes_before,
    payment_status, payment_method, status
  ) VALUES (
    v_salon, v_client, COALESCE(v_ass.nome, 'Assinante Clube'), v_digits, v_ass.email,
    v_service, 'online', v_pos, 40,
    'credit', 'clube', 'waiting'
  ) RETURNING id, tracking_token INTO v_entry_id, v_token;

  update clube_creditos set creditos_usados = creditos_usados + 1 where id = v_cred.id;
  insert into clube_consumos (ciclo_id, assinante_id, queue_entry_id, origem) values (v_cred.id, v_ass.id, v_entry_id, 'fila');

  -- Devolve o TOKEN opaco (acompanhamento), não o id interno.
  RETURN jsonb_build_object('ok', true,
    'tracking_token', v_token, 'position', v_pos,
    'nome', v_ass.nome,
    'usadas', v_cred.creditos_usados + 1, 'total', v_cred.creditos_total, 'valido_ate', v_cred.fim);
END;
$function$

;
