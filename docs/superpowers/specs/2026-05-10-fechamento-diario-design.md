# Fechamento Diário NP Hair Express — Design

**Data:** 2026-05-10
**Autor:** Cleiton + Claude
**Status:** Em revisão

## Contexto

Hoje o Cleiton concilia o salão NP Hair Express manualmente uma vez por mês,
extraindo PDFs do sistema, do PagBank e cruzando linha a linha. Esse processo
demora horas e detecta erros (lançamento errado de forma de pagamento,
comanda em aberto, lançamento duplicado pra inflar comissão) só no fechamento
mensal — quando já é tarde pra cobrar correção.

A API EDI do PagBank foi liberada em 10/05/2026 (estabelecimento `119232542`,
token salvo em `reference_pagbank_edi.md`) e abre a possibilidade de
auditoria diária automática D-1.

## Objetivo

Construir um pipeline diário automático que:

1. Às 7h (BR, ter-sáb), gera relatório do dia anterior cruzando Supabase Sua
   Vez Express ↔ PagBank EDI
2. Envia relatório no WhatsApp pra Vanessa (gestora) com cópia pro Cleiton
3. Persiste pendências detectadas em tabela própria, exibidas em tela
   `/pendencias` do sistema
4. Permite Cleiton/Vanessa solicitar correção pra profissional via mensagem
   pré-preenchida (decisão manual, não automática)
5. Permite gerar fechamento mensal por profissional (PDF estilo Avec) com 1
   clique no sistema

## Não-objetivo

- Corrigir comandas automaticamente no banco (equipe que ajusta no sistema)
- Disparar mensagem pra profissional sem aprovação humana
- Substituir o painel atual de comandas/pagamentos
- Atender o NP Hair Studio (banco diferente, fluxo diferente — fica fora)
- Calcular folha de pagamento / DRE (escopo de outro projeto)

## Constraints

- ❌ **Não pode mexer no Jarbas** (porta 5678, container `n8n`, Evolution
  v1.8.7) — blindagem do CLAUDE.md
- ❌ **Não pode push direto** em `nphairexpress/suavezexpress` — Vercel Hobby
  pode quebrar. Workflow é: push em `origin/main` (npimagens-svg) + Sync Fork
  via API GitHub
- ✅ N8N novo workflow vai em `n8n-agentes` (porta 5679, VPS 72.60.6.168)
- ✅ Envio WhatsApp via Evolution `claudebot` (porta 8080, instância
  administrativa) — não usa Z-API da Vivi (separação de canais)
- ✅ Token PagBank EDI fica em N8N Credentials (Header Auth), nunca em código
- ✅ Tudo auto-hospedado exceto banco do salão (Supabase Cloud — sem
  alternativa, é onde os dados estão)

## Arquitetura

```
┌─────────────────────────────────────────────────────────┐
│  Edge Function `daily-report` (Supabase)                │
│  POST /functions/v1/daily-report                        │
│  Body: { date: "YYYY-MM-DD" }                           │
│        OU { start: "YYYY-MM-DD", end: "YYYY-MM-DD" }    │
│                                                         │
│  Lê:  payments, comandas, comanda_items, services,      │
│       professionals, clients, queue_entries,            │
│       customer_credits                                  │
│  Lê PagBank EDI:                                        │
│       GET /movement/v3.00/transactional/{date}          │
│  Calcula 15 KPIs + detecta 9 tipos de divergência       │
│  Persiste:  daily_reports + closure_issues              │
│  Retorna:   { kpis, issues, markdown, html }            │
└─────────────────────────────────────────────────────────┘
       ↑                ↑                   ↑
       │                │                   │
  ┌────┴────┐    ┌──────┴───────┐    ┌──────┴─────────┐
  │ Cron N8N│    │ Frontend     │    │ Comando admin  │
  │ 07h     │    │ /fechamentos │    │ #fechamento    │
  │ ter-sáb │    │ /pendencias  │    │  DD/MM         │
  └────┬────┘    └──────────────┘    └──────┬─────────┘
       │                                    │
       ↓                                    ↓
  Evolution claudebot (porta 8080) → Vanessa + Cleiton
```

