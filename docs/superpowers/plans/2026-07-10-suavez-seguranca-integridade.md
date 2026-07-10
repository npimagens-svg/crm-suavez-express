# SuaVez Express — Correção de Segurança, Integridade Financeira e Fila

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (execução inline nesta sessão). Checkboxes `- [ ]` para tracking.
> ⚠️ **NÃO COMMITAR, NÃO PUSH, NÃO DEPLOY, NÃO APLICAR MIGRATION EM PRODUÇÃO.** Tudo fica no working tree até autorização final do Cleiton.

**Goal:** Fechar as 21 falhas confirmadas (P0 segredos/RLS/funções públicas + P0 pagamento/fila/clube) no tenant Sua Vez Express, com migrations aditivas, Edge Functions fail-closed e RPCs transacionais.

**Architecture:** Segredos saem de `queue_settings`/`system_config` para tabela backend-only `salon_secrets` (+ Supabase Secrets por env). Fila pública deixa de tocar tabelas e passa a usar RPCs SECURITY DEFINER de escopo mínimo com `tracking_token` opaco. Pagamento ganha `purchase_intents` server-side com snapshot de valor e idempotência; o **webhook** (não o browser) cria a `queue_entry`. Operações financeiras viram RPCs transacionais com verificação de papel no banco.

**Tech Stack:** Vite/React/TS, Supabase (Postgres RLS + Edge Functions Deno), Asaas v3, vitest.

## Global Constraints (do spec do Cleiton)
- Trabalhar SOMENTE no tenant Sua Vez Express (`ewxiaxsmohxuabcmxuyc`, salon `9793948a-e208-4054-a4df-4b8f2b3b3965`). `supabase/config.toml` hoje aponta pro projeto ERRADO (`fzxpyslpykvqifmirezn` = Studio) — nenhum comando pode depender dele; todo comando supabase exige `--project-ref` explícito.
- Não ler/imprimir conteúdo de `.env`, chaves, CPF, telefone real.
- Não descartar mudanças existentes; migrations aditivas e reversíveis; sem fallback de segredo hardcoded (ausente ⇒ falha fechada).
- Autorização é no banco/backend; browser nunca define salon/preço/status/pagamento.
- service_role nunca no browser/localStorage/resposta de API.
- Enum papéis: `app_role = admin|manager|receptionist|financial|professional`; helpers `has_role(uid, role)` e `get_user_salon_id(uid)` já existem (setupSchemaSQL.ts:642-655).
- Enums fila: `queue_status(waiting|checked_in|in_service|completed|cancelled|no_show)`, `queue_payment_status(pending|confirmed|refunded|credit)`.

---

## Evidências (falha → arquivo:linha)
1. `queue_settings` segredos + anon read — `20260414_queue_tables.sql:52-64,101` · `usePublicQueue.ts:30-34 select("*")`
2. `queue_entries` anon read/insert TRUE — `20260414_queue_tables.sql:92-96`
3. `asaas-proxy` confia no browser (salonId/preço/cartão) — `supabase/functions/asaas-proxy/index.ts:18,92-119`
4. `zapi-proxy` msg arbitrária sem auth — `supabase/functions/zapi-proxy/index.ts:16`
5. send-email/email-cron sem JWT — `supabase/config.toml:9-13`
6. `system_config` R/W p/ qualquer autenticado — `setupSchemaSQL.ts:720-722`; webhook lê `resend_api_key` de lá (asaas-webhook:153)
7. `fila_creditos_fim_do_dia` SECURITY DEFINER sem REVOKE — `20260704200000:7-42`
8. Webhook: fallback `EvoStack2026Key!` (asaas-webhook:20) + token vazio ⇒ aceita (asaas-webhook:232 `if (expectedToken && ...)`)
9. `.env` rastreado; `.gitignore` sem env/pem/key
10. Entry criada por polling do browser — `FilaComprar.tsx:74-92`; webhook só faz update (asaas-webhook:267-274)
11. Sem unicidade payment_id/entry/intent
12. Fila usa preço atual de `services` — `Fila.tsx:209-219`, `fila_creditos:20`
13. Clube: só telefone/sufixo — `clube_entrar_fila(p_celular)` `20260704090000:6,33-55`
14. Refund/chargeback não reconcilia crédito/caixa/comanda — asaas-webhook:244-251 (só update status)
15. Crédito multi-serviço só 1º serviço — `fila_creditos:20 (s.price do service_id)`
16. Cron inclui `no_show` no crédito — `fila_creditos:25`
17. Reabrir comanda DELETA payments (inclusive asaas) — `useComandas.ts:309-313`
18. FAB lê `res.entryId`, hook retorna `data.id` — `IniciarAtendimentoFab.tsx:134` vs `useQueue.ts:114`
19. RLS financeira só por salon_id — `setupSchemaSQL.ts:749-786,880-882`
20. Corte 90 dias — `useComandas.ts:91-93`; rateio taxa — `Comissoes.tsx:160+`
21. `config.toml project_id = fzxpyslpykvqifmirezn` (Studio) — `supabase/config.toml:1`

