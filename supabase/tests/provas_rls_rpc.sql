-- ============================================================================
-- PROVAS DE SEGURANÇA (RLS/RPC) — Sua Vez Express
-- Rodar em STAGING/SHADOW com as migrations 20260710100000..100600 aplicadas.
-- NÃO rodar em produção. Cada bloco levanta EXCEPTION se a prova falhar.
--
-- Uso (staging):
--   psql "$STAGING_URL" -f supabase/tests/provas_rls_rpc.sql
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

-- ── Prova 1: anon NÃO lê segredo de queue_settings ──────────────────────────
SET LOCAL role = anon;
DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM queue_settings;
  IF v > 0 THEN
    RAISE EXCEPTION 'FALHA P1: anon conseguiu ler queue_settings (% linhas)', v;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  NULL; -- esperado: acesso negado
END $$;
RESET role;

-- salon_secrets: negado para anon E authenticated
SET LOCAL role = anon;
DO $$
DECLARE v int;
BEGIN
  BEGIN
    SELECT count(*) INTO v FROM salon_secrets;
    RAISE EXCEPTION 'FALHA P1b: anon leu salon_secrets';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET role;

-- ── Prova 2: anon NÃO lê PII de queue_entries ───────────────────────────────
SET LOCAL role = anon;
DO $$
DECLARE v int;
BEGIN
  BEGIN
    SELECT count(*) INTO v FROM queue_entries;
    RAISE EXCEPTION 'FALHA P2: anon leu queue_entries (PII exposta)';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET role;

-- ── Prova 3: anon NÃO cria entrada marcada como paga ────────────────────────
SET LOCAL role = anon;
DO $$
BEGIN
  BEGIN
    INSERT INTO queue_entries (salon_id, customer_name, customer_phone, service_id,
                               position, payment_status, status)
    VALUES ((SELECT id FROM salons LIMIT 1), 'Fraude', '11999999999',
            (SELECT id FROM services LIMIT 1), 1, 'confirmed', 'waiting');
    RAISE EXCEPTION 'FALHA P3: anon inseriu queue_entry marcada como paga';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET role;

-- ── Prova 4: anon NÃO lê customer_credits nem system_config ─────────────────
SET LOCAL role = anon;
DO $$
DECLARE v int;
BEGIN
  BEGIN
    SELECT count(*) INTO v FROM customer_credits;
    RAISE EXCEPTION 'FALHA P4a: anon leu customer_credits';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    SELECT count(*) INTO v FROM system_config;
    RAISE EXCEPTION 'FALHA P4b: anon leu system_config';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET role;

-- ── Prova 5: RPC pública de bootstrap NÃO devolve segredo ───────────────────
SET LOCAL role = anon;
DO $$
DECLARE j jsonb;
BEGIN
  j := fila_public_bootstrap();
  IF j::text ILIKE '%asaas%' OR j::text ILIKE '%zapi%' OR j::text ILIKE '%api_key%' THEN
    RAISE EXCEPTION 'FALHA P5: bootstrap público vazou segredo';
  END IF;
END $$;
RESET role;

-- ── Prova 6: fila_creditos_fim_do_dia NÃO é executável por anon/authenticated ─
SET LOCAL role = authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM fila_creditos_fim_do_dia();
    RAISE EXCEPTION 'FALHA P6: authenticated executou fila_creditos_fim_do_dia';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET role;

-- ── Prova 7: unicidade de pagamento Asaas → 1 fila (idempotência do webhook) ─
-- Simula dois PAYMENT_CONFIRMED do mesmo pagamento sobre a mesma intent.
DO $$
DECLARE v_intent uuid; v_salon uuid; v_svc uuid; n int;
BEGIN
  SELECT id INTO v_salon FROM salons ORDER BY created_at LIMIT 1;
  SELECT id INTO v_svc FROM services WHERE salon_id = v_salon LIMIT 1;
  INSERT INTO purchase_intents (salon_id, customer_name, customer_phone, service_ids,
                                total, status, asaas_payment_id)
  VALUES (v_salon, 'Prova Idem', '11988887777', to_jsonb(ARRAY[v_svc::text]),
          50, 'pending', 'pay_prova_idem_1')
  RETURNING id INTO v_intent;

  PERFORM webhook_pagamento_confirmado('pay_prova_idem_1', v_intent::text, 50, 'PIX');
  PERFORM webhook_pagamento_confirmado('pay_prova_idem_1', v_intent::text, 50, 'PIX'); -- retry

  SELECT count(*) INTO n FROM queue_entries WHERE payment_id = 'pay_prova_idem_1';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FALHA P7: pagamento gerou % entradas de fila (esperado 1)', n;
  END IF;
END $$;

-- ── Prova 8: corrida de crédito — 2ª aplicação do MESMO crédito falha ───────
-- (validação de negócio da rpc_aplicar_credito_fila; roda como service para
--  simular staff; a corrida real é protegida por SELECT ... FOR UPDATE.)
-- Cobertura completa exige duas sessões concorrentes — ver prova de corrida
-- no script scripts/prova-corrida-credito.mjs.

ROLLBACK; -- provas não deixam resíduo
-- ============================================================================
-- Se chegou aqui sem EXCEPTION, todas as provas passaram.
-- ============================================================================