**Decisão chave: por que Edge Function (Supabase) e não Code Node (N8N)?**

A pergunta crítica do Cleiton durante o brainstorming foi: "como vou gerar
fechamento mensal por profissional no sistema?". Isso significa que o cálculo
de KPIs precisa ser chamado de **dois lugares**:

1. Cron N8N diário (1 dia)
2. Botão do sistema (mês inteiro, opcionalmente filtrado por profissional)

Se o cálculo morar no N8N, o frontend precisa duplicar a lógica em TS/React
— duas fontes da verdade, divergem. Edge Function elimina isso: cron e
sistema chamam o mesmo endpoint, varia só o range de data.

## Componentes

### 1. Edge Function `daily-report`

**Caminho:** `supabase/functions/daily-report/index.ts`

**Inputs:**
- `{ date: "YYYY-MM-DD" }` — fechamento de 1 dia (uso do cron)
- `{ start: "YYYY-MM-DD", end: "YYYY-MM-DD", professional_id?: uuid }` —
  range arbitrário (uso do botão mensal)

**Output JSON:**
```ts
{
  period: { start: string, end: string, days: number },
  kpis: {
    revenue: { gross, net, expected_from_pagbank },
    bookings: { count, average_ticket },
    by_professional: Array<{ id, name, revenue, count, top_service }>,
    top_services: Array<{ id, name, count, revenue }>,
    payment_mix: { credit, debit, pix, cash, percentages },
    real_card_fee: { total, by_brand },
    new_vs_returning: { new_count, returning_count, new_revenue },
    cashback: { credited, redeemed, balance_change },
    towels: { count, cost },
    queue_unattended: { count, list },
    seven_day_average: { revenue, bookings, ticket }
  },
  issues: Array<ClosureIssue>,
  comparisons: { vs_yesterday, vs_7d_avg, vs_same_weekday },
  markdown: string,  // pronto pro WhatsApp
  html: string       // pronto pra tela
}
```

**Idempotência:** UPSERT em `daily_reports` por `(salon_id, report_date)`.
Rodar 10x o mesmo dia gera mesmo resultado, atualiza `updated_at`.

### 2. Tabelas novas no Supabase

```sql
-- Relatório consolidado por dia
CREATE TABLE daily_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES salons(id),
  report_date date NOT NULL,
  kpis jsonb NOT NULL,                -- snapshot completo dos 15 KPIs
  pagbank_raw jsonb,                  -- resposta crua da API EDI (auditável)
  generated_at timestamptz DEFAULT now(),
  generated_by text DEFAULT 'cron',   -- 'cron' | 'manual' | 'admin_command'
  generated_by_user_id uuid REFERENCES profiles(id),
  UNIQUE (salon_id, report_date)
);

-- Pendências detectadas no fechamento
CREATE TABLE closure_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES salons(id),
  comanda_id uuid REFERENCES comandas(id),
  professional_id uuid REFERENCES professionals(id),
  detected_date date NOT NULL,
  issue_type text NOT NULL,           -- enum (9 tipos abaixo)
  severity text NOT NULL,             -- 'high' | 'medium' | 'low'
  description text NOT NULL,
  expected_value jsonb,
  actual_value jsonb,
  status text NOT NULL DEFAULT 'open',
  -- 'open' | 'in_correction' | 'auto_resolved'
  -- | 'marked_resolved' | 'resolved' | 'reopened' | 'ignored'
  detected_at timestamptz DEFAULT now(),
  resolved_at timestamptz,
  ignored_reason text,
  ignored_by uuid REFERENCES profiles(id)
);

-- Histórico de ações (quem questionou, resolveu, ignorou)
CREATE TABLE closure_issue_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL REFERENCES closure_issues(id) ON DELETE CASCADE,
  action text NOT NULL,
  -- 'requested_correction' | 'reminded' | 'marked_resolved'
  -- | 'auto_resolved' | 'reopened' | 'ignored'
  user_id uuid REFERENCES profiles(id),
  message text,                       -- mensagem enviada à profissional
  whatsapp_message_id text,           -- id do Evolution pra rastrear
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_closure_issues_status ON closure_issues(salon_id, status, detected_date);
CREATE INDEX idx_closure_issues_comanda ON closure_issues(comanda_id);
CREATE INDEX idx_daily_reports_date ON daily_reports(salon_id, report_date DESC);
```