⚠️ Repo ≠ prod: policies podem ter sido alteradas direto no banco (ex.: fila pública lê `salons`/`services` como anon e o repo só tem policies `TO authenticated`). Migrations usam `DROP POLICY IF EXISTS`/`IF NOT EXISTS` e as RPCs públicas fornecem salon/serviços por dentro (não dependem de anon read em tabela). Relatório final: auditar policies extras direto no banco.

---

## WS-A — Migrations (ordem de aplicação)

### A1 `20260710100000_salon_secrets_lockdown.sql`
- Cria `salon_secrets(salon_id pk→salons, asaas_api_key, zapi_instance_id, zapi_token, zapi_client_token, updated_at)`; RLS ON sem policy nenhuma + `REVOKE ALL FROM anon, authenticated` (só service_role).
- `ALTER TABLE queue_settings ADD COLUMN IF NOT EXISTS zapi_client_token text;` (defensivo) → copia segredos pra `salon_secrets` → **NULL** nas colunas de `queue_settings`.
- `system_config`: DROP nas 3 policies permissivas; SELECT/INSERT/UPDATE só `has_role(admin) OR has_role(financial)`.
- `REVOKE EXECUTE ON FUNCTION fila_creditos_fim_do_dia() FROM PUBLIC, anon, authenticated;`
- Rollback: comentado no fim (restore policies antigas + copy-back).

### A2 `20260710100100_public_queue_rpcs.sql`
- `ALTER TABLE queue_entries ADD COLUMN IF NOT EXISTS tracking_token uuid NOT NULL DEFAULT gen_random_uuid(), ADD COLUMN IF NOT EXISTS paid_amount numeric, ADD COLUMN IF NOT EXISTS intent_id uuid;`
- DROP policies `queue_entries_anon_read`, `queue_entries_anon_insert`, `queue_settings_anon_read` (mantém `queue_leads_anon_insert` — lead "avise-me", sem PII sensível além de nome/fone, fora do escopo pedido).
- RPCs SECURITY DEFINER (`SET search_path=public`, `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO anon, authenticated`):
  - `fila_public_bootstrap()` → jsonb `{salon_id, settings:{inflation_factor,credit_validity_days,notify_options}, services:[{id,name,price,duration_minutes}], stats:{total_in_queue, estimated_minutes, active_professionals}}` — zero PII, zero segredo.
  - `fila_minha_situacao(p_token uuid)` → própria entry: `{status, payment_status, position_ahead, service_names, estimated_minutes}`.
  - `fila_cancelar(p_token uuid)` → cancela se `waiting|checked_in`; retorna boolean. Token opaco = prova de posse.
  - `fila_intent_status(p_intent uuid)` → `{status, tracking_token}` (token só quando `queued`).

### A3 `20260710100200_purchase_intents.sql`
- `purchase_intents(id pk, salon_id, customer_name, customer_phone, customer_email, service_ids jsonb, description, total numeric, status pending|paid|queued|cancelled|refunded|chargeback, asaas_payment_id UNIQUE, asaas_customer_id, billing_type, idempotency_key UNIQUE, queue_entry_id UNIQUE→queue_entries, paid_at, created_at, updated_at)`; RLS: staff do salão SELECT; sem write client-side.
- Índices únicos: `queue_entries(payment_id) WHERE payment_id IS NOT NULL`; `queue_entries(intent_id) WHERE intent_id IS NOT NULL`; `customer_credits(origin_queue_entry_id) WHERE ... IS NOT NULL`.
- `payments`: ADD `provider_payment_id text`, `voided boolean default false`, `voided_at`, `voided_reason`; único parcial `(salon_id, provider_payment_id) WHERE provider_payment_id IS NOT NULL`.

