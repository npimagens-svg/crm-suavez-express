-- Fila pública: serviço lançado pra outra profissional ocupa ELA (Cleiton 21/10, 12:55):
-- a Neide fazia o corte de pontas nas comandas da Wanessa e da Ana Carolina e a página
-- mostrava a Neide livre pra cabelo, porque só contava a dona da comanda.
-- 'minutos' passa a somar só os itens da dona; 'outras' lista as demais profissionais
-- da comanda com os minutos delas. Volta a regra de categoria de 18/10 (>= 5 itens):
-- a Neide faz cabelo (desfaz 20261021140000).

CREATE OR REPLACE FUNCTION public.fila_public_painel()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_salon uuid;
  v_agora timestamptz := now();
  v_local timestamp := now() AT TIME ZONE 'America/Sao_Paulo';
  v_dia_ini timestamptz := date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
  v_dow int := extract(dow FROM now() AT TIME ZONE 'America/Sao_Paulo')::int;
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  SELECT id INTO v_salon FROM salons ORDER BY created_at LIMIT 1;
  IF v_salon IS NULL THEN
    RETURN jsonb_build_object('agora', v_agora, 'comandas', '[]'::jsonb, 'aguardando', '[]'::jsonb, 'profissionais', '[]'::jsonb);
  END IF;

  RETURN (
    WITH profs AS (
      SELECT p.id, (row_number() OVER (ORDER BY p.created_at, p.id))::int AS idx
        FROM professionals p
       WHERE p.salon_id = v_salon AND p.is_active = true
    ),
    abertas AS (
      SELECT c.id, c.created_at, c.professional_id
        FROM comandas c
       WHERE c.salon_id = v_salon
         AND c.closed_at IS NULL
         AND c.created_at >= v_dia_ini
    ),
    itens AS (
      SELECT ci.comanda_id, s.name, s.category, COALESCE(s.duration_minutes, 45) * GREATEST(COALESCE(ci.quantity, 1), 1) AS minutos, ci.created_at,
             COALESCE(ci.professional_id, a.professional_id) AS prof_id,
             COALESCE(ci.professional_id, a.professional_id) IS NOT DISTINCT FROM a.professional_id AS da_dona
        FROM comanda_items ci
        JOIN abertas a ON a.id = ci.comanda_id
        JOIN services s ON s.id = ci.service_id
    )
    SELECT jsonb_build_object(
      'agora', v_agora,
      'comandas', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'profissional', pr.idx,
                 'aberta_em', a.created_at,
                 'minutos', COALESCE((SELECT SUM(i.minutos) FROM itens i WHERE i.comanda_id = a.id AND i.da_dona), 45),
                 -- itens lançados pra OUTRA profissional (ex.: corte da Neide na comanda da Wanessa) ocupam ela também
                 'outras', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object('profissional', o.idx, 'minutos', o.minutos))
                     FROM (SELECT p2.idx, SUM(i.minutos) AS minutos
                             FROM itens i JOIN profs p2 ON p2.id = i.prof_id
                            WHERE i.comanda_id = a.id AND NOT i.da_dona
                            GROUP BY p2.idx) o), '[]'::jsonb),
                 'servico', (SELECT i.name FROM itens i WHERE i.comanda_id = a.id ORDER BY i.created_at LIMIT 1),
                 'categoria', (SELECT i.category FROM itens i WHERE i.comanda_id = a.id ORDER BY i.created_at LIMIT 1))
               ORDER BY a.created_at)
          FROM abertas a
          LEFT JOIN profs pr ON pr.id = a.professional_id), '[]'::jsonb),
      'aguardando', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'criado_em', qe.created_at,
                 'chegou', qe.status = 'checked_in',
                 'minutos', svc.minutos,
                 'servico', svc.nome,
                 'categoria', svc.categoria)
               ORDER BY qe.position NULLS LAST, qe.created_at)
          FROM queue_entries qe
          CROSS JOIN LATERAL (
            SELECT COALESCE(SUM(COALESCE(s.duration_minutes, 45)), 45) AS minutos,
                   (array_agg(s.name ORDER BY s.name))[1] AS nome,
                   (array_agg(s.category ORDER BY s.name))[1] AS categoria
              FROM jsonb_array_elements_text(COALESCE(qe.service_ids, to_jsonb(ARRAY[qe.service_id::text]))) AS sid
              JOIN services s ON s.id = sid::uuid
          ) svc
         WHERE qe.salon_id = v_salon
           AND qe.status IN ('waiting', 'checked_in')
           AND public.fila_data_atendimento(v_salon, qe.created_at) = v_hoje), '[]'::jsonb),
      'profissionais', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', pr.idx,
                 'categorias', COALESCE((
                   SELECT jsonb_agg(x.category) FROM (
                     SELECT s.category
                       FROM comanda_items ci
                       JOIN comandas c ON c.id = ci.comanda_id
                       JOIN services s ON s.id = ci.service_id
                      WHERE COALESCE(ci.professional_id, c.professional_id) = pr.id
                        AND c.created_at >= v_agora - interval '60 days'
                        AND s.category IS NOT NULL
                      GROUP BY s.category
                     HAVING count(*) >= 5) x), '[]'::jsonb),
                 'presente', CASE
                   WHEN EXISTS (SELECT 1 FROM professional_work_schedules w WHERE w.professional_id = pr.id) THEN
                     EXISTS (SELECT 1 FROM professional_work_schedules w
                              WHERE w.professional_id = pr.id
                                AND v_local::time >= w.start_time AND v_local::time < w.end_time
                                AND CASE v_dow WHEN 0 THEN w.sunday WHEN 1 THEN w.monday WHEN 2 THEN w.tuesday
                                               WHEN 3 THEN w.wednesday WHEN 4 THEN w.thursday WHEN 5 THEN w.friday
                                               ELSE w.saturday END)
                   ELSE EXISTS (SELECT 1 FROM comandas c
                                 WHERE c.salon_id = v_salon AND c.professional_id = pr.id
                                   AND c.created_at >= v_dia_ini)
                 END)
               ORDER BY pr.idx)
          FROM profs pr), '[]'::jsonb)
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fila_public_painel() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fila_public_painel() TO anon, authenticated, service_role;