**RLS:** mesmas policies dos outros recursos do salão — leitura/escrita só
pra `profiles.user_id = auth.uid()` com `salon_id` correspondente. Service
role bypass pra Edge Function.

### 3. Páginas novas no frontend (`/Users/pc/nphairexpress`)

#### `/fechamentos` — Lista de relatórios diários

```
┌─────────────────────────────────────────────────────────┐
│  📊 Fechamentos                  [Gerar Mensal ▾]      │
├─────────────────────────────────────────────────────────┤
│  📅 Maio/2026                              R$ 8.420    │
│                                                         │
│  ✅ 09/05 sáb   23 atend  R$ 1.840  Ticket 80          │
│  ✅ 08/05 sex   18 atend  R$ 1.420  Ticket 79          │
│  ⚠️ 07/05 qui   15 atend  R$ 1.180  ← 1 alerta         │
│                                                         │
│  [filtros: período / status]                            │
└─────────────────────────────────────────────────────────┘
```

- Linha clicável → modal com KPIs completos do dia (renderiza `html` do
  Edge Function)
- Botão "Reenviar WhatsApp" (admin only)
- Botão "Gerar Mensal" → modal com mês/ano + profissional (Todas / específica)
  → chama Edge Function com range → gera PDF via `react-pdf`

#### `/pendencias` — Lista de divergências

```
┌──────────────────────────────────────────────────────────┐
│  ⚠️ Pendências de Fechamento              [3 abertas]   │
├──────────────────────────────────────────────────────────┤
│  🔴 09/05 · Comanda #75 · Andreia de Jesus              │
│  Tipo: Forma de pagamento divergente                    │
│  Sistema: Dinheiro R$ 64,00                             │
│  PagBank: Débito MasterCard R$ 63,37                    │
│  Profissional: Marcilene Zanette                        │
│  [💬 Solicitar correção] [✅ Marcar resolvido] [🚫 Ignorar] │
│  ─────────────────────────────────────                  │
│  ...                                                    │
│                                                         │
│  [filtros: período / profissional / tipo / status]      │
│  [Resolvidas (12)] [Ignoradas (3)]                      │
└──────────────────────────────────────────────────────────┘
```

- Acesso restrito a admin (Cleiton + Vanessa)
- Botão "Solicitar correção" abre modal com mensagem pré-preenchida (editável)
  e dispara Evolution claudebot pra DM da profissional
- Status `in_correction` quando mensagem foi enviada
- Trigger PG `recheck_closure_issues_on_change`: dispara em
  `AFTER UPDATE OF total, is_paid ON comandas` e
  `AFTER INSERT OR UPDATE OR DELETE ON payments`. Procura
  `closure_issues` `open` ou `in_correction` desse `comanda_id` e re-avalia o
  predicado original — se passa a bater, marca `auto_resolved` (não toca em
  `resolved`/`ignored`)
- Próximo cron 7h revalida — se ainda bate, vira `resolved`. Se desbate, volta
  pra `reopened` 🚨

### 4. Workflow N8N "FECHAMENTO DIÁRIO NP HAIR EXPRESS"

**N8N porta 5679, container `n8n-agentes`**

**Triggers:**
- Schedule Trigger: `0 7 * * 2-6` em `America/Sao_Paulo` (ter-sáb)
- Webhook: `/webhook/fechamento` — recebe `#fechamento DD/MM` da Vivi
  (admin command branch)

**Pipeline (10 nodes):**
```
Schedule/Webhook
  → Calcula data alvo (ontem em America/Sao_Paulo)
  → HTTP POST Edge Function `daily-report`
  → IF status=200?
     [false → HTTP Evolution → SÓ Cleiton com erro técnico]
     [true ↓]
  → Code: extrai `markdown` do response
  → HTTP Evolution claudebot → Vanessa (5511993939085)
  → HTTP Evolution claudebot → Cleiton (5511976847114, cópia)
  → Code: log de sucesso (timestamp + checksums)
```