### A4 `20260710100300_rpcs_financeiras.sql`
Todas SECURITY DEFINER + REVOKE PUBLIC/anon + GRANT authenticated + checagem interna de papel (`v_uid := auth.uid()`), transacionais por natureza (função = 1 tx):
- `rpc_aplicar_credito_fila(p_comanda, p_credit)` — `SELECT ... FOR UPDATE` no crédito; valida salão/não usado/não expirado; marca used + aplica discount + recalcula total. Papéis: admin|manager|financial|receptionist.
- `rpc_reabrir_comanda(p_comanda)` — papéis admin|financial. NÃO deleta payment de provedor: payments manuais → `voided=true` (+motivo); asaas → mantém intacto (continua abatendo). Subtrai do caixa só o voidado, registra `caixa_movements` (auditoria). Reabre comanda mantendo `caixa_id`.
- `rpc_fechar_caixa(p_caixa, p_closing_balance, p_notes)` — papéis admin|financial; valida server-side 0 comandas abertas.
- `fila_creditos_fim_do_dia()` v2 — regra única: crédito SÓ para `waiting|checked_in` pagos (no_show/cancelled NÃO geram); valor = `paid_amount` (snapshot) com fallback soma de `service_ids`; REVOKE de tudo exceto service role/pg_cron.

### A5 `20260710100400_rls_papeis.sql`
- Antes de escrever: `SELECT role, count(*) FROM user_roles` no banco (read-only) pra não travar usuário real.
- `caixas`/`payments`/`financial_transactions`/`customer_credits`/`client_credits`/`commission_settings`/`professional_service_commissions`: write = admin|financial (+manager/receptionist SÓ se existirem em prod em função operacional — decidir pelo dado). `professional`: nenhuma escrita nessas tabelas; SELECT limitado.
- `comanda_items`: professional pode CRUD apenas em comanda ABERTA do salão; trigger `guard_comanda_professional` impede professional de alterar `closed_at/is_paid/caixa_id/discount` em `comandas`.
- `stock_movements`: write sem professional.

### A6 `20260710100500_clube_otp.sql`
- `clube_otp(id, celular_digits, code_hash, expires_at, used, created_at)`; RLS deny-all (service role).
- `clube_entrar_fila(p_celular, p_otp)` v2: valida OTP (hash+expiração+uso único) e debita crédito com `FOR UPDATE` (sem corrida); DROP da assinatura antiga `clube_entrar_fila(text)` (revogada).
- Edge `clube-otp` gera/envia o código (WhatsApp server-side); sem segredo no client.

## WS-B — Edge Functions
- **B1 `asaas-checkout` (novo, substitui uso público do asaas-proxy):** body `{service_ids, name, phone, email, cpf, billing}`; servidor resolve salão (single-tenant via `salons limit 1`), valida serviços ativos `queue_enabled`, calcula total do banco, cria intent, cria customer+payment no Asaas com `externalReference=intent.id`; PIX → QR; cartão → `invoiceUrl` (checkout hospedado Asaas — cartão bruto NUNCA passa por nós). Idempotência via `idempotency_key`. `asaas-proxy` antigo reescrito para ser interno (JWT staff) só com `getPaymentStatus`; `createCardPayment` com cartão bruto REMOVIDO.
- **B2 `asaas-webhook`:** token fail-closed (`!expectedToken ⇒ 503/401`, sem processar); remove fallback `EvoStack2026Key!` (sem EVOLUTION_KEY ⇒ pula alerta, loga); `PAYMENT_CONFIRMED/RECEIVED` → upsert idempotente da `queue_entry` a partir do intent (position server-side, `paid_amount=payment.value`, `payment_status='confirmed'`) mesmo com retry/duplicata (constraints únicas + on conflict); refund/chargeback/cancel → reconcilia intent + entry (`refunded`/cancela se não atendida) + anula `customer_credits` não usados da entry + marca payments internos `voided` + alerta; `resend_api_key` só de env (sem system_config).
- **B3 `zapi-proxy`:** exige `Authorization: Bearer <JWT>` válido de membro do salão (`auth.getUser` + profile do salão); segredos de `salon_secrets`; sem auth ⇒ 401.
- **B4 `send-email` + `email-cron`:** exigem `x-cron-secret == CRON_SECRET` (env) OU JWT de staff; secret ausente ⇒ 503 fail-closed. `config.toml` continua `verify_jwt=false` (auth própria na função, pois cron não tem JWT).

