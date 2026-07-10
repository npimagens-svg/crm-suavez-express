# Relatório de Migrations / Rollback — Sua Vez Express (10/07/2026)

> ⚠️ NENHUMA migration foi aplicada em produção. Tudo no working tree, aguardando autorização.
> Projeto correto: **ewxiaxsmohxuabcmxuyc** (Sua Vez Express). Todo comando com `--project-ref` explícito.

## Ordem de aplicação (aditiva, reversível)
| # | Arquivo | O que faz | Rollback |
|---|---------|-----------|----------|
| 1 | `20260710100000_salon_secrets_lockdown.sql` | Cria `salon_secrets` (deny-all), move segredos de `queue_settings` e limpa origem; `system_config` allowlist + escrita admin/financeiro; revoga `fila_creditos_fim_do_dia` de PUBLIC | Bloco comentado no fim do arquivo (copy-back + policies antigas) |
| 2 | `20260710100100_public_queue_rpcs.sql` | Colunas `tracking_token/paid_amount/intent_id`; **DROP** das policies anon de `queue_entries/queue_settings/salons/services`; RPCs `fila_public_bootstrap/minha_situacao/cancelar` | Recriar policies anon antigas + drop das 3 funções |
| 3 | `20260710100200_purchase_intents.sql` | Tabela `purchase_intents` + índices únicos (payment/intent/queue_entry/credit); colunas `provider_payment_id/voided*` em payments; RPC `fila_intent_status` | Drop tabela/índices/função |
| 4 | `20260710100300_rpcs_financeiras.sql` | `fn_role_financeiro`, `fn_card_fee_percent`; RPCs `rpc_fechar_comanda/reabrir_comanda/aplicar_credito_fila/fechar_caixa`; `apply_caixa_movement` v2; `fila_creditos_fim_do_dia` v2 (regra única) | Drop funções + restaurar `apply_caixa_movement` e `fila_creditos_fim_do_dia` das migrations antigas |
| 5 | `20260710100400_rls_papeis.sql` | RLS por papel (payments/caixas/financeiro/comissões/estoque/comandas); trigger `fn_guard_comanda_update` | Recriar policies "Users can..." originais + drop trigger |
| 6 | `20260710100500_clube_otp.sql` | Tabela `clube_otp`; **DROP** `clube_entrar_fila(text)` → `clube_entrar_fila(text,text)` com OTP | Drop tabela/função + recriar `clube_entrar_fila(text)` antiga |
| 7 | `20260710100600_webhook_rpcs.sql` | `webhook_pagamento_confirmado` (idempotente) e `webhook_pagamento_revertido` (reconciliação) | Drop das 2 funções |

Comando de aplicação (staging primeiro):
```
npx supabase db push --project-ref ewxiaxsmohxuabcmxuyc
```

## PRÉ-REQUISITOS antes de aplicar (senão quebra)
1. **Duplicatas históricas de `payment_id`** em `queue_entries` (verificado 10/07):
   `pay_vqgbmvamcx0282f7` (×7) e `pay_c83gzbk8ms3jz98r` (×2). O índice único da migração 3 é
   escopado a `created_at >= 2026-07-10` para não travar. Após limpar as antigas, trocar pelo
   índice pleno:
   ```sql
   -- limpar duplicatas antigas (manter a 1ª de cada), depois:
   DROP INDEX uq_queue_entries_payment_id;
   CREATE UNIQUE INDEX uq_queue_entries_payment_id ON queue_entries(payment_id) WHERE payment_id IS NOT NULL;
   ```
2. **Supabase Secrets** setados ANTES de aplicar/deployar (senão e-mail/webhook/checkout falham fechados — comportamento correto):
   `ASAAS_KEY`, `ASAAS_WEBHOOK_TOKEN`, `RESEND_API_KEY`, `EVOLUTION_KEY`, `CRON_SECRET`.
3. **salon_secrets**: a migração 1 já copia de `queue_settings`. Conferir que a linha do salão
   ficou preenchida antes de dropar qualquer coisa.
4. **pg_cron do e-mail**: se houver job chamando `email-cron`, incluir header `x-cron-secret`.

## Deploy das Edge Functions (com --project-ref)
```
npx supabase functions deploy asaas-checkout --no-verify-jwt --project-ref ewxiaxsmohxuabcmxuyc
npx supabase functions deploy asaas-webhook  --no-verify-jwt --project-ref ewxiaxsmohxuabcmxuyc
npx supabase functions deploy zapi-proxy     --no-verify-jwt --project-ref ewxiaxsmohxuabcmxuyc
npx supabase functions deploy asaas-proxy    --no-verify-jwt --project-ref ewxiaxsmohxuabcmxuyc
npx supabase functions deploy clube-otp      --no-verify-jwt --project-ref ewxiaxsmohxuabcmxuyc
npx supabase functions deploy send-email     --no-verify-jwt --project-ref ewxiaxsmohxuabcmxuyc
npx supabase functions deploy email-cron     --no-verify-jwt --project-ref ewxiaxsmohxuabcmxuyc
```

## Corte de deploy (front + functions + migrations JUNTOS)
A migração 2 remove o acesso anon direto às tabelas da fila. O front novo (RPCs) e as functions
novas precisam ir no MESMO deploy — senão a fila pública quebra. Sequência:
1. Secrets + pré-requisitos.
2. Migrations em staging → rodar `supabase/tests/provas_rls_rpc.sql` (deve passar sem exceção).
3. Migrations em produção.
4. Deploy das Edge Functions.
5. Deploy do front (Vercel) com o mesmo commit.
6. Rodar `scripts/prova-anon.mjs` contra produção → deve dar tudo ✅.
