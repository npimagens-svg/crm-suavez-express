-- 29/08/2026 — fila_creditos_fim_do_dia: entrada ONLINE paga que ficou 'in_service' (Atender clicado)
-- mas cujo pagamento Asaas NUNCA foi lançado em comanda = não atendida → também vira crédito.
-- Caso real: Tatiana Denti 15/08 (pay_dgeub1o3r35czjh9) — cron ignorou in_service, auto-arquivo
-- marcou 'completed' e o crédito de R$47 se perdeu.
CREATE OR REPLACE FUNCTION public.fila_creditos_fim_do_dia()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_qtd int := 0;
  r record;
BEGIN
  FOR r IN
    SELECT qe.id, qe.salon_id, qe.customer_id, qe.customer_phone,
           COALESCE(
             qe.paid_amount,
             (SELECT SUM(COALESCE(s.price, 0))
                FROM jsonb_array_elements_text(COALESCE(qe.service_ids, to_jsonb(ARRAY[qe.service_id::text]))) AS sid
                JOIN services s ON s.id = sid::uuid),
             0) AS valor,
           COALESCE(qs.credit_validity_days, 30) AS validade
      FROM queue_entries qe
      LEFT JOIN queue_settings qs ON qs.salon_id = qe.salon_id
     WHERE (qe.created_at AT TIME ZONE 'America/Sao_Paulo')::date = v_hoje
       AND qe.payment_status = 'confirmed'
       AND (
             qe.status IN ('waiting', 'checked_in')   -- regra única: no_show/cancelled NÃO
             OR (
               -- 29/08: 'in_service' sem o pagamento online lançado em comanda = não foi atendida
               qe.status = 'in_service'
               AND qe.source = 'online'
               AND qe.payment_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM payments p
                                WHERE p.provider_payment_id = qe.payment_id AND NOT p.voided)
             )
           )
       AND NOT EXISTS (SELECT 1 FROM customer_credits cc WHERE cc.origin_queue_entry_id = qe.id)
  LOOP
    INSERT INTO customer_credits (salon_id, customer_id, customer_phone, amount,
                                  origin_queue_entry_id, expires_at, used)
    VALUES (r.salon_id, r.customer_id, r.customer_phone, r.valor,
            r.id, now() + make_interval(days => r.validade), false)
    ON CONFLICT DO NOTHING;

    UPDATE queue_entries
       SET status = 'no_show', payment_status = 'credit', updated_at = now()
     WHERE id = r.id;

    v_qtd := v_qtd + 1;
  END LOOP;

  RETURN jsonb_build_object('dia', v_hoje, 'creditos_gerados', v_qtd);
END;
$function$;