## WS-C — Frontend
- **C1 `usePublicQueue.ts`:** reescrever sobre `fila_public_bootstrap()`/RPCs; remove `select("*")`, remove addToQueue público direto.
- **C2 `FilaComprar.tsx` + `AsaasCheckout.tsx` + `lib/asaas.ts`:** chama `asaas-checkout`; poll = `fila_intent_status(intent)`; confirmação exibe posição via `fila_minha_situacao(tracking_token)`; salva token no localStorage p/ acompanhar (`FilaAcompanhar.tsx` idem); cancelamento via `fila_cancelar(token)`.
- **C3 `IniciarAtendimentoFab.tsx:134`:** `(res as any)?.entryId` → `res?.id`.
- **C4 `useComandas.ts`:** query aceita `{from,to}` (default mês corrente) — sem teto fixo 90d; `reopenComanda` → `rpc_reabrir_comanda`.
- **C5 `ComandaModal.tsx`:** aplicar crédito → `rpc_aplicar_credito_fila` (fim do check-then-write).
- **C6 `Fila.tsx`:** valor de payment/caixa da entrada online = `entry.paid_amount` (snapshot confirmado); fallback catálogo só p/ walk-in sem pagamento.
- **C7 `Comissoes.tsx`:** rateio de taxa proporcional ao líquido atribuível com teto = taxa total paga; período server-side.
- **C8 `useCaixas.ts`:** fechar via `rpc_fechar_caixa`; `useQueueSettings`/`queueNotifications`: sem colunas de segredo; z-api via edge autenticada.

## WS-D — Engenharia
- `.gitignore` += `.env`, `.env.*`, `*.pem`, `*.key`; `git rm --cached .env` (arquivo local intacto, SEM abrir).
- `config.toml` → `project_id = "ewxiaxsmohxuabcmxuyc"` + comentário exigindo `--project-ref` explícito em deploys.
- `package.json`: script `typecheck: tsc --noEmit`; remover `@ts-nocheck` dos arquivos tocados nos fluxos críticos; lint dos tocados.
- Deps: `react-router-dom` e `@supabase/supabase-js` → última patch/minor compatível (sem `npm audit fix`).
- Lista de rotação POR NOME (inclui PAT embutido no remote `deploy` do git).

## WS-E — Validação
- vitest unit: rateio de taxa, regra de crédito (no_show/cancelled ⇒ 0; waiting pago ⇒ paid_amount), idempotência do webhook (módulo puro extraído), validação payload checkout.
- Suite SQL `supabase/tests/provas_rls.sql` + script `scripts/prova-anon.mjs` (usa env, sem chave hardcoded): anon não lê queue_settings/queue_entries/customer_credits/system_config; anon não insere entry paga; webhook sem token ⇒ falha; pagamento duplicado ⇒ 1 entry; corrida de crédito ⇒ 1 débito.
- Docker disponível ⇒ `supabase start` local + aplicar migrations + rodar provas. Sem Docker ⇒ provas prontas p/ staging + unit tests verdes.
- `npm run test` + `npm run typecheck` + lint tocados + `npm run build`.
- Relatório final: arquivos, falha→correção→prova, migrations NÃO aplicadas, rotação por nome, riscos manuais. **PARAR antes de commit/deploy/push.**

## Riscos conhecidos a reportar
- Policies extras aplicadas direto em prod (repo ≠ prod) — auditar antes de aplicar A2.
- Papéis reais em `user_roles` decidem a matriz RLS (conferir por SELECT read-only antes de A5).
- OTP do Clube depende de Z-API configurada; sem ela, entrada no clube pela página pública fica indisponível (recepção cobre) — risco operacional a validar com Cleiton.
- Corte de deploy: front novo + functions novas + migrations precisam ir juntos (checklist de deploy no relatório).