**Tratamento de erro:**
- Edge Function falhou (timeout, 5xx) → manda só pro Cleiton com stack trace
- Vanessa não recebe relatório quebrado
- Retry: 3 tentativas com backoff (5min, 10min, 15min) antes de reportar erro

### 5. Comando admin `#fechamento DD/MM`

Reusa o **branch admin que já existe na Vivi** (P8). Adicionar no
`Processa Comando` da Vivi:
- Detecta regex `^#fechamento (\d{2}\/\d{2}(?:\/\d{4})?)$`
- Aceita `DD/MM` (ano corrente) OU `DD/MM/YYYY` (explícito)
- POST webhook N8N `/webhook/fechamento` com `{ date: "YYYY-MM-DD" }`
- Resposta admin: "🔄 Reprocessando fechamento de DD/MM/YYYY..."
- N8N dispara fluxo normal (Edge Function + envio pros 2 números)

## Fluxo de dados

### Caminho A: Cron diário (caminho feliz)
1. 07h ter-sáb → N8N Schedule Trigger dispara
2. N8N calcula `ontem` em `America/Sao_Paulo`
3. POST Edge Function com `{ date: ontem }`
4. Edge Function: lê PagBank EDI + Supabase, calcula, persiste, retorna
5. N8N envia `markdown` pra Vanessa via Evolution claudebot
6. N8N envia cópia pro Cleiton via Evolution claudebot
7. Vanessa abre `/pendencias` se houver alertas

### Caminho B: Botão fechamento mensal
1. Cleiton clica "Gerar Mensal" em `/fechamentos`
2. Modal: seleciona mês/ano + profissional
3. Frontend chama Edge Function com `{ start, end, professional_id? }`
4. Edge Function calcula range completo (não persiste — é só consulta)
5. Frontend renderiza PDF via `react-pdf` e oferece download/print

### Caminho C: Detecção de "resolvido" (estratégia híbrida)
1. Profissional edita comanda no sistema
2. Trigger PG `recheck_closure_issues_on_change` (em
   `AFTER UPDATE OF total, is_paid ON comandas` e
   `AFTER INSERT OR UPDATE OR DELETE ON payments`) re-avalia o predicado
   original da issue. Se passa a bater → `auto_resolved`. Não toca em
   `resolved`/`ignored`
3. Próximo cron 7h roda Edge Function que revalida:
   - Pendências `auto_resolved`/`marked_resolved` que continuam batendo →
     `resolved` (verde definitivo)
   - Pendências resolvidas que voltaram a divergir → `reopened` 🚨

## 9 tipos de divergência detectados

| Tipo | Severidade | Detecção | Ex. real |
|---|---|---|---|
| `payment_method_mismatch` | 🔴 high | Σ payments por método ≠ PagBank por método | Andreia 02/05 (Dinheiro→Débito) |
| `value_mismatch` | 🔴 high | comandas.total ≠ Σ comanda_items.total_price | — |
| `comanda_open_24h` | 🟡 medium | now() - created_at > 24h AND is_paid=false | comanda esquecida |
| `professional_missing` | 🟡 medium | comandas.professional_id IS NULL | erro de cadastro |
| `duplicate_service_same_client` | 🔵 low | mesma comanda com >2x mesmo serviço | Mariana 04/04 (esmaltação dupla) |
| `paid_without_payment` | 🔴 high | is_paid=true AND NOT EXISTS payments | inconsistência |
| `payment_without_paid_flag` | 🟡 medium | EXISTS payments AND is_paid=false | flag desatualizada |
| `pagbank_orphan_transaction` | 🔴 high | PagBank tem transação que sistema não tem | venda fantasma |
| `cashback_overdraft` | 🟡 medium | customer_credits.balance < 0 | resgate maior que saldo |

## Backfill inicial

Não é feature recorrente — é script ad-hoc rodado **uma vez** pelo Claude
Code (no laptop do Cleiton) depois que Edge Function + tabelas estiverem
publicadas. Sequência:

1. Query no Supabase pra descobrir dias úteis com movimento em Maio:
   ```sql
   SELECT DISTINCT (closed_at AT TIME ZONE 'America/Sao_Paulo')::date AS d
   FROM comandas
   WHERE salon_id = '9793948a-e208-4054-a4df-4b8f2b3b3965'
     AND closed_at >= '2026-05-01'
     AND closed_at <  CURRENT_DATE
   ORDER BY d;
   ```
2. Loop: pra cada data retornada, `curl POST /functions/v1/daily-report`
   com `{ date: "YYYY-MM-DD" }` (rate-limit 1/seg pra não atropelar PagBank
   EDI)
3. Cleiton abre `/fechamentos` no sistema e revisa cada dia
4. Se algum dia parecer errado → Cleiton aponta, Claude Code corrige Edge
   Function, repete passo 2 (idempotência cobre isso)
5. Cleiton aprova → ativa workflow N8N (cron começa terça 12/05 às 7h)

Datas prováveis em Maio/2026: 02, 05, 06, 07, 08, 09/05 (Express fecha
dom/seg, e 01/05 foi feriado do trabalho). 10/05 é o dia atual (domingo
fechado), então não entra no backfill.

## Plano de testes

### Edge Function (deno test)
- ✅ KPIs com dataset fictício pequeno (10 comandas)
- ✅ Idempotência: rodar 2x mesmo dia → mesmo resultado
- ✅ Detecção de cada tipo de divergência (9 fixtures)
- ✅ Backfill: range de 7 dias retorna agregação correta
- ✅ Edge cases: dia sem movimento, dia 100% PIX, dia com 1 transação só
- ✅ PagBank API down → função retorna parcial com flag `pagbank_unavailable`

### Frontend (Playwright)
- ✅ `/fechamentos` lista relatórios em ordem decrescente
- ✅ Click em linha abre modal com detalhes
- ✅ Botão "Gerar Mensal" gera PDF baixável
- ✅ `/pendencias` carrega só `status=open` por padrão
- ✅ Botão "Solicitar correção" preenche modal e envia
- ✅ Acesso negado pra perfil não-admin

### N8N (manual + executions log)
- ✅ Trigger manual com data de ontem → mensagem chega pros 2 números
- ✅ Edge Function fora → só Cleiton recebe alerta de erro
- ✅ Webhook `/webhook/fechamento` reprocessa data específica

### E2E (manual)
- ✅ Backfill de 02/05 a 09/05 — Cleiton revisa cada um
- ✅ Cron desligado → liga 12/05 → confirma envio às 7h
- ✅ Comando `#fechamento 09/05` enviado pra Vivi reprocessa

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Token PagBank expira/é revogado | Edge Function detecta 401 → retorna `pagbank_unavailable: true`, relatório vai sem cruzamento. Cleiton avisado |
| WhatsApp banir o número de novo | Já temos guard anti-fake na Vivi; Evolution claudebot é canal separado, baixo volume (2 msgs/dia) |
| Edge Function timeout em fechamento mensal grande | Limite Supabase 150s. Mês inteiro deve rodar em <10s. Se crescer, implementa streaming/paginação |
| Profissional ajusta comanda mas trigger não detecta resolução | Cron de 7h revalida e marca `auto_resolved` na próxima rodada |
| Mudança de schema do PagBank EDI | Versionamento `v3.00` na URL — quebra é detectada por validação de schema antes do parse |
| Cleiton/Vanessa esquecem de ver `/pendencias` | Relatório das 7h já lista pendências abertas com link direto |

## Métricas de sucesso

- ✅ Backfill de 02/05–09/05 sem intervenção manual depois de aprovado
- ✅ Cron rodando 7 dias seguidos com 100% de envio (mensagem nos 2 números)
- ✅ Detecção do caso real Andreia 02/05 (e qualquer outro caso similar)
- ✅ Fechamento mensal de Maio gerado em <30s via botão (vs ~3h manual)
- ✅ Tempo de detecção de erro: D+1 (vs ~30 dias hoje)

## Out of scope (V2)

- Análise narrativa do dia via Claude (humanização do relatório)
- Comparação com benchmark de mercado por bairro
- Forecast de faturamento da semana baseado em histórico
- Envio pra grupo do salão (decidido manter DM por enquanto)
- Auto-correção de comandas (sempre manual pela equipe)
- Integração com NP Hair Studio (banco diferente)
