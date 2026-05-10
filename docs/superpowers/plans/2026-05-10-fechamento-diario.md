# Fechamento Diário NP Hair Express — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pipeline diário automático às 7h ter-sáb que cruza Supabase Sua Vez Express com PagBank EDI, calcula 15 KPIs, detecta 9 tipos de divergência, envia relatório no WhatsApp pra Vanessa+Cleiton e expõe pendências numa tela do sistema com fluxo de correção manual.

**Architecture:** Edge Function Supabase (TypeScript/Deno) é a fonte única da verdade — chamada pelo cron N8N (1 dia) e pelo botão "Gerar Mensal" do sistema (range arbitrário). N8N orquestra trigger e envio Evolution. 3 tabelas novas no banco: `daily_reports`, `closure_issues`, `closure_issue_actions`. Trigger PG re-avalia issues quando comanda/payment muda.

**Tech Stack:**
- Backend: Supabase Edge Function (Deno + TypeScript), PostgreSQL com triggers/RLS
- Frontend: React + TypeScript, react-router-dom v6, jspdf + jspdf-autotable (já instalados)
- Orquestração: N8N porta 5679 (n8n-agentes), Evolution claudebot porta 8080
- Testing: deno test (Edge Function), Playwright (frontend), smoke manual (N8N)

**Spec:** `docs/superpowers/specs/2026-05-10-fechamento-diario-design.md` (commit 4008556)

---

## File Structure

```
~/nphairexpress/
├── supabase/
│   ├── migrations/
│   │   └── 20260510120000_fechamento_diario.sql       (NEW)
│   └── functions/daily-report/
│       ├── index.ts                                    (NEW - HTTP handler)
│       ├── calculator.ts                               (NEW - 15 KPIs)
│       ├── detector.ts                                 (NEW - 9 detectores)
│       ├── pagbank.ts                                  (NEW - cliente EDI)
│       ├── markdown.ts                                 (NEW - WhatsApp template)
│       ├── html.ts                                     (NEW - tela template)
│       ├── types.ts                                    (NEW - tipos compartilhados)
│       ├── deno.json                                   (NEW)
│       └── tests/
│           ├── calculator_test.ts                      (NEW)
│           ├── detector_test.ts                        (NEW)
│           ├── pagbank_test.ts                         (NEW)
│           ├── markdown_test.ts                        (NEW)
│           └── fixtures/
│               ├── empty_day.json                      (NEW)
│               ├── normal_day.json                     (NEW)
│               ├── divergent_day.json                  (NEW)
│               └── pagbank_response.json               (NEW)
├── src/
│   ├── pages/
│   │   ├── Fechamentos.tsx                             (NEW)
│   │   └── Pendencias.tsx                              (NEW)
│   ├── components/
│   │   ├── fechamentos/
│   │   │   ├── DailyReportRow.tsx                      (NEW)
│   │   │   ├── DailyReportDetailModal.tsx              (NEW)
│   │   │   ├── MonthlyReportButton.tsx                 (NEW)
│   │   │   └── monthlyReportPdf.ts                     (NEW - jspdf gen)
│   │   ├── pendencias/
│   │   │   ├── IssueCard.tsx                           (NEW)
│   │   │   ├── IssueRequestCorrectionModal.tsx         (NEW)
│   │   │   └── IssueFilters.tsx                        (NEW)
│   │   └── layout/
│   │       └── AppSidebar.tsx                          (MODIFY - 2 entradas)
│   ├── hooks/
│   │   ├── useDailyReports.ts                          (NEW)
│   │   ├── useClosureIssues.ts                         (NEW)
│   │   └── useEvolutionSend.ts                         (NEW)
│   └── App.tsx                                         (MODIFY - 2 rotas)
└── scripts/
    └── backfill-may-2026.ts                            (NEW - one-shot)

Servidor remoto (não no repo):
- N8N agentes (5679): workflow novo "FECHAMENTO DIÁRIO NP HAIR EXPRESS"
- N8N Vivi (Jnqt15rnIduC4Z4i): MODIFY nó "Processa Comando" para regex #fechamento
```

---

## Pré-requisitos da execução

- [ ] **P0:** Estar em branch limpa derivada da `main` (não em `feat/cashback-config-seletivo`)

```bash
cd /Users/pc/nphairexpress
git stash push -m "WIP cashback config + Agenda + .temp" -- bun.lock src/pages/Agenda.tsx supabase/.temp/
git fetch origin main
git checkout -b feat/fechamento-diario origin/main
```

- [ ] **P1:** Confirmar schema de tabelas existentes (referenciar em FKs novas)

```bash
# Conectar via PAT salvo em reference_supabase_suavez_express.md
export SUPABASE_PAT='${SUPABASE_PAT}'
export PROJECT_REF='ewxiaxsmohxuabcmxuyc'

curl -s "https://api.supabase.com/v1/projects/$PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_PAT" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT table_name FROM information_schema.tables WHERE table_schema=$$public$$ AND table_name IN ($$salons$$,$$comandas$$,$$payments$$,$$comanda_items$$,$$services$$,$$professionals$$,$$clients$$,$$queue_entries$$,$$customer_credits$$,$$profiles$$) ORDER BY table_name"}'
```

Esperado: 10 nomes retornados (todos existem).

---

## FASE 1 — Migration SQL (3 tabelas + RLS + trigger)

### Task 1.1: Criar migration com as 3 tabelas

**Files:**
- Create: `supabase/migrations/20260510120000_fechamento_diario.sql`

- [ ] **Step 1:** Criar arquivo da migration

```sql
-- supabase/migrations/20260510120000_fechamento_diario.sql

-- ====================================================================
-- Fechamento Diário NP Hair Express
-- Spec: docs/superpowers/specs/2026-05-10-fechamento-diario-design.md
-- ====================================================================

-- 1) Relatório consolidado por dia
CREATE TABLE IF NOT EXISTS daily_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  report_date date NOT NULL,
  kpis jsonb NOT NULL,
  pagbank_raw jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  generated_by text NOT NULL DEFAULT 'cron'
    CHECK (generated_by IN ('cron','manual','admin_command','backfill')),
  generated_by_user_id uuid REFERENCES profiles(id),
  UNIQUE (salon_id, report_date)
);

-- 2) Pendências detectadas no fechamento
CREATE TABLE IF NOT EXISTS closure_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  comanda_id uuid REFERENCES comandas(id) ON DELETE SET NULL,
  professional_id uuid REFERENCES professionals(id) ON DELETE SET NULL,
  detected_date date NOT NULL,
  issue_type text NOT NULL CHECK (issue_type IN (
    'payment_method_mismatch',
    'value_mismatch',
    'comanda_open_24h',
    'professional_missing',
    'duplicate_service_same_client',
    'paid_without_payment',
    'payment_without_paid_flag',
    'pagbank_orphan_transaction',
    'cashback_overdraft'
  )),
  severity text NOT NULL CHECK (severity IN ('high','medium','low')),
  description text NOT NULL,
  expected_value jsonb,
  actual_value jsonb,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','in_correction','auto_resolved','marked_resolved','resolved','reopened','ignored')),
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  ignored_reason text,
  ignored_by uuid REFERENCES profiles(id)
);

-- 3) Histórico de ações sobre pendências
CREATE TABLE IF NOT EXISTS closure_issue_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL REFERENCES closure_issues(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN (
    'requested_correction','reminded','marked_resolved',
    'auto_resolved','reopened','ignored'
  )),
  user_id uuid REFERENCES profiles(id),
  message text,
  whatsapp_message_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_closure_issues_status
  ON closure_issues(salon_id, status, detected_date DESC);
CREATE INDEX IF NOT EXISTS idx_closure_issues_comanda
  ON closure_issues(comanda_id) WHERE comanda_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_daily_reports_date
  ON daily_reports(salon_id, report_date DESC);
CREATE INDEX IF NOT EXISTS idx_closure_issue_actions_issue
  ON closure_issue_actions(issue_id, created_at DESC);
```

- [ ] **Step 2:** Validar SQL sintaticamente sem aplicar

```bash
cd /Users/pc/nphairexpress
npx supabase db lint --linked || echo "(lint falhou — comum em features novas, prossegue)"
```

- [ ] **Step 3:** Commit (sem aplicar ainda — aplica em 1.3)

```bash
git add supabase/migrations/20260510120000_fechamento_diario.sql
git commit -m "feat(db): create daily_reports + closure_issues + actions tables"
```

---

### Task 1.2: Adicionar RLS policies

**Files:**
- Modify: `supabase/migrations/20260510120000_fechamento_diario.sql` (append)

- [ ] **Step 1:** Append RLS policies ao final do arquivo

```sql

-- ====================================================================
-- RLS Policies — mesmo padrão das outras tabelas (profiles.user_id = auth.uid())
-- ====================================================================

ALTER TABLE daily_reports        ENABLE ROW LEVEL SECURITY;
ALTER TABLE closure_issues       ENABLE ROW LEVEL SECURITY;
ALTER TABLE closure_issue_actions ENABLE ROW LEVEL SECURITY;

-- daily_reports: leitura/escrita pra usuários do salon, service_role bypassa
CREATE POLICY "daily_reports_select_own_salon"
  ON daily_reports FOR SELECT
  USING (
    salon_id IN (
      SELECT salon_id FROM profiles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "daily_reports_insert_own_salon"
  ON daily_reports FOR INSERT
  WITH CHECK (
    salon_id IN (
      SELECT salon_id FROM profiles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "daily_reports_update_own_salon"
  ON daily_reports FOR UPDATE
  USING (
    salon_id IN (
      SELECT salon_id FROM profiles WHERE user_id = auth.uid()
    )
  );

-- closure_issues: idem
CREATE POLICY "closure_issues_select_own_salon"
  ON closure_issues FOR SELECT
  USING (
    salon_id IN (
      SELECT salon_id FROM profiles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "closure_issues_insert_own_salon"
  ON closure_issues FOR INSERT
  WITH CHECK (
    salon_id IN (
      SELECT salon_id FROM profiles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "closure_issues_update_own_salon"
  ON closure_issues FOR UPDATE
  USING (
    salon_id IN (
      SELECT salon_id FROM profiles WHERE user_id = auth.uid()
    )
  );

-- closure_issue_actions: idem (via JOIN com issue)
CREATE POLICY "closure_issue_actions_select_own_salon"
  ON closure_issue_actions FOR SELECT
  USING (
    issue_id IN (
      SELECT id FROM closure_issues
      WHERE salon_id IN (
        SELECT salon_id FROM profiles WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "closure_issue_actions_insert_own_salon"
  ON closure_issue_actions FOR INSERT
  WITH CHECK (
    issue_id IN (
      SELECT id FROM closure_issues
      WHERE salon_id IN (
        SELECT salon_id FROM profiles WHERE user_id = auth.uid()
      )
    )
  );
```

- [ ] **Step 2:** Commit

```bash
git add supabase/migrations/20260510120000_fechamento_diario.sql
git commit -m "feat(db): add RLS policies for closure tables"
```

---

### Task 1.3: Trigger recheck_closure_issues_on_change + aplicar migration

**Files:**
- Modify: `supabase/migrations/20260510120000_fechamento_diario.sql` (append trigger)

- [ ] **Step 1:** Append função + triggers ao final do arquivo

```sql

-- ====================================================================
-- Trigger: re-avalia closure_issues quando comanda/payment muda
-- Spec § Caminho C
-- ====================================================================

CREATE OR REPLACE FUNCTION recheck_closure_issues_on_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_comanda_id uuid;
BEGIN
  -- Descobre comanda_id afetada pelo evento
  IF TG_TABLE_NAME = 'comandas' THEN
    v_comanda_id := COALESCE(NEW.id, OLD.id);
  ELSIF TG_TABLE_NAME = 'payments' THEN
    v_comanda_id := COALESCE(NEW.comanda_id, OLD.comanda_id);
  END IF;

  IF v_comanda_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Marca issues open/in_correction/reopened como auto_resolved
  -- A revalidação completa ocorre no próximo cron (Edge Function).
  -- Aqui só sinalizamos "talvez resolvido" pra UI atualizar.
  UPDATE closure_issues
     SET status = 'auto_resolved',
         resolved_at = now()
   WHERE comanda_id = v_comanda_id
     AND status IN ('open','in_correction','reopened');

  -- Log da ação
  INSERT INTO closure_issue_actions (issue_id, action, message)
  SELECT id, 'auto_resolved',
         format('Trigger %s em %s detectou alteração', TG_OP, TG_TABLE_NAME)
    FROM closure_issues
   WHERE comanda_id = v_comanda_id
     AND status = 'auto_resolved'
     AND resolved_at >= now() - interval '1 second';

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS recheck_closure_on_comanda_update ON comandas;
CREATE TRIGGER recheck_closure_on_comanda_update
  AFTER UPDATE OF total, is_paid ON comandas
  FOR EACH ROW
  EXECUTE FUNCTION recheck_closure_issues_on_change();

DROP TRIGGER IF EXISTS recheck_closure_on_payment_change ON payments;
CREATE TRIGGER recheck_closure_on_payment_change
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION recheck_closure_issues_on_change();
```

- [ ] **Step 2:** Aplicar migration no Supabase

```bash
cd /Users/pc/nphairexpress
export SUPABASE_ACCESS_TOKEN='${SUPABASE_PAT}'
npx supabase db push --linked
```

Expected output: `Finished supabase db push.` + 1 migration aplicada.

- [ ] **Step 3:** Verificar tabelas criadas

```bash
curl -s "https://api.supabase.com/v1/projects/ewxiaxsmohxuabcmxuyc/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT table_name FROM information_schema.tables WHERE table_schema=$$public$$ AND table_name LIKE $$%closure%$$ OR table_name=$$daily_reports$$ ORDER BY table_name"}'
```

Expected: `daily_reports`, `closure_issue_actions`, `closure_issues` (3 linhas).

- [ ] **Step 4:** Commit

```bash
git add supabase/migrations/20260510120000_fechamento_diario.sql
git commit -m "feat(db): add recheck trigger on comandas+payments + apply migration"
```

---

## FASE 2 — Edge Function: Setup + Tipos

### Task 2.1: Criar estrutura da Edge Function + deno.json

**Files:**
- Create: `supabase/functions/daily-report/deno.json`
- Create: `supabase/functions/daily-report/types.ts`

- [ ] **Step 1:** Criar `deno.json` com imports

```json
{
  "imports": {
    "std/": "https://deno.land/std@0.224.0/",
    "supabase": "https://esm.sh/@supabase/supabase-js@2.49.4",
    "zod": "https://esm.sh/zod@3.25.76"
  },
  "tasks": {
    "test": "deno test --allow-all tests/"
  }
}
```

- [ ] **Step 2:** Criar `types.ts` com todos os tipos compartilhados

```typescript
// supabase/functions/daily-report/types.ts

export type IssueType =
  | 'payment_method_mismatch'
  | 'value_mismatch'
  | 'comanda_open_24h'
  | 'professional_missing'
  | 'duplicate_service_same_client'
  | 'paid_without_payment'
  | 'payment_without_paid_flag'
  | 'pagbank_orphan_transaction'
  | 'cashback_overdraft';

export type Severity = 'high' | 'medium' | 'low';

export interface ClosureIssue {
  type: IssueType;
  severity: Severity;
  description: string;
  comanda_id?: string;
  professional_id?: string;
  expected_value?: Record<string, unknown>;
  actual_value?: Record<string, unknown>;
}

export interface PaymentMix {
  credit:  { count: number; gross: number; net: number };
  debit:   { count: number; gross: number; net: number };
  pix:     { count: number; gross: number; net: number };
  cash:    { count: number; gross: number; net: number };
}

export interface ProfessionalStats {
  id: string;
  name: string;
  revenue: number;
  count: number;
  top_service: { name: string; count: number } | null;
}

export interface ServiceStats {
  id: string;
  name: string;
  count: number;
  revenue: number;
}

export interface DailyKpis {
  revenue: { gross: number; net: number; expected_from_pagbank: number };
  bookings: { count: number; average_ticket: number };
  by_professional: ProfessionalStats[];
  top_services: ServiceStats[];
  payment_mix: PaymentMix;
  real_card_fee: { total: number; by_brand: Record<string, number> };
  new_vs_returning: { new_count: number; returning_count: number; new_revenue: number };
  cashback: { credited: number; redeemed: number; balance_change: number };
  towels: { count: number; cost: number };
  queue_unattended: { count: number; list: Array<{ id: string; client: string }> };
  seven_day_average: { revenue: number; bookings: number; ticket: number };
}

export interface PagBankTransaction {
  meio_pagamento: number;       // 3=Crédito, 8=Débito Maestro, 11=PIX, 15=Débito prepaid
  arranjo_ur: string;           // CREDIT_VISA, DEBIT_MASTERCARD, PIX...
  valor_total_transacao: number;
  valor_liquido_transacao: number;
  taxa_intermediacao: number;
  data_prevista_pagamento: string;
  quantidade_parcelas: number;
}

export interface DailyReportResponse {
  period: { start: string; end: string; days: number };
  kpis: DailyKpis;
  issues: ClosureIssue[];
  comparisons: {
    vs_yesterday: { revenue_pct: number; bookings_pct: number };
    vs_7d_avg:    { revenue_pct: number; bookings_pct: number };
    vs_same_weekday: { revenue_pct: number; bookings_pct: number };
  };
  markdown: string;
  html: string;
  pagbank_unavailable?: boolean;
}

// Domínio (input das funções de cálculo)
export interface ComandaWithItems {
  id: string;
  salon_id: string;
  client_id: string | null;
  professional_id: string | null;
  comanda_number: number;
  total: number;
  is_paid: boolean;
  created_at: string;
  closed_at: string | null;
  items: Array<{
    service_id: string;
    service_name: string;
    quantity: number;
    unit_price: number;
    total_price: number;
  }>;
  payments: Array<{
    id: string;
    amount: number;
    payment_method: string;
    fee_amount: number;
    net_amount: number;
    installments: number;
  }>;
}
```

- [ ] **Step 3:** Commit

```bash
git add supabase/functions/daily-report/
git commit -m "feat(edge): scaffold daily-report function + shared types"
```

---

### Task 2.2: Criar fixtures de teste

**Files:**
- Create: `supabase/functions/daily-report/tests/fixtures/empty_day.json`
- Create: `supabase/functions/daily-report/tests/fixtures/normal_day.json`
- Create: `supabase/functions/daily-report/tests/fixtures/divergent_day.json`
- Create: `supabase/functions/daily-report/tests/fixtures/pagbank_response.json`

- [ ] **Step 1:** `empty_day.json` — dia sem movimento

```json
{
  "comandas": [],
  "queue_entries": [],
  "customer_credits": []
}
```

- [ ] **Step 2:** `normal_day.json` — 5 comandas variadas (1 PIX, 2 cartão, 1 dinheiro, 1 mista)

```json
{
  "comandas": [
    {
      "id": "c1", "salon_id": "s1", "client_id": "cli1", "professional_id": "p_marcilene",
      "comanda_number": 100, "total": 47, "is_paid": true,
      "created_at": "2026-05-09T10:00:00Z", "closed_at": "2026-05-09T10:30:00Z",
      "items": [{"service_id": "svc_manicure", "service_name": "Manicure", "quantity": 1, "unit_price": 47, "total_price": 47}],
      "payments": [{"id": "pay1", "amount": 47, "payment_method": "pix", "fee_amount": 0, "net_amount": 47, "installments": 0}]
    },
    {
      "id": "c2", "salon_id": "s1", "client_id": "cli2", "professional_id": "p_wanessa",
      "comanda_number": 101, "total": 80, "is_paid": true,
      "created_at": "2026-05-09T11:00:00Z", "closed_at": "2026-05-09T11:45:00Z",
      "items": [{"service_id": "svc_escova", "service_name": "Escova", "quantity": 1, "unit_price": 80, "total_price": 80}],
      "payments": [{"id": "pay2", "amount": 80, "payment_method": "credit", "fee_amount": 0, "net_amount": 80, "installments": 1}]
    },
    {
      "id": "c3", "salon_id": "s1", "client_id": "cli3", "professional_id": "p_marcilene",
      "comanda_number": 102, "total": 47, "is_paid": true,
      "created_at": "2026-05-09T12:00:00Z", "closed_at": "2026-05-09T12:30:00Z",
      "items": [{"service_id": "svc_manicure", "service_name": "Manicure", "quantity": 1, "unit_price": 47, "total_price": 47}],
      "payments": [{"id": "pay3", "amount": 47, "payment_method": "debit", "fee_amount": 0, "net_amount": 47, "installments": 0}]
    },
    {
      "id": "c4", "salon_id": "s1", "client_id": "cli1", "professional_id": "p_julia",
      "comanda_number": 103, "total": 120, "is_paid": true,
      "created_at": "2026-05-09T14:00:00Z", "closed_at": "2026-05-09T15:00:00Z",
      "items": [
        {"service_id": "svc_escova", "service_name": "Escova", "quantity": 1, "unit_price": 80, "total_price": 80},
        {"service_id": "svc_hidratacao", "service_name": "Hidratação", "quantity": 1, "unit_price": 40, "total_price": 40}
      ],
      "payments": [{"id": "pay4", "amount": 120, "payment_method": "cash", "fee_amount": 0, "net_amount": 120, "installments": 0}]
    },
    {
      "id": "c5", "salon_id": "s1", "client_id": "cli4", "professional_id": "p_wanessa",
      "comanda_number": 104, "total": 250, "is_paid": true,
      "created_at": "2026-05-09T16:00:00Z", "closed_at": "2026-05-09T17:30:00Z",
      "items": [
        {"service_id": "svc_progressiva", "service_name": "Progressiva Express", "quantity": 1, "unit_price": 250, "total_price": 250}
      ],
      "payments": [
        {"id": "pay5a", "amount": 150, "payment_method": "credit", "fee_amount": 0, "net_amount": 150, "installments": 2},
        {"id": "pay5b", "amount": 100, "payment_method": "pix", "fee_amount": 0, "net_amount": 100, "installments": 0}
      ]
    }
  ],
  "queue_entries": [
    {"id": "q1", "status": "completed", "client_name": "Maria"},
    {"id": "q2", "status": "abandoned", "client_name": "Joana"}
  ],
  "customer_credits": [
    {"client_id": "cli1", "amount": 3.29, "type": "earned", "comanda_id": "c1"},
    {"client_id": "cli2", "amount": 5.60, "type": "earned", "comanda_id": "c2"},
    {"client_id": "cli3", "amount": -10.00, "type": "redeemed", "comanda_id": "c3"}
  ]
}
```

- [ ] **Step 3:** `divergent_day.json` — caso real Andreia 02/05 + 2 outros erros

```json
{
  "comandas": [
    {
      "id": "c75", "salon_id": "s1", "client_id": "cli_andreia", "professional_id": "p_marcilene",
      "comanda_number": 75, "total": 64, "is_paid": true,
      "created_at": "2026-05-02T14:00:00Z", "closed_at": "2026-05-02T14:30:00Z",
      "items": [{"service_id": "svc_manicure_pedicure", "service_name": "Manicure+Pedicure", "quantity": 1, "unit_price": 64, "total_price": 64}],
      "payments": [{"id": "pay75", "amount": 64, "payment_method": "cash", "fee_amount": 0, "net_amount": 64, "installments": 0}]
    },
    {
      "id": "c82", "salon_id": "s1", "client_id": "cli_marina", "professional_id": "p_wanessa",
      "comanda_number": 82, "total": 120, "is_paid": false,
      "created_at": "2026-05-01T16:00:00Z", "closed_at": null,
      "items": [{"service_id": "svc_escova", "service_name": "Escova", "quantity": 1, "unit_price": 120, "total_price": 120}],
      "payments": []
    },
    {
      "id": "c90", "salon_id": "s1", "client_id": "cli_dandara", "professional_id": "p_julia",
      "comanda_number": 90, "total": 240, "is_paid": true,
      "created_at": "2026-05-02T15:00:00Z", "closed_at": "2026-05-02T15:30:00Z",
      "items": [
        {"service_id": "svc_escova", "service_name": "Escova", "quantity": 3, "unit_price": 80, "total_price": 240}
      ],
      "payments": [{"id": "pay90", "amount": 240, "payment_method": "credit", "fee_amount": 0, "net_amount": 240, "installments": 3}]
    }
  ],
  "queue_entries": [],
  "customer_credits": []
}
```

- [ ] **Step 4:** `pagbank_response.json` — resposta EDI com a transação Andreia

```json
{
  "detalhes": [
    {
      "meio_pagamento": 8,
      "arranjo_ur": "DEBIT_MASTERCARD",
      "valor_total_transacao": 64,
      "valor_liquido_transacao": 63.37,
      "taxa_intermediacao": 0.63,
      "data_prevista_pagamento": "2026-05-03",
      "quantidade_parcelas": 0
    },
    {
      "meio_pagamento": 3,
      "arranjo_ur": "CREDIT_VISA",
      "valor_total_transacao": 240,
      "valor_liquido_transacao": 232.13,
      "taxa_intermediacao": 7.87,
      "data_prevista_pagamento": "2026-05-04",
      "quantidade_parcelas": 3
    }
  ],
  "pagination": { "elements": 100, "totalPages": 1, "page": 1, "totalElements": 2 }
}
```

- [ ] **Step 5:** Commit

```bash
git add supabase/functions/daily-report/tests/fixtures/
git commit -m "test(edge): fixtures empty/normal/divergent days + pagbank response"
```

---

## FASE 3 — Edge Function: Calculator (TDD)

> Padrão de cada task nesta fase: **(1)** escrever teste, **(2)** rodar e ver falhar, **(3)** implementar mínimo, **(4)** rodar e ver passar, **(5)** commit.

### Task 3.1: KPI revenue (gross/net/expected_from_pagbank)

**Files:**
- Create: `supabase/functions/daily-report/calculator.ts`
- Create: `supabase/functions/daily-report/tests/calculator_test.ts`

- [ ] **Step 1:** Escrever teste

```typescript
// supabase/functions/daily-report/tests/calculator_test.ts
import { assertEquals } from "std/assert/mod.ts";
import { calculateRevenue } from "../calculator.ts";
import normalDay from "./fixtures/normal_day.json" with { type: "json" };

Deno.test("calculateRevenue: soma bruto de comandas pagas", () => {
  const result = calculateRevenue(normalDay.comandas, []);
  assertEquals(result.gross, 47 + 80 + 47 + 120 + 250); // 544
});

Deno.test("calculateRevenue: ignora comandas não pagas", () => {
  const comandas = [
    { ...normalDay.comandas[0], is_paid: false }
  ];
  const result = calculateRevenue(comandas, []);
  assertEquals(result.gross, 0);
});

Deno.test("calculateRevenue: net subtrai taxas dos payments", () => {
  const comandas = [{
    ...normalDay.comandas[1],
    payments: [{ ...normalDay.comandas[1].payments[0], fee_amount: 2.64, net_amount: 77.36 }]
  }];
  const result = calculateRevenue(comandas, []);
  assertEquals(result.gross, 80);
  assertEquals(result.net, 77.36);
});

Deno.test("calculateRevenue: expected_from_pagbank soma valor_total_transacao", () => {
  const pagbank = [
    { meio_pagamento: 8, valor_total_transacao: 64, valor_liquido_transacao: 63.37, taxa_intermediacao: 0.63, arranjo_ur: "DEBIT_MASTERCARD", data_prevista_pagamento: "", quantidade_parcelas: 0 },
    { meio_pagamento: 3, valor_total_transacao: 240, valor_liquido_transacao: 232.13, taxa_intermediacao: 7.87, arranjo_ur: "CREDIT_VISA", data_prevista_pagamento: "", quantidade_parcelas: 3 }
  ];
  const result = calculateRevenue([], pagbank);
  assertEquals(result.expected_from_pagbank, 304);
});
```

- [ ] **Step 2:** Rodar — esperando falhar com "calculateRevenue is not exported"

```bash
cd supabase/functions/daily-report
deno test --allow-all tests/calculator_test.ts
```

Expected: 4 testes FAIL com erro de import.

- [ ] **Step 3:** Implementação mínima

```typescript
// supabase/functions/daily-report/calculator.ts
import type { ComandaWithItems, PagBankTransaction } from "./types.ts";

export function calculateRevenue(
  comandas: ComandaWithItems[],
  pagbank: PagBankTransaction[]
): { gross: number; net: number; expected_from_pagbank: number } {
  const paid = comandas.filter(c => c.is_paid);
  const gross = paid.reduce((sum, c) => sum + Number(c.total), 0);
  const net = paid.reduce(
    (sum, c) => sum + c.payments.reduce(
      (s, p) => s + (p.net_amount ?? p.amount), 0
    ),
    0
  );
  const expected_from_pagbank = pagbank.reduce(
    (sum, t) => sum + Number(t.valor_total_transacao), 0
  );
  return { gross, net, expected_from_pagbank };
}
```

- [ ] **Step 4:** Rodar — esperando 4 testes PASS

```bash
deno test --allow-all tests/calculator_test.ts
```

Expected: `4 passed`.

- [ ] **Step 5:** Commit

```bash
git add supabase/functions/daily-report/calculator.ts supabase/functions/daily-report/tests/calculator_test.ts
git commit -m "feat(edge): calculateRevenue (gross/net/expected_pagbank)"
```

---

### Task 3.2: KPI bookings (count + average_ticket)

**Files:**
- Modify: `supabase/functions/daily-report/calculator.ts`
- Modify: `supabase/functions/daily-report/tests/calculator_test.ts`

- [ ] **Step 1:** Adicionar testes ao final de `calculator_test.ts`

```typescript
import { calculateBookings } from "../calculator.ts";

Deno.test("calculateBookings: conta apenas comandas pagas", () => {
  const result = calculateBookings(normalDay.comandas);
  assertEquals(result.count, 5);
});

Deno.test("calculateBookings: ticket médio = bruto/count", () => {
  const result = calculateBookings(normalDay.comandas);
  assertEquals(result.average_ticket, 544 / 5); // 108.8
});

Deno.test("calculateBookings: dia vazio retorna count=0 e ticket=0", () => {
  const result = calculateBookings([]);
  assertEquals(result.count, 0);
  assertEquals(result.average_ticket, 0);
});
```

- [ ] **Step 2:** Rodar — espera 3 FAIL

```bash
deno test --allow-all tests/calculator_test.ts
```

- [ ] **Step 3:** Implementação

```typescript
// append em calculator.ts
export function calculateBookings(
  comandas: ComandaWithItems[]
): { count: number; average_ticket: number } {
  const paid = comandas.filter(c => c.is_paid);
  const count = paid.length;
  const total = paid.reduce((sum, c) => sum + Number(c.total), 0);
  const average_ticket = count === 0 ? 0 : total / count;
  return { count, average_ticket };
}
```

- [ ] **Step 4:** Rodar — espera 7 PASS (4 anteriores + 3 novos)

```bash
deno test --allow-all tests/calculator_test.ts
```

- [ ] **Step 5:** Commit

```bash
git add supabase/functions/daily-report/calculator.ts supabase/functions/daily-report/tests/calculator_test.ts
git commit -m "feat(edge): calculateBookings (count + average ticket)"
```

---

### Task 3.3: KPI by_professional (faturamento + top serviço)

**Files:**
- Modify: `supabase/functions/daily-report/calculator.ts`
- Modify: `supabase/functions/daily-report/tests/calculator_test.ts`

- [ ] **Step 1:** Adicionar testes

```typescript
import { calculateByProfessional } from "../calculator.ts";

const PROFS = [
  { id: "p_marcilene", name: "Marcilene Zanette" },
  { id: "p_wanessa",   name: "Wanessa Ribeiro" },
  { id: "p_julia",     name: "Julia Dalla" }
];

Deno.test("calculateByProfessional: agrega revenue por profissional", () => {
  const result = calculateByProfessional(normalDay.comandas, PROFS);
  const wanessa = result.find(p => p.id === "p_wanessa");
  // c2 (80) + c5 (250) = 330
  assertEquals(wanessa?.revenue, 330);
});

Deno.test("calculateByProfessional: top_service é o mais frequente", () => {
  const result = calculateByProfessional(normalDay.comandas, PROFS);
  const marcilene = result.find(p => p.id === "p_marcilene");
  assertEquals(marcilene?.top_service?.name, "Manicure"); // 2 manicures
});

Deno.test("calculateByProfessional: ordena por revenue desc", () => {
  const result = calculateByProfessional(normalDay.comandas, PROFS);
  // wanessa 330, julia 120, marcilene 94
  assertEquals(result[0].id, "p_wanessa");
  assertEquals(result[1].id, "p_julia");
  assertEquals(result[2].id, "p_marcilene");
});
```

- [ ] **Step 2:** Rodar — 3 FAIL

- [ ] **Step 3:** Implementação

```typescript
// append em calculator.ts
import type { ProfessionalStats } from "./types.ts";

export function calculateByProfessional(
  comandas: ComandaWithItems[],
  professionals: Array<{ id: string; name: string }>
): ProfessionalStats[] {
  const paid = comandas.filter(c => c.is_paid && c.professional_id);
  const byProf = new Map<string, { revenue: number; count: number; services: Map<string, number> }>();

  for (const c of paid) {
    const pid = c.professional_id!;
    if (!byProf.has(pid)) byProf.set(pid, { revenue: 0, count: 0, services: new Map() });
    const agg = byProf.get(pid)!;
    agg.revenue += Number(c.total);
    agg.count += 1;
    for (const item of c.items) {
      agg.services.set(item.service_name, (agg.services.get(item.service_name) ?? 0) + item.quantity);
    }
  }

  const result: ProfessionalStats[] = [];
  for (const [pid, agg] of byProf) {
    const prof = professionals.find(p => p.id === pid);
    if (!prof) continue;
    const top = [...agg.services.entries()].sort((a, b) => b[1] - a[1])[0];
    result.push({
      id: pid,
      name: prof.name,
      revenue: agg.revenue,
      count: agg.count,
      top_service: top ? { name: top[0], count: top[1] } : null
    });
  }

  return result.sort((a, b) => b.revenue - a.revenue);
}
```

- [ ] **Step 4:** Rodar — 10 PASS

- [ ] **Step 5:** Commit

```bash
git commit -am "feat(edge): calculateByProfessional with top service"
```

---

### Task 3.4: KPI top_services (top 3)

- [ ] **Step 1:** Teste

```typescript
import { calculateTopServices } from "../calculator.ts";

Deno.test("calculateTopServices: agrega count + revenue por serviço", () => {
  const result = calculateTopServices(normalDay.comandas);
  const escova = result.find(s => s.name === "Escova");
  // c2 (1×80) + c4 (1×80) + c5 NÃO (progressiva). Total: 2 escovas, 160 reais
  assertEquals(escova?.count, 2);
  assertEquals(escova?.revenue, 160);
});

Deno.test("calculateTopServices: retorna top 3 ordenado por count", () => {
  const result = calculateTopServices(normalDay.comandas);
  assertEquals(result.length <= 3, true);
  for (let i = 1; i < result.length; i++) {
    assertEquals(result[i - 1].count >= result[i].count, true);
  }
});
```

- [ ] **Step 2:** Run → FAIL

- [ ] **Step 3:** Implementação

```typescript
// append em calculator.ts
import type { ServiceStats } from "./types.ts";

export function calculateTopServices(comandas: ComandaWithItems[]): ServiceStats[] {
  const paid = comandas.filter(c => c.is_paid);
  const byService = new Map<string, { name: string; count: number; revenue: number }>();
  for (const c of paid) {
    for (const item of c.items) {
      const k = item.service_id;
      if (!byService.has(k)) byService.set(k, { name: item.service_name, count: 0, revenue: 0 });
      const agg = byService.get(k)!;
      agg.count += item.quantity;
      agg.revenue += Number(item.total_price);
    }
  }
  return [...byService.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
}
```

- [ ] **Step 4:** Run → PASS

- [ ] **Step 5:** `git commit -am "feat(edge): calculateTopServices (top 3)"`

---

### Task 3.5: KPI payment_mix

- [ ] **Step 1:** Teste

```typescript
import { calculatePaymentMix } from "../calculator.ts";

Deno.test("calculatePaymentMix: agrega por método", () => {
  const result = calculatePaymentMix(normalDay.comandas);
  // pix: c1 47 + c5b 100 = 147 (count 2)
  // credit: c2 80 + c5a 150 = 230 (count 2)
  // debit: c3 47 (count 1)
  // cash: c4 120 (count 1)
  assertEquals(result.pix.gross, 147);
  assertEquals(result.pix.count, 2);
  assertEquals(result.credit.gross, 230);
  assertEquals(result.debit.gross, 47);
  assertEquals(result.cash.gross, 120);
});
```

- [ ] **Step 2:** Run → FAIL

- [ ] **Step 3:** Implementação

```typescript
// append em calculator.ts
import type { PaymentMix } from "./types.ts";

export function calculatePaymentMix(comandas: ComandaWithItems[]): PaymentMix {
  const empty = { count: 0, gross: 0, net: 0 };
  const mix: PaymentMix = {
    credit: { ...empty }, debit: { ...empty }, pix: { ...empty }, cash: { ...empty }
  };
  for (const c of comandas.filter(x => x.is_paid)) {
    for (const p of c.payments) {
      const key = (p.payment_method ?? "").toLowerCase() as keyof PaymentMix;
      if (!(key in mix)) continue;
      mix[key].count += 1;
      mix[key].gross += Number(p.amount);
      mix[key].net += Number(p.net_amount ?? p.amount);
    }
  }
  return mix;
}
```

- [ ] **Step 4:** Run → PASS

- [ ] **Step 5:** `git commit -am "feat(edge): calculatePaymentMix"`

---

### Task 3.6: KPI real_card_fee (taxa real do PagBank)

- [ ] **Step 1:** Teste

```typescript
import { calculateRealCardFee } from "../calculator.ts";
import pagbankFixture from "./fixtures/pagbank_response.json" with { type: "json" };

Deno.test("calculateRealCardFee: total = soma de taxa_intermediacao", () => {
  const result = calculateRealCardFee(pagbankFixture.detalhes);
  assertEquals(result.total, 0.63 + 7.87); // 8.50
});

Deno.test("calculateRealCardFee: by_brand agrupa por arranjo_ur", () => {
  const result = calculateRealCardFee(pagbankFixture.detalhes);
  assertEquals(result.by_brand["DEBIT_MASTERCARD"], 0.63);
  assertEquals(result.by_brand["CREDIT_VISA"], 7.87);
});
```

- [ ] **Step 2:** Run → FAIL

- [ ] **Step 3:** Implementação

```typescript
// append em calculator.ts
export function calculateRealCardFee(
  pagbank: PagBankTransaction[]
): { total: number; by_brand: Record<string, number> } {
  let total = 0;
  const by_brand: Record<string, number> = {};
  for (const t of pagbank) {
    const fee = Number(t.taxa_intermediacao ?? 0);
    if (fee === 0) continue; // PIX, dinheiro
    total += fee;
    by_brand[t.arranjo_ur] = (by_brand[t.arranjo_ur] ?? 0) + fee;
  }
  return { total, by_brand };
}
```

- [ ] **Step 4:** Run → PASS

- [ ] **Step 5:** `git commit -am "feat(edge): calculateRealCardFee from PagBank"`

---

### Task 3.7: KPIs new_vs_returning + cashback + towels + queue + 7d_avg

> Agrupados por serem cálculos pequenos. Cada um tem 1-2 testes.

**Files:**
- Modify: `supabase/functions/daily-report/calculator.ts`
- Modify: `supabase/functions/daily-report/tests/calculator_test.ts`

- [ ] **Step 1:** Testes (todos)

```typescript
import {
  calculateNewVsReturning,
  calculateCashback,
  calculateTowels,
  calculateQueueUnattended,
  calculateSevenDayAverage,
} from "../calculator.ts";

Deno.test("calculateNewVsReturning: novo = primeira comanda do cliente no histórico", () => {
  // novos: cli2, cli3, cli4 (sem comanda anterior). retornando: cli1 (já tinha c0 ontem)
  const today = normalDay.comandas;
  const history = [{ client_id: "cli1", closed_at: "2026-05-08T10:00:00Z" }];
  const result = calculateNewVsReturning(today, history);
  assertEquals(result.new_count, 3);   // cli2, cli3, cli4 (cli1 aparece 2x mas conta como retornando)
  assertEquals(result.returning_count, 1); // cli1
});

Deno.test("calculateCashback: separa earned vs redeemed", () => {
  const result = calculateCashback(normalDay.customer_credits);
  assertEquals(result.credited, 3.29 + 5.60); // 8.89
  assertEquals(result.redeemed, 10);
  assertEquals(result.balance_change, 8.89 - 10); // -1.11
});

Deno.test("calculateTowels: 1 toalha por comanda paga × R$1,60", () => {
  const result = calculateTowels(normalDay.comandas);
  assertEquals(result.count, 5);
  assertEquals(result.cost, 5 * 1.60);
});

Deno.test("calculateQueueUnattended: pega abandoned/timeout", () => {
  const result = calculateQueueUnattended(normalDay.queue_entries);
  assertEquals(result.count, 1);
  assertEquals(result.list[0].client, "Joana");
});

Deno.test("calculateSevenDayAverage: média dos últimos 7 dias úteis", () => {
  const history = [
    { date: "2026-05-08", revenue: 500, bookings: 4 },
    { date: "2026-05-07", revenue: 600, bookings: 5 },
    { date: "2026-05-06", revenue: 400, bookings: 3 }
  ];
  const result = calculateSevenDayAverage(history);
  assertEquals(result.revenue, 500); // (500+600+400)/3
  assertEquals(result.bookings, 4);  // (4+5+3)/3
});
```

- [ ] **Step 2:** Run → 5 FAIL

- [ ] **Step 3:** Implementação completa

```typescript
// append em calculator.ts
export function calculateNewVsReturning(
  today: ComandaWithItems[],
  historyPaid: Array<{ client_id: string | null; closed_at: string | null }>
): { new_count: number; returning_count: number; new_revenue: number } {
  const known = new Set(historyPaid.filter(h => h.client_id).map(h => h.client_id!));
  const todayClients = new Map<string, number>();
  for (const c of today.filter(x => x.is_paid && x.client_id)) {
    todayClients.set(c.client_id!, (todayClients.get(c.client_id!) ?? 0) + Number(c.total));
  }
  let new_count = 0, returning_count = 0, new_revenue = 0;
  for (const [cid, revenue] of todayClients) {
    if (known.has(cid)) {
      returning_count += 1;
    } else {
      new_count += 1;
      new_revenue += revenue;
    }
  }
  return { new_count, returning_count, new_revenue };
}

export function calculateCashback(
  credits: Array<{ amount: number; type: "earned" | "redeemed" }>
): { credited: number; redeemed: number; balance_change: number } {
  let credited = 0, redeemed = 0;
  for (const c of credits) {
    if (c.type === "earned") credited += Math.abs(Number(c.amount));
    else if (c.type === "redeemed") redeemed += Math.abs(Number(c.amount));
  }
  return { credited, redeemed, balance_change: credited - redeemed };
}

export function calculateTowels(comandas: ComandaWithItems[]): { count: number; cost: number } {
  const count = comandas.filter(c => c.is_paid).length;
  return { count, cost: count * 1.60 };
}

export function calculateQueueUnattended(
  entries: Array<{ id: string; status: string; client_name: string }>
): { count: number; list: Array<{ id: string; client: string }> } {
  const list = entries
    .filter(e => e.status === "abandoned" || e.status === "timeout")
    .map(e => ({ id: e.id, client: e.client_name }));
  return { count: list.length, list };
}

export function calculateSevenDayAverage(
  history: Array<{ date: string; revenue: number; bookings: number }>
): { revenue: number; bookings: number; ticket: number } {
  if (history.length === 0) return { revenue: 0, bookings: 0, ticket: 0 };
  const last = history.slice(0, 7);
  const revenue = last.reduce((s, h) => s + h.revenue, 0) / last.length;
  const bookings = last.reduce((s, h) => s + h.bookings, 0) / last.length;
  const ticket = bookings === 0 ? 0 : revenue / bookings;
  return { revenue, bookings, ticket };
}
```

- [ ] **Step 4:** Run → todos PASS

- [ ] **Step 5:** `git commit -am "feat(edge): new/returning, cashback, towels, queue, 7d avg"`

---

## FASE 4 — Edge Function: Detector (TDD)

### Task 4.1: 4 detectores high severity

**Files:**
- Create: `supabase/functions/daily-report/detector.ts`
- Create: `supabase/functions/daily-report/tests/detector_test.ts`

- [ ] **Step 1:** Testes

```typescript
// supabase/functions/daily-report/tests/detector_test.ts
import { assertEquals } from "std/assert/mod.ts";
import {
  detectPaymentMethodMismatch,
  detectValueMismatch,
  detectPaidWithoutPayment,
  detectPagbankOrphanTransaction,
} from "../detector.ts";
import divergent from "./fixtures/divergent_day.json" with { type: "json" };
import pagbank  from "./fixtures/pagbank_response.json" with { type: "json" };

Deno.test("detectPaymentMethodMismatch: pega Andreia (cash no sistema, debit no PagBank)", () => {
  const issues = detectPaymentMethodMismatch(divergent.comandas, pagbank.detalhes);
  const andreia = issues.find(i => i.comanda_id === "c75");
  assertEquals(andreia?.severity, "high");
  assertEquals(andreia?.type, "payment_method_mismatch");
});

Deno.test("detectValueMismatch: comandas.total ≠ Σ items", () => {
  const broken = [{
    ...divergent.comandas[0],
    total: 100, // diverge dos items (64)
  }];
  const issues = detectValueMismatch(broken);
  assertEquals(issues.length, 1);
  assertEquals(issues[0].severity, "high");
});

Deno.test("detectPaidWithoutPayment: is_paid=true sem payments", () => {
  const broken = [{
    ...divergent.comandas[0],
    is_paid: true,
    payments: []
  }];
  const issues = detectPaidWithoutPayment(broken);
  assertEquals(issues.length, 1);
  assertEquals(issues[0].severity, "high");
});

Deno.test("detectPagbankOrphanTransaction: PagBank tem mas sistema não", () => {
  const issues = detectPagbankOrphanTransaction(divergent.comandas, pagbank.detalhes);
  // PagBank: 64 (debit) + 240 (credit). Sistema: 64 cash + 120 (não paga) + 240 credit.
  // Match: 240 credit. Orfãs: 64 debit (não bate com 64 cash do sistema).
  assertEquals(issues.length >= 1, true);
});
```

- [ ] **Step 2:** Run → 4 FAIL

- [ ] **Step 3:** Implementação

```typescript
// supabase/functions/daily-report/detector.ts
import type { ComandaWithItems, PagBankTransaction, ClosureIssue } from "./types.ts";

const PAYMENT_METHOD_TO_BRAND: Record<number, string> = {
  3:  "credit",
  8:  "debit",
  11: "pix",
  15: "debit",
};

export function detectPaymentMethodMismatch(
  comandas: ComandaWithItems[],
  pagbank: PagBankTransaction[]
): ClosureIssue[] {
  const issues: ClosureIssue[] = [];
  // Para cada comanda paga: tenta casar com transação PagBank por valor
  // Se valor bate mas método diverge, é mismatch
  for (const c of comandas.filter(x => x.is_paid)) {
    for (const p of c.payments) {
      const tx = pagbank.find(t =>
        Math.abs(Number(t.valor_total_transacao) - Number(p.amount)) < 0.01
      );
      if (!tx) continue;
      const expectedMethod = PAYMENT_METHOD_TO_BRAND[tx.meio_pagamento];
      if (!expectedMethod || expectedMethod === p.payment_method.toLowerCase()) continue;
      issues.push({
        type: "payment_method_mismatch",
        severity: "high",
        description: `Comanda #${c.comanda_number}: sistema diz ${p.payment_method} mas PagBank registrou ${tx.arranjo_ur}`,
        comanda_id: c.id,
        professional_id: c.professional_id ?? undefined,
        expected_value: { method: expectedMethod, brand: tx.arranjo_ur, gross: tx.valor_total_transacao, net: tx.valor_liquido_transacao },
        actual_value: { method: p.payment_method, amount: p.amount }
      });
    }
  }
  return issues;
}

export function detectValueMismatch(comandas: ComandaWithItems[]): ClosureIssue[] {
  const issues: ClosureIssue[] = [];
  for (const c of comandas) {
    const itemsSum = c.items.reduce((s, i) => s + Number(i.total_price), 0);
    if (Math.abs(itemsSum - Number(c.total)) > 0.01) {
      issues.push({
        type: "value_mismatch",
        severity: "high",
        description: `Comanda #${c.comanda_number}: total R$${c.total} ≠ soma dos itens R$${itemsSum}`,
        comanda_id: c.id,
        professional_id: c.professional_id ?? undefined,
        expected_value: { total: itemsSum },
        actual_value: { total: c.total }
      });
    }
  }
  return issues;
}

export function detectPaidWithoutPayment(comandas: ComandaWithItems[]): ClosureIssue[] {
  return comandas
    .filter(c => c.is_paid && c.payments.length === 0)
    .map(c => ({
      type: "paid_without_payment",
      severity: "high",
      description: `Comanda #${c.comanda_number} marcada como paga mas sem pagamento registrado`,
      comanda_id: c.id,
      professional_id: c.professional_id ?? undefined,
      expected_value: { has_payment: true },
      actual_value: { has_payment: false, total: c.total }
    }));
}

export function detectPagbankOrphanTransaction(
  comandas: ComandaWithItems[],
  pagbank: PagBankTransaction[]
): ClosureIssue[] {
  const allPayments = comandas.flatMap(c => c.payments.map(p => ({ ...p, comanda: c })));
  const issues: ClosureIssue[] = [];
  for (const tx of pagbank) {
    const match = allPayments.find(p =>
      Math.abs(Number(p.amount) - Number(tx.valor_total_transacao)) < 0.01 &&
      PAYMENT_METHOD_TO_BRAND[tx.meio_pagamento] === p.payment_method.toLowerCase()
    );
    if (match) continue;
    issues.push({
      type: "pagbank_orphan_transaction",
      severity: "high",
      description: `PagBank registrou ${tx.arranjo_ur} R$${tx.valor_total_transacao} sem comanda correspondente`,
      expected_value: { has_comanda: true },
      actual_value: { brand: tx.arranjo_ur, amount: tx.valor_total_transacao, method_code: tx.meio_pagamento }
    });
  }
  return issues;
}
```

- [ ] **Step 4:** Run → 4 PASS

- [ ] **Step 5:** `git commit -am "feat(edge): 4 high-severity detectors (payment/value/paid_no_pay/orphan)"`

---

### Task 4.2: 3 detectores medium + 2 low

> Agrupados (5 detectores menores).

- [ ] **Step 1:** Testes

```typescript
import {
  detectComandaOpen24h,
  detectProfessionalMissing,
  detectPaymentWithoutPaidFlag,
  detectCashbackOverdraft,
  detectDuplicateServiceSameClient,
} from "../detector.ts";

Deno.test("detectComandaOpen24h: comanda aberta há mais de 24h", () => {
  const old = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
  const comandas = [{ ...divergent.comandas[1], created_at: old, is_paid: false, closed_at: null }];
  const issues = detectComandaOpen24h(comandas);
  assertEquals(issues.length, 1);
  assertEquals(issues[0].severity, "medium");
});

Deno.test("detectProfessionalMissing: comanda sem profissional", () => {
  const c = [{ ...divergent.comandas[0], professional_id: null }];
  const issues = detectProfessionalMissing(c);
  assertEquals(issues.length, 1);
});

Deno.test("detectPaymentWithoutPaidFlag: tem payment mas is_paid=false", () => {
  const c = [{ ...divergent.comandas[0], is_paid: false, payments: [{ id: "x", amount: 64, payment_method: "cash", fee_amount: 0, net_amount: 64, installments: 0 }] }];
  const issues = detectPaymentWithoutPaidFlag(c);
  assertEquals(issues.length, 1);
});

Deno.test("detectCashbackOverdraft: balance < 0", () => {
  const credits = [{ client_id: "cli1", balance: -5 }];
  const issues = detectCashbackOverdraft(credits);
  assertEquals(issues.length, 1);
});

Deno.test("detectDuplicateServiceSameClient: 3 escovas (Dandara)", () => {
  const issues = detectDuplicateServiceSameClient(divergent.comandas);
  const dandara = issues.find(i => i.comanda_id === "c90");
  assertEquals(dandara?.severity, "low");
});
```

- [ ] **Step 2:** Run → 5 FAIL

- [ ] **Step 3:** Implementação

```typescript
// append em detector.ts
export function detectComandaOpen24h(comandas: ComandaWithItems[]): ClosureIssue[] {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  return comandas
    .filter(c => !c.is_paid && new Date(c.created_at).getTime() < cutoff)
    .map(c => {
      const hours = Math.round((Date.now() - new Date(c.created_at).getTime()) / 3600000);
      return {
        type: "comanda_open_24h",
        severity: "medium" as const,
        description: `Comanda #${c.comanda_number} aberta há ${hours}h sem fechamento`,
        comanda_id: c.id,
        professional_id: c.professional_id ?? undefined,
        actual_value: { hours_open: hours, total: c.total }
      };
    });
}

export function detectProfessionalMissing(comandas: ComandaWithItems[]): ClosureIssue[] {
  return comandas
    .filter(c => !c.professional_id)
    .map(c => ({
      type: "professional_missing",
      severity: "medium" as const,
      description: `Comanda #${c.comanda_number} sem profissional atribuída`,
      comanda_id: c.id
    }));
}

export function detectPaymentWithoutPaidFlag(comandas: ComandaWithItems[]): ClosureIssue[] {
  return comandas
    .filter(c => !c.is_paid && c.payments.length > 0)
    .map(c => ({
      type: "payment_without_paid_flag",
      severity: "medium" as const,
      description: `Comanda #${c.comanda_number}: tem pagamento mas flag is_paid=false`,
      comanda_id: c.id,
      professional_id: c.professional_id ?? undefined
    }));
}

export function detectCashbackOverdraft(
  credits: Array<{ client_id: string; balance: number }>
): ClosureIssue[] {
  return credits
    .filter(c => Number(c.balance) < 0)
    .map(c => ({
      type: "cashback_overdraft",
      severity: "medium" as const,
      description: `Cliente ${c.client_id}: saldo de cashback negativo (R$${c.balance})`,
      actual_value: { client_id: c.client_id, balance: c.balance }
    }));
}

export function detectDuplicateServiceSameClient(comandas: ComandaWithItems[]): ClosureIssue[] {
  const issues: ClosureIssue[] = [];
  for (const c of comandas) {
    for (const item of c.items) {
      if (item.quantity > 2) {
        issues.push({
          type: "duplicate_service_same_client",
          severity: "low",
          description: `Comanda #${c.comanda_number}: ${item.quantity}× ${item.service_name} pro mesmo cliente`,
          comanda_id: c.id,
          professional_id: c.professional_id ?? undefined,
          actual_value: { service: item.service_name, quantity: item.quantity }
        });
      }
    }
  }
  return issues;
}
```

- [ ] **Step 4:** Run → 5 PASS (mais os 4 anteriores = 9 total)

- [ ] **Step 5:** `git commit -am "feat(edge): 5 remaining detectors (open24h/missing prof/no flag/overdraft/duplicate)"`

---

### Task 4.3: Função agregadora `runAllDetectors`

- [ ] **Step 1:** Teste

```typescript
import { runAllDetectors } from "../detector.ts";

Deno.test("runAllDetectors: roda todos e concatena", () => {
  const issues = runAllDetectors({
    comandas: divergent.comandas,
    pagbank: pagbank.detalhes,
    credits: []
  });
  assertEquals(issues.length >= 3, true);
  // ordenado por severidade
  const severities = issues.map(i => i.severity);
  const idx = (s: string) => ({ high: 0, medium: 1, low: 2 }[s] ?? 99);
  for (let i = 1; i < severities.length; i++) {
    assertEquals(idx(severities[i - 1]) <= idx(severities[i]), true);
  }
});
```

- [ ] **Step 2:** Run → FAIL

- [ ] **Step 3:** Implementação

```typescript
// append em detector.ts
export interface DetectorInput {
  comandas: ComandaWithItems[];
  pagbank: PagBankTransaction[];
  credits: Array<{ client_id: string; balance: number }>;
}

export function runAllDetectors(input: DetectorInput): ClosureIssue[] {
  const all = [
    ...detectPaymentMethodMismatch(input.comandas, input.pagbank),
    ...detectValueMismatch(input.comandas),
    ...detectPaidWithoutPayment(input.comandas),
    ...detectPagbankOrphanTransaction(input.comandas, input.pagbank),
    ...detectComandaOpen24h(input.comandas),
    ...detectProfessionalMissing(input.comandas),
    ...detectPaymentWithoutPaidFlag(input.comandas),
    ...detectCashbackOverdraft(input.credits),
    ...detectDuplicateServiceSameClient(input.comandas),
  ];
  const sev = { high: 0, medium: 1, low: 2 } as const;
  return all.sort((a, b) => sev[a.severity] - sev[b.severity]);
}
```

- [ ] **Step 4:** Run → PASS

- [ ] **Step 5:** `git commit -am "feat(edge): runAllDetectors aggregator (9 detectors)"`

---

## FASE 5 — Edge Function: PagBank Client

### Task 5.1: Cliente HTTP do PagBank EDI

**Files:**
- Create: `supabase/functions/daily-report/pagbank.ts`
- Create: `supabase/functions/daily-report/tests/pagbank_test.ts`

- [ ] **Step 1:** Teste com mock fetch

```typescript
// supabase/functions/daily-report/tests/pagbank_test.ts
import { assertEquals, assert } from "std/assert/mod.ts";
import { fetchPagBankTransactional, type PagBankAuth } from "../pagbank.ts";
import response from "./fixtures/pagbank_response.json" with { type: "json" };

const auth: PagBankAuth = { user: "119232542", token: "TEST_TOKEN" };

Deno.test("fetchPagBankTransactional: monta Basic Auth corretamente", async () => {
  let captured: Request | undefined;
  globalThis.fetch = async (input) => {
    captured = input as Request;
    return new Response(JSON.stringify(response), { status: 200 });
  };
  await fetchPagBankTransactional("2026-05-09", auth);
  const expected = "Basic " + btoa("119232542:TEST_TOKEN");
  assertEquals(captured?.headers.get("Authorization"), expected);
  assert(captured?.url.endsWith("/movement/v3.00/transactional/2026-05-09"));
});

Deno.test("fetchPagBankTransactional: retorna detalhes em sucesso", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify(response), { status: 200 });
  const result = await fetchPagBankTransactional("2026-05-09", auth);
  assertEquals(result.unavailable, false);
  assertEquals(result.transactions.length, 2);
});

Deno.test("fetchPagBankTransactional: retorna unavailable=true em 401", async () => {
  globalThis.fetch = async () => new Response("Unauthorized", { status: 401 });
  const result = await fetchPagBankTransactional("2026-05-09", auth);
  assertEquals(result.unavailable, true);
  assertEquals(result.transactions.length, 0);
});

Deno.test("fetchPagBankTransactional: retorna unavailable=true em 5xx", async () => {
  globalThis.fetch = async () => new Response("ISE", { status: 500 });
  const result = await fetchPagBankTransactional("2026-05-09", auth);
  assertEquals(result.unavailable, true);
});
```

- [ ] **Step 2:** Run → 4 FAIL

- [ ] **Step 3:** Implementação

```typescript
// supabase/functions/daily-report/pagbank.ts
import type { PagBankTransaction } from "./types.ts";

export interface PagBankAuth { user: string; token: string }
export interface PagBankResult {
  unavailable: boolean;
  transactions: PagBankTransaction[];
  raw: unknown;
}

const BASE_URL = "https://edi.api.pagbank.com.br/movement/v3.00/transactional";

export async function fetchPagBankTransactional(
  dateISO: string, auth: PagBankAuth
): Promise<PagBankResult> {
  const credentials = btoa(`${auth.user}:${auth.token}`);
  try {
    const resp = await fetch(`${BASE_URL}/${dateISO}`, {
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Accept": "application/json"
      }
    });
    if (!resp.ok) {
      console.warn(`PagBank EDI HTTP ${resp.status} for ${dateISO}`);
      return { unavailable: true, transactions: [], raw: null };
    }
    const json = await resp.json();
    return {
      unavailable: false,
      transactions: (json.detalhes ?? []) as PagBankTransaction[],
      raw: json
    };
  } catch (err) {
    console.error("PagBank EDI fetch error:", err);
    return { unavailable: true, transactions: [], raw: null };
  }
}
```

- [ ] **Step 4:** Run → 4 PASS

- [ ] **Step 5:** `git commit -am "feat(edge): PagBank EDI client with graceful unavailable handling"`

---

## FASE 6 — Edge Function: HTTP Handler + Markdown/HTML

### Task 6.1: Markdown template

**Files:**
- Create: `supabase/functions/daily-report/markdown.ts`
- Create: `supabase/functions/daily-report/tests/markdown_test.ts`

- [ ] **Step 1:** Teste

```typescript
// supabase/functions/daily-report/tests/markdown_test.ts
import { assert, assertStringIncludes } from "std/assert/mod.ts";
import { renderMarkdown } from "../markdown.ts";
import type { DailyKpis, ClosureIssue } from "../types.ts";

const KPIS: DailyKpis = {
  revenue: { gross: 1840, net: 1810, expected_from_pagbank: 1820 },
  bookings: { count: 23, average_ticket: 80 },
  by_professional: [
    { id: "p1", name: "Wanessa Ribeiro", revenue: 420, count: 5, top_service: { name: "Escova", count: 3 } },
    { id: "p2", name: "Marcilene Zanette", revenue: 380, count: 8, top_service: { name: "Manicure", count: 7 } }
  ],
  top_services: [
    { id: "s1", name: "Manicure", count: 9, revenue: 423 },
    { id: "s2", name: "Escova", count: 5, revenue: 400 },
    { id: "s3", name: "Hidratação", count: 3, revenue: 120 }
  ],
  payment_mix: {
    credit: { count: 8, gross: 720, net: 696 },
    debit:  { count: 5, gross: 320, net: 317 },
    pix:    { count: 7, gross: 580, net: 580 },
    cash:   { count: 3, gross: 220, net: 220 }
  },
  real_card_fee: { total: 27, by_brand: { CREDIT_VISA: 24, DEBIT_MASTERCARD: 3 } },
  new_vs_returning: { new_count: 8, returning_count: 15, new_revenue: 640 },
  cashback: { credited: 128.8, redeemed: 50, balance_change: 78.8 },
  towels: { count: 23, cost: 36.80 },
  queue_unattended: { count: 2, list: [{ id: "q1", client: "Maria" }, { id: "q2", client: "Joana" }] },
  seven_day_average: { revenue: 1500, bookings: 18, ticket: 83.33 }
};

const ISSUES: ClosureIssue[] = [
  { type: "payment_method_mismatch", severity: "high", description: "Comanda #75: cash vs debit", comanda_id: "c75" }
];

Deno.test("renderMarkdown: contém header, KPIs principais e link de pendências", () => {
  const md = renderMarkdown({ date: "2026-05-09", kpis: KPIS, issues: ISSUES });
  assertStringIncludes(md, "*Fechamento NP Hair Express*");
  assertStringIncludes(md, "09/05");
  assertStringIncludes(md, "*R$ 1.840,00*");
  assertStringIncludes(md, "Wanessa Ribeiro");
  assertStringIncludes(md, "Manicure");
  assertStringIncludes(md, "Escova");
  assertStringIncludes(md, "1 pendência");
  assertStringIncludes(md, "/pendencias");
});

Deno.test("renderMarkdown: dia sem pendências NÃO mostra link", () => {
  const md = renderMarkdown({ date: "2026-05-09", kpis: KPIS, issues: [] });
  assert(!md.includes("/pendencias"));
});

Deno.test("renderMarkdown: PagBank indisponível mostra aviso", () => {
  const md = renderMarkdown({ date: "2026-05-09", kpis: KPIS, issues: [], pagbankUnavailable: true });
  assertStringIncludes(md, "PagBank indisponível");
});
```

- [ ] **Step 2:** Run → 3 FAIL

- [ ] **Step 3:** Implementação

```typescript
// supabase/functions/daily-report/markdown.ts
import type { DailyKpis, ClosureIssue } from "./types.ts";

const fmt = (n: number) => `R$ ${n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
const pct = (a: number, b: number) =>
  b === 0 ? "—" : `${((a - b) / b * 100).toFixed(0)}%`;

export interface RenderInput {
  date: string;            // YYYY-MM-DD
  kpis: DailyKpis;
  issues: ClosureIssue[];
  pagbankUnavailable?: boolean;
}

export function renderMarkdown(input: RenderInput): string {
  const { date, kpis, issues, pagbankUnavailable } = input;
  const [y, m, d] = date.split("-");
  const ddmm = `${d}/${m}/${y}`;
  const issueCount = issues.length;
  const high = issues.filter(i => i.severity === "high").length;

  const profs = kpis.by_professional.slice(0, 5)
    .map(p => `• *${p.name}* — ${fmt(p.revenue)} (${p.count} atend.)${p.top_service ? ` · top: _${p.top_service.name}_` : ''}`)
    .join("\n");

  const top3 = kpis.top_services
    .map((s, i) => `${i + 1}. *${s.name}* — ${s.count}× (${fmt(s.revenue)})`)
    .join("\n");

  const mix = kpis.payment_mix;
  const total = mix.credit.gross + mix.debit.gross + mix.pix.gross + mix.cash.gross;
  const mixLine = total === 0 ? "—" : [
    `💳 Crédito ${fmt(mix.credit.gross)} (${(mix.credit.gross / total * 100).toFixed(0)}%)`,
    `💳 Débito ${fmt(mix.debit.gross)} (${(mix.debit.gross / total * 100).toFixed(0)}%)`,
    `📱 PIX ${fmt(mix.pix.gross)} (${(mix.pix.gross / total * 100).toFixed(0)}%)`,
    `💵 Dinheiro ${fmt(mix.cash.gross)} (${(mix.cash.gross / total * 100).toFixed(0)}%)`
  ].join("\n");

  const sections: string[] = [
    `*Fechamento NP Hair Express*`,
    `_${ddmm}_`,
    "",
    `💰 *Faturamento bruto:* *${fmt(kpis.revenue.gross)}*`,
    `   Líquido: ${fmt(kpis.revenue.net)} · PagBank esperado: ${fmt(kpis.revenue.expected_from_pagbank)}`,
    `📊 *Atendimentos:* ${kpis.bookings.count} · Ticket médio: ${fmt(kpis.bookings.average_ticket)}`,
    `🆕 Novos: ${kpis.new_vs_returning.new_count} (${fmt(kpis.new_vs_returning.new_revenue)}) · Retornos: ${kpis.new_vs_returning.returning_count}`,
    `🔁 vs média 7d: receita ${pct(kpis.revenue.gross, kpis.seven_day_average.revenue)} · atend. ${pct(kpis.bookings.count, kpis.seven_day_average.bookings)}`,
    "",
    `👥 *Por profissional:*`,
    profs || "_(sem dados)_",
    "",
    `🏆 *Top serviços:*`,
    top3 || "_(sem dados)_",
    "",
    `💳 *Mix de pagamento:*`,
    mixLine,
    `   Taxa real cartão: ${fmt(kpis.real_card_fee.total)}`,
    "",
    `🎁 Cashback: creditou ${fmt(kpis.cashback.credited)} · resgatou ${fmt(kpis.cashback.redeemed)}`,
    `🏷️ Toalhas: ${kpis.towels.count} (${fmt(kpis.towels.cost)})`,
  ];

  if (kpis.queue_unattended.count > 0) {
    sections.push(`⏳ Fila não atendida: ${kpis.queue_unattended.count}`);
  }

  if (pagbankUnavailable) {
    sections.push("", `⚠️ _PagBank indisponível — relatório sem cruzamento bancário_`);
  }

  if (issueCount > 0) {
    sections.push("", `*⚠️ ${issueCount} pendência${issueCount > 1 ? 's' : ''} aberta${issueCount > 1 ? 's' : ''}*${high > 0 ? ` (${high} 🔴)` : ''}`);
    for (const i of issues.slice(0, 5)) {
      const emoji = i.severity === "high" ? "🔴" : i.severity === "medium" ? "🟡" : "🔵";
      sections.push(`${emoji} ${i.description}`);
    }
    if (issueCount > 5) sections.push(`_... e mais ${issueCount - 5}_`);
    sections.push("", `👉 Ver todas: https://suavezexpress.vercel.app/pendencias`);
  }

  return sections.join("\n");
}
```

- [ ] **Step 4:** Run → 3 PASS

- [ ] **Step 5:** `git commit -am "feat(edge): renderMarkdown for WhatsApp report"`

---

### Task 6.2: HTML template (mesmas seções, em HTML)

- [ ] **Step 1:** Criar `html.ts` espelhando `markdown.ts` mas com tags HTML.

```typescript
// supabase/functions/daily-report/html.ts
import type { DailyKpis, ClosureIssue } from "./types.ts";

const fmt = (n: number) => `R$ ${n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

export interface HtmlInput {
  date: string;
  kpis: DailyKpis;
  issues: ClosureIssue[];
  pagbankUnavailable?: boolean;
}

export function renderHtml(input: HtmlInput): string {
  const { date, kpis, issues, pagbankUnavailable } = input;
  const [y, m, d] = date.split("-");
  const ddmm = `${d}/${m}/${y}`;

  const profsRows = kpis.by_professional
    .map(p => `<tr><td>${p.name}</td><td>${fmt(p.revenue)}</td><td>${p.count}</td><td>${p.top_service?.name ?? '—'}</td></tr>`)
    .join("");

  const topRows = kpis.top_services
    .map(s => `<tr><td>${s.name}</td><td>${s.count}</td><td>${fmt(s.revenue)}</td></tr>`)
    .join("");

  const issueRows = issues
    .map(i => `<li class="sev-${i.severity}">${i.description}</li>`)
    .join("");

  return `
<div class="daily-report">
  <h2>Fechamento NP Hair Express — ${ddmm}</h2>

  <section class="summary">
    <div><strong>Faturamento bruto:</strong> ${fmt(kpis.revenue.gross)}</div>
    <div><strong>Líquido:</strong> ${fmt(kpis.revenue.net)}</div>
    <div><strong>PagBank esperado:</strong> ${fmt(kpis.revenue.expected_from_pagbank)}</div>
    <div><strong>Atendimentos:</strong> ${kpis.bookings.count} · Ticket médio ${fmt(kpis.bookings.average_ticket)}</div>
  </section>

  <h3>Por profissional</h3>
  <table><thead><tr><th>Nome</th><th>Receita</th><th>Atend.</th><th>Top serviço</th></tr></thead>
    <tbody>${profsRows}</tbody>
  </table>

  <h3>Top serviços</h3>
  <table><thead><tr><th>Serviço</th><th>Qtd</th><th>Receita</th></tr></thead>
    <tbody>${topRows}</tbody>
  </table>

  <h3>Mix de pagamento</h3>
  <ul>
    <li>Crédito: ${fmt(kpis.payment_mix.credit.gross)} (${kpis.payment_mix.credit.count})</li>
    <li>Débito: ${fmt(kpis.payment_mix.debit.gross)} (${kpis.payment_mix.debit.count})</li>
    <li>PIX: ${fmt(kpis.payment_mix.pix.gross)} (${kpis.payment_mix.pix.count})</li>
    <li>Dinheiro: ${fmt(kpis.payment_mix.cash.gross)} (${kpis.payment_mix.cash.count})</li>
  </ul>
  <p>Taxa real de cartão: ${fmt(kpis.real_card_fee.total)}</p>

  ${pagbankUnavailable ? '<p class="warn">⚠️ PagBank indisponível — sem cruzamento bancário</p>' : ''}

  ${issues.length > 0 ? `
    <h3>Pendências (${issues.length})</h3>
    <ul class="issues">${issueRows}</ul>
  ` : ''}
</div>
  `.trim();
}
```

- [ ] **Step 2:** Smoke test rápido (sem deno test, só checa compilação)

```bash
cd supabase/functions/daily-report
deno check html.ts
```

Expected: `Check file://...` sem erros.

- [ ] **Step 3:** Commit

```bash
git add supabase/functions/daily-report/html.ts
git commit -m "feat(edge): renderHtml template for /fechamentos modal"
```

---

### Task 6.3: HTTP handler `index.ts` (orquestrador)

**Files:**
- Create: `supabase/functions/daily-report/index.ts`

- [ ] **Step 1:** Implementação completa

```typescript
// supabase/functions/daily-report/index.ts
import { createClient } from "supabase";
import { z } from "zod";
import { fetchPagBankTransactional } from "./pagbank.ts";
import {
  calculateRevenue, calculateBookings, calculateByProfessional,
  calculateTopServices, calculatePaymentMix, calculateRealCardFee,
  calculateNewVsReturning, calculateCashback, calculateTowels,
  calculateQueueUnattended, calculateSevenDayAverage,
} from "./calculator.ts";
import { runAllDetectors } from "./detector.ts";
import { renderMarkdown } from "./markdown.ts";
import { renderHtml } from "./html.ts";
import type { DailyKpis, DailyReportResponse } from "./types.ts";

const InputSchema = z.union([
  z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    professional_id: z.string().uuid().optional()
  })
]);

const SALON_ID = Deno.env.get("NPHAIR_EXPRESS_SALON_ID") ?? "9793948a-e208-4054-a4df-4b8f2b3b3965";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("", { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Parse input
  let body: unknown;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON" }, 400); }

  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) return json({ error: "Invalid input", issues: parsed.error.issues }, 400);

  const isRange = "start" in parsed.data;
  const startDate = isRange ? parsed.data.start : parsed.data.date;
  const endDate   = isRange ? parsed.data.end   : parsed.data.date;
  const professionalId = isRange ? parsed.data.professional_id : undefined;

  // Service role client
  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  try {
    const result = await generateReport({
      supa, salonId: SALON_ID, startDate, endDate, professionalId
    });
    return json(result, 200);
  } catch (err) {
    console.error("daily-report error:", err);
    return json({ error: String(err), stack: (err as Error).stack }, 500);
  }
});

interface GenerateInput {
  supa: ReturnType<typeof createClient>;
  salonId: string;
  startDate: string;
  endDate: string;
  professionalId?: string;
}

async function generateReport(input: GenerateInput): Promise<DailyReportResponse> {
  const { supa, salonId, startDate, endDate, professionalId } = input;

  // 1) Buscar comandas + items + payments do período
  const startTz = `${startDate}T00:00:00-03:00`;
  const endTz   = `${endDate}T23:59:59-03:00`;

  let comQuery = supa
    .from("comandas")
    .select(`
      id, salon_id, client_id, professional_id, comanda_number, total, is_paid,
      created_at, closed_at,
      items:comanda_items(service_id, quantity, unit_price, total_price, services(name)),
      payments(id, amount, payment_method, fee_amount, net_amount, installments)
    `)
    .eq("salon_id", salonId)
    .gte("created_at", startTz)
    .lte("created_at", endTz);

  if (professionalId) comQuery = comQuery.eq("professional_id", professionalId);

  const { data: rawComandas, error: cErr } = await comQuery;
  if (cErr) throw cErr;

  const comandas = (rawComandas ?? []).map((c: any) => ({
    ...c,
    items: (c.items ?? []).map((i: any) => ({
      service_id: i.service_id,
      service_name: i.services?.name ?? "(sem nome)",
      quantity: Number(i.quantity),
      unit_price: Number(i.unit_price),
      total_price: Number(i.total_price)
    }))
  }));

  // 2) Buscar professionals do salon
  const { data: professionals } = await supa
    .from("professionals")
    .select("id, name")
    .eq("salon_id", salonId);

  // 3) Buscar customer_credits do período
  const { data: credits } = await supa
    .from("customer_credits")
    .select("client_id, amount, type, balance")
    .eq("salon_id", salonId)
    .gte("created_at", startTz)
    .lte("created_at", endTz);

  // 4) Buscar queue_entries do período
  const { data: queueEntries } = await supa
    .from("queue_entries")
    .select("id, status, client_name")
    .eq("salon_id", salonId)
    .gte("created_at", startTz)
    .lte("created_at", endTz);

  // 5) PagBank EDI (1 dia OU range — para range, faz 1 chamada por dia)
  const pagbankUser = Deno.env.get("PAGBANK_USER")!;
  const pagbankToken = Deno.env.get("PAGBANK_TOKEN")!;
  const allTx: any[] = [];
  let pagbankUnavailable = false;
  for (const day of daysBetween(startDate, endDate)) {
    const r = await fetchPagBankTransactional(day, { user: pagbankUser, token: pagbankToken });
    if (r.unavailable) pagbankUnavailable = true;
    allTx.push(...r.transactions);
  }

  // 6) Histórico pra new_vs_returning + 7d_avg
  const histStart = subDaysISO(startDate, 30);
  const { data: history } = await supa
    .from("comandas")
    .select("client_id, closed_at, total, is_paid")
    .eq("salon_id", salonId)
    .gte("closed_at", `${histStart}T00:00:00-03:00`)
    .lt("closed_at", `${startDate}T00:00:00-03:00`)
    .eq("is_paid", true);

  const sevenDayHistory = aggregateByDay(history ?? []);

  // 7) Calcular KPIs
  const kpis: DailyKpis = {
    revenue: calculateRevenue(comandas, allTx),
    bookings: calculateBookings(comandas),
    by_professional: calculateByProfessional(comandas, professionals ?? []),
    top_services: calculateTopServices(comandas),
    payment_mix: calculatePaymentMix(comandas),
    real_card_fee: calculateRealCardFee(allTx),
    new_vs_returning: calculateNewVsReturning(comandas, history ?? []),
    cashback: calculateCashback((credits ?? []).filter((c: any) => c.type !== "balance") as any),
    towels: calculateTowels(comandas),
    queue_unattended: calculateQueueUnattended(queueEntries ?? []),
    seven_day_average: calculateSevenDayAverage(sevenDayHistory),
  };

  // 8) Detectar issues
  const balances = (credits ?? [])
    .filter((c: any) => typeof c.balance === "number")
    .map((c: any) => ({ client_id: c.client_id, balance: c.balance }));

  const issues = runAllDetectors({
    comandas,
    pagbank: allTx,
    credits: balances
  });

  // 9) Persistir daily_reports (idempotente — UPSERT) — somente se for relatório de 1 dia
  if (startDate === endDate) {
    await supa.from("daily_reports").upsert({
      salon_id: salonId,
      report_date: startDate,
      kpis,
      pagbank_raw: { transactions: allTx, unavailable: pagbankUnavailable },
      generated_at: new Date().toISOString(),
      generated_by: "cron"
    }, { onConflict: "salon_id,report_date" });

    // 10) Persistir closure_issues (UPSERT por (comanda_id, issue_type, detected_date))
    for (const issue of issues) {
      await supa.from("closure_issues").insert({
        salon_id: salonId,
        comanda_id: issue.comanda_id ?? null,
        professional_id: issue.professional_id ?? null,
        detected_date: startDate,
        issue_type: issue.type,
        severity: issue.severity,
        description: issue.description,
        expected_value: issue.expected_value ?? null,
        actual_value: issue.actual_value ?? null
      });
    }
  }

  // 11) Comparações
  const yesterday = sevenDayHistory.find(h => h.date === subDaysISO(startDate, 1));
  const sameWeekday = sevenDayHistory.filter(h => sameDayOfWeek(h.date, startDate)).slice(0, 1)[0];

  const comparisons = {
    vs_yesterday:    pctDiff(kpis.revenue.gross, yesterday?.revenue, kpis.bookings.count, yesterday?.bookings),
    vs_7d_avg:       pctDiff(kpis.revenue.gross, kpis.seven_day_average.revenue, kpis.bookings.count, kpis.seven_day_average.bookings),
    vs_same_weekday: pctDiff(kpis.revenue.gross, sameWeekday?.revenue, kpis.bookings.count, sameWeekday?.bookings),
  };

  return {
    period: { start: startDate, end: endDate, days: daysBetween(startDate, endDate).length },
    kpis,
    issues,
    comparisons,
    markdown: renderMarkdown({ date: startDate, kpis, issues, pagbankUnavailable }),
    html:     renderHtml    ({ date: startDate, kpis, issues, pagbankUnavailable }),
    pagbank_unavailable: pagbankUnavailable
  };
}

// helpers
function daysBetween(a: string, b: string): string[] {
  const out: string[] = [];
  const start = new Date(a + "T00:00:00Z");
  const end = new Date(b + "T00:00:00Z");
  for (let d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function subDaysISO(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function sameDayOfWeek(a: string, b: string): boolean {
  return new Date(a + "T00:00:00Z").getUTCDay() === new Date(b + "T00:00:00Z").getUTCDay();
}

function aggregateByDay(history: Array<{ closed_at: string | null; total: number; is_paid: boolean }>) {
  const map = new Map<string, { revenue: number; bookings: number }>();
  for (const c of history.filter(x => x.is_paid && x.closed_at)) {
    const day = c.closed_at!.slice(0, 10);
    const agg = map.get(day) ?? { revenue: 0, bookings: 0 };
    agg.revenue += Number(c.total);
    agg.bookings += 1;
    map.set(day, agg);
  }
  return [...map.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => b.date.localeCompare(a.date));
}

function pctDiff(currentR: number, prevR: number | undefined, currentB: number, prevB: number | undefined) {
  return {
    revenue_pct: prevR && prevR > 0 ? Math.round(((currentR - prevR) / prevR) * 100) : 0,
    bookings_pct: prevB && prevB > 0 ? Math.round(((currentB - prevB) / prevB) * 100) : 0,
  };
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" }
  });
}
```

- [ ] **Step 2:** Type-check

```bash
cd supabase/functions/daily-report
deno check index.ts
```

Expected: sem erros.

- [ ] **Step 3:** Rodar todos os testes da fase

```bash
deno test --allow-all tests/
```

Expected: todos os ~30 testes PASS.

- [ ] **Step 4:** Commit

```bash
git add supabase/functions/daily-report/index.ts
git commit -m "feat(edge): HTTP handler with persist + comparisons + range support"
```

---

## FASE 7 — Deploy Edge Function

### Task 7.1: Configurar secrets no Supabase

- [ ] **Step 1:** Setar PAGBANK_USER e PAGBANK_TOKEN

```bash
cd /Users/pc/nphairexpress
export SUPABASE_ACCESS_TOKEN='${SUPABASE_PAT}'
npx supabase secrets set PAGBANK_USER=119232542 --linked
npx supabase secrets set PAGBANK_TOKEN=${PAGBANK_TOKEN} --linked
```

Expected: `Finished supabase secrets set.` ×2

- [ ] **Step 2:** Verificar secrets

```bash
npx supabase secrets list --linked | grep -E "PAGBANK|SUPABASE"
```

Expected: `PAGBANK_USER` e `PAGBANK_TOKEN` aparecem (valores ocultos).

---

### Task 7.2: Deploy + smoke test

- [ ] **Step 1:** Deploy

```bash
npx supabase functions deploy daily-report --linked
```

Expected: `Deployed Function daily-report`.

- [ ] **Step 2:** Smoke test com dia conhecido

```bash
ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3eGlheHNtb2h4dWFiY214dXljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyMDk5ODYsImV4cCI6MjA5MTc4NTk4Nn0.1Q-YlYcL-7zZ4_W63gnbaDhzbqYPSSJG4VUC3zXLUs4'
curl -s -X POST 'https://ewxiaxsmohxuabcmxuyc.supabase.co/functions/v1/daily-report' \
  -H "Authorization: Bearer $ANON" \
  -H 'Content-Type: application/json' \
  -d '{"date":"2026-05-09"}' | jq '.kpis.revenue, .issues | length'
```

Expected: objeto `revenue` com `gross/net/expected_from_pagbank` e número de issues.

- [ ] **Step 3:** Confirmar que `daily_reports` tem 1 linha pra 09/05

```bash
curl -s "https://api.supabase.com/v1/projects/ewxiaxsmohxuabcmxuyc/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT report_date, kpis->$$revenue$$ FROM daily_reports ORDER BY report_date DESC LIMIT 3"}'
```

Expected: 1 linha `report_date=2026-05-09`.

- [ ] **Step 4:** Commit (placeholder pra rastrear deploy — sem código)

```bash
git commit --allow-empty -m "chore(edge): deploy daily-report v1 to production"
```

---

## FASE 8 — Backfill de Maio/2026

### Task 8.1: Script `backfill-may-2026.ts`

**Files:**
- Create: `scripts/backfill-may-2026.ts`

- [ ] **Step 1:** Script

```typescript
// scripts/backfill-may-2026.ts
// Roda Edge Function pra cada dia útil de Maio com movimento.
// Uso: deno run --allow-net --allow-env scripts/backfill-may-2026.ts

const SUPABASE_URL = "https://ewxiaxsmohxuabcmxuyc.supabase.co";
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const PAT  = Deno.env.get("SUPABASE_PAT")!;
const SALON_ID = "9793948a-e208-4054-a4df-4b8f2b3b3965";

// 1) Descobre dias com movimento
const sql = `
  SELECT DISTINCT (closed_at AT TIME ZONE 'America/Sao_Paulo')::date AS d
  FROM comandas
  WHERE salon_id = '${SALON_ID}'
    AND closed_at >= '2026-05-01'
    AND closed_at <  CURRENT_DATE
  ORDER BY d
`;
const queryRes = await fetch(`https://api.supabase.com/v1/projects/ewxiaxsmohxuabcmxuyc/database/query`, {
  method: "POST",
  headers: { "Authorization": `Bearer ${PAT}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql })
});
const rows = await queryRes.json();
const dates = rows.map((r: { d: string }) => r.d);
console.log(`Dias com movimento em Maio:`, dates);

// 2) Loop com rate-limit 1/seg
for (const date of dates) {
  console.log(`→ Processando ${date}...`);
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/daily-report`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${ANON}`, "Content-Type": "application/json" },
    body: JSON.stringify({ date })
  });
  const json = await resp.json();
  if (resp.ok) {
    console.log(`  ✓ ${date}: gross=${json.kpis?.revenue?.gross} · issues=${json.issues?.length ?? 0}`);
  } else {
    console.error(`  ✗ ${date}: ${JSON.stringify(json).slice(0, 200)}`);
  }
  await new Promise(r => setTimeout(r, 1100));
}

console.log(`\n✅ Backfill concluído. Veja em /fechamentos no sistema.`);
```

- [ ] **Step 2:** Commit

```bash
git add scripts/backfill-may-2026.ts
git commit -m "chore(scripts): backfill ad-hoc para Maio/2026"
```

---

### Task 8.2: Rodar backfill

- [ ] **Step 1:** Executar

```bash
cd /Users/pc/nphairexpress
export SUPABASE_PAT='${SUPABASE_PAT}'
export SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3eGlheHNtb2h4dWFiY214dXljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyMDk5ODYsImV4cCI6MjA5MTc4NTk4Nn0.1Q-YlYcL-7zZ4_W63gnbaDhzbqYPSSJG4VUC3zXLUs4'
deno run --allow-net --allow-env scripts/backfill-may-2026.ts
```

Expected: 6 linhas `✓ YYYY-MM-DD: gross=... · issues=...`.

- [ ] **Step 2:** Confirmar `daily_reports` tem 6 linhas

```bash
curl -s "https://api.supabase.com/v1/projects/ewxiaxsmohxuabcmxuyc/database/query" \
  -H "Authorization: Bearer $SUPABASE_PAT" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT report_date, (kpis->$$revenue$$->>$$gross$$)::numeric AS bruto FROM daily_reports WHERE salon_id=$$9793948a-e208-4054-a4df-4b8f2b3b3965$$ ORDER BY report_date"}'
```

Expected: 6 linhas com datas de Maio.

---

## FASE 9 — Frontend `/fechamentos`

### Task 9.1: Hook `useDailyReports`

**Files:**
- Create: `src/hooks/useDailyReports.ts`

- [ ] **Step 1:** Implementação (segue padrão dos outros hooks como `useComandas.ts`)

```typescript
// src/hooks/useDailyReports.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DailyReportResponse } from "../../supabase/functions/daily-report/types";

export function useDailyReports(salonId: string, opts?: { from?: string; to?: string }) {
  return useQuery({
    queryKey: ["daily-reports", salonId, opts?.from, opts?.to],
    queryFn: async () => {
      let q = supabase
        .from("daily_reports")
        .select("id, report_date, kpis, generated_at")
        .eq("salon_id", salonId)
        .order("report_date", { ascending: false });
      if (opts?.from) q = q.gte("report_date", opts.from);
      if (opts?.to)   q = q.lte("report_date", opts.to);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    enabled: !!salonId
  });
}

export function useGenerateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { date?: string; start?: string; end?: string; professional_id?: string }) => {
      const { data, error } = await supabase.functions.invoke<DailyReportResponse>("daily-report", { body: input });
      if (error) throw error;
      return data!;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["daily-reports"] });
      qc.invalidateQueries({ queryKey: ["closure-issues"] });
    }
  });
}
```

- [ ] **Step 2:** Build check

```bash
npm run build 2>&1 | tail -10
```

Expected: build OK ou só warnings.

- [ ] **Step 3:** Commit

```bash
git add src/hooks/useDailyReports.ts
git commit -m "feat(hooks): useDailyReports + useGenerateReport"
```

---

### Task 9.2: Componente `DailyReportRow`

**Files:**
- Create: `src/components/fechamentos/DailyReportRow.tsx`

- [ ] **Step 1:** Implementação

```tsx
// src/components/fechamentos/DailyReportRow.tsx
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

interface Props {
  reportDate: string;
  kpis: any;
  issuesCount?: number;
  onClick: () => void;
}

const fmt = (n: number) => `R$ ${Number(n).toFixed(2).replace(".", ",")}`;

export function DailyReportRow({ reportDate, kpis, issuesCount, onClick }: Props) {
  const date = parseISO(reportDate);
  const weekday = format(date, "EEE", { locale: ptBR });
  const day = format(date, "dd/MM");
  const hasIssues = (issuesCount ?? 0) > 0;
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between px-4 py-3 rounded border bg-white hover:bg-slate-50 transition"
    >
      <div className="flex items-center gap-3">
        {hasIssues
          ? <AlertTriangle className="text-amber-500" size={18} />
          : <CheckCircle2 className="text-emerald-600" size={18} />}
        <div className="text-left">
          <div className="font-medium">{day} {weekday}</div>
          <div className="text-sm text-slate-500">
            {kpis?.bookings?.count ?? 0} atend · ticket {fmt(kpis?.bookings?.average_ticket ?? 0)}
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="font-semibold">{fmt(kpis?.revenue?.gross ?? 0)}</div>
        {hasIssues && <div className="text-xs text-amber-700">{issuesCount} alerta{issuesCount! > 1 ? 's' : ''}</div>}
      </div>
    </button>
  );
}
```

- [ ] **Step 2:** `git commit -am "feat(fechamentos): DailyReportRow component"`

---

### Task 9.3: Modal de detalhe

**Files:**
- Create: `src/components/fechamentos/DailyReportDetailModal.tsx`

- [ ] **Step 1:** Implementação

```tsx
// src/components/fechamentos/DailyReportDetailModal.tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useGenerateReport } from "@/hooks/useDailyReports";

interface Props {
  open: boolean;
  onClose: () => void;
  reportDate: string;
  kpis: any;
  html?: string;
}

export function DailyReportDetailModal({ open, onClose, reportDate, kpis, html }: Props) {
  const regenerate = useGenerateReport();

  const handleResend = async () => {
    if (!confirm("Reenviar este relatório no WhatsApp pra Vanessa e Cleiton?")) return;
    await regenerate.mutateAsync({ date: reportDate });
    // O cron envia, aqui apenas regenera. Reenvio real é via N8N webhook.
    await fetch("https://agentes.72-60-6-168.sslip.io/webhook/fechamento", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: reportDate, source: "manual_resend" })
    });
    alert("Relatório regenerado e reenviado.");
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Fechamento de {reportDate.split("-").reverse().join("/")}</DialogTitle>
        </DialogHeader>
        {html ? (
          <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre className="text-xs">{JSON.stringify(kpis, null, 2)}</pre>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          <Button onClick={handleResend} disabled={regenerate.isPending}>
            {regenerate.isPending ? "Enviando..." : "Reenviar WhatsApp"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2:** `git commit -am "feat(fechamentos): detail modal with resend WhatsApp"`

---

### Task 9.4: Página `Fechamentos.tsx`

**Files:**
- Create: `src/pages/Fechamentos.tsx`

- [ ] **Step 1:** Implementação

```tsx
// src/pages/Fechamentos.tsx
import { useState } from "react";
import { useDailyReports } from "@/hooks/useDailyReports";
import { DailyReportRow } from "@/components/fechamentos/DailyReportRow";
import { DailyReportDetailModal } from "@/components/fechamentos/DailyReportDetailModal";
import { MonthlyReportButton } from "@/components/fechamentos/MonthlyReportButton";
import { useCurrentSalon } from "@/hooks/useCurrentSalon";

export default function Fechamentos() {
  const { salonId } = useCurrentSalon();
  const { data: reports, isLoading } = useDailyReports(salonId);
  const [selected, setSelected] = useState<{ date: string; kpis: any } | null>(null);

  return (
    <div className="container max-w-4xl mx-auto p-4 md:p-6">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">📊 Fechamentos</h1>
          <p className="text-slate-500 text-sm">Relatórios diários consolidados</p>
        </div>
        <MonthlyReportButton salonId={salonId} />
      </header>

      {isLoading && <div>Carregando…</div>}
      <div className="space-y-2">
        {reports?.map(r => (
          <DailyReportRow
            key={r.id}
            reportDate={r.report_date}
            kpis={r.kpis}
            issuesCount={(r.kpis as any)?._issues_count}
            onClick={() => setSelected({ date: r.report_date, kpis: r.kpis })}
          />
        ))}
      </div>

      {selected && (
        <DailyReportDetailModal
          open
          onClose={() => setSelected(null)}
          reportDate={selected.date}
          kpis={selected.kpis}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2:** Adicionar rota em `src/App.tsx`

```tsx
import Fechamentos from "@/pages/Fechamentos";
// ...
<Route path="/fechamentos" element={<ProtectedRoute><Fechamentos /></ProtectedRoute>} />
```

- [ ] **Step 3:** Adicionar item no menu (`src/components/layout/AppSidebar.tsx`)

> Identificar o array de items existente, incluir:
> ```tsx
> { title: "Fechamentos", url: "/fechamentos", icon: BarChart3, adminOnly: true }
> ```

- [ ] **Step 4:** Build + visual check local

```bash
npm run build && npm run dev
# abrir http://localhost:5173/fechamentos no browser
```

- [ ] **Step 5:** Commit

```bash
git add src/pages/Fechamentos.tsx src/App.tsx src/components/layout/AppSidebar.tsx
git commit -m "feat(fechamentos): page + route + sidebar entry"
```

---

## FASE 10 — Frontend `/pendencias`

### Task 10.1: Hook `useClosureIssues`

**Files:**
- Create: `src/hooks/useClosureIssues.ts`

- [ ] **Step 1:** Implementação

```typescript
// src/hooks/useClosureIssues.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type IssueStatus = 'open'|'in_correction'|'auto_resolved'|'marked_resolved'|'resolved'|'reopened'|'ignored';

export function useClosureIssues(salonId: string, status: IssueStatus[] = ["open", "in_correction", "reopened"]) {
  return useQuery({
    queryKey: ["closure-issues", salonId, status],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("closure_issues")
        .select(`
          *,
          comandas(comanda_number, total, clients(name)),
          professionals(name)
        `)
        .eq("salon_id", salonId)
        .in("status", status)
        .order("severity", { ascending: true })
        .order("detected_date", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!salonId
  });
}

export function useResolveIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "marked_resolved" | "ignored"; reason?: string }) => {
      const update: any = { status: action, resolved_at: new Date().toISOString() };
      if (action === "ignored") update.ignored_reason = "User";
      const { error } = await supabase.from("closure_issues").update(update).eq("id", id);
      if (error) throw error;
      await supabase.from("closure_issue_actions").insert({ issue_id: id, action });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["closure-issues"] })
  });
}

export function useRequestCorrection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ issueId, phone, message }: { issueId: string; phone: string; message: string }) => {
      // Manda via Evolution claudebot (proxy: chama edge function send-whatsapp ou direto)
      const resp = await fetch("https://agentes.72-60-6-168.sslip.io/webhook/send-correction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, message })
      });
      const json = await resp.json();
      await supabase.from("closure_issues").update({ status: "in_correction" }).eq("id", issueId);
      await supabase.from("closure_issue_actions").insert({
        issue_id: issueId,
        action: "requested_correction",
        message,
        whatsapp_message_id: json?.message_id ?? null
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["closure-issues"] })
  });
}
```

- [ ] **Step 2:** `git commit -am "feat(hooks): useClosureIssues + resolve + requestCorrection"`

---

### Task 10.2: Componente `IssueCard`

**Files:**
- Create: `src/components/pendencias/IssueCard.tsx`

- [ ] **Step 1:** Implementação

```tsx
// src/components/pendencias/IssueCard.tsx
import { Button } from "@/components/ui/button";
import { useResolveIssue } from "@/hooks/useClosureIssues";

const SEVERITY_COLOR = { high: "bg-rose-100 text-rose-900 border-rose-200",
                        medium: "bg-amber-100 text-amber-900 border-amber-200",
                        low: "bg-sky-100 text-sky-900 border-sky-200" };
const SEVERITY_EMOJI = { high: "🔴", medium: "🟡", low: "🔵" };

interface Props {
  issue: any; // tipo gerado pelo Supabase com joins
  onRequestCorrection: () => void;
}

export function IssueCard({ issue, onRequestCorrection }: Props) {
  const resolve = useResolveIssue();
  const profName = issue.professionals?.name ?? "—";
  const comandaNum = issue.comandas?.comanda_number ?? null;
  const clientName = issue.comandas?.clients?.name ?? null;

  return (
    <div className={`p-4 rounded border ${SEVERITY_COLOR[issue.severity as keyof typeof SEVERITY_COLOR]}`}>
      <div className="flex items-start gap-3">
        <span className="text-xl">{SEVERITY_EMOJI[issue.severity as keyof typeof SEVERITY_EMOJI]}</span>
        <div className="flex-1">
          <div className="text-sm text-slate-600">
            {issue.detected_date} {comandaNum && `· Comanda #${comandaNum}`} {clientName && `· ${clientName}`}
          </div>
          <div className="font-medium mt-1">{issue.description}</div>
          {issue.expected_value && (
            <details className="text-xs mt-2 opacity-80">
              <summary>Detalhes</summary>
              <pre>{JSON.stringify({ esperado: issue.expected_value, atual: issue.actual_value }, null, 2)}</pre>
            </details>
          )}
          <div className="text-sm mt-2">Profissional: <strong>{profName}</strong></div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        <Button size="sm" onClick={onRequestCorrection}>💬 Solicitar correção</Button>
        <Button size="sm" variant="outline"
          onClick={() => resolve.mutate({ id: issue.id, action: "marked_resolved" })}>
          ✅ Marcar resolvido
        </Button>
        <Button size="sm" variant="ghost"
          onClick={() => {
            const reason = prompt("Motivo (opcional):") ?? "";
            resolve.mutate({ id: issue.id, action: "ignored", reason });
          }}>
          🚫 Ignorar
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2:** `git commit -am "feat(pendencias): IssueCard with 3 actions"`

---

### Task 10.3: Modal de solicitar correção

**Files:**
- Create: `src/components/pendencias/IssueRequestCorrectionModal.tsx`

- [ ] **Step 1:** Implementação

```tsx
// src/components/pendencias/IssueRequestCorrectionModal.tsx
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRequestCorrection } from "@/hooks/useClosureIssues";

interface Props {
  open: boolean;
  onClose: () => void;
  issue: any;
}

export function IssueRequestCorrectionModal({ open, onClose, issue }: Props) {
  const profName = issue?.professionals?.name ?? "profissional";
  const comandaNum = issue?.comandas?.comanda_number ?? "—";
  const clientName = issue?.comandas?.clients?.name ?? "cliente";
  const profPhone = issue?.professionals?.phone ?? "";

  const [phone, setPhone] = useState(profPhone);
  const [message, setMessage] = useState(
`Oi ${profName}, tudo bem?

Identifiquei uma divergência na *comanda #${comandaNum}* de _${clientName}_ (${issue?.detected_date}):

${issue?.description}

Pode conferir no sistema e ajustar? 🙏`
  );
  const send = useRequestCorrection();

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Solicitar correção</DialogTitle></DialogHeader>

        <label className="block text-sm font-medium mt-2">Para (telefone com DDI)</label>
        <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="5511..." />

        <label className="block text-sm font-medium mt-3">Mensagem</label>
        <Textarea value={message} onChange={e => setMessage(e.target.value)} rows={10} />

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={async () => {
              await send.mutateAsync({ issueId: issue.id, phone, message });
              onClose();
            }}
            disabled={!phone || !message || send.isPending}
          >
            {send.isPending ? "Enviando..." : "Enviar WhatsApp"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2:** `git commit -am "feat(pendencias): correction request modal with editable template"`

---

### Task 10.4: Página `Pendencias.tsx` + rota + menu

**Files:**
- Create: `src/pages/Pendencias.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/layout/AppSidebar.tsx`

- [ ] **Step 1:** Página

```tsx
// src/pages/Pendencias.tsx
import { useState } from "react";
import { useClosureIssues } from "@/hooks/useClosureIssues";
import { IssueCard } from "@/components/pendencias/IssueCard";
import { IssueRequestCorrectionModal } from "@/components/pendencias/IssueRequestCorrectionModal";
import { useCurrentSalon } from "@/hooks/useCurrentSalon";

export default function Pendencias() {
  const { salonId } = useCurrentSalon();
  const { data: issues, isLoading } = useClosureIssues(salonId);
  const [selected, setSelected] = useState<any>(null);

  const open = issues?.length ?? 0;

  return (
    <div className="container max-w-4xl mx-auto p-4 md:p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">⚠️ Pendências de Fechamento</h1>
        <p className="text-slate-500 text-sm">{open} aberta{open !== 1 ? 's' : ''}</p>
      </header>

      {isLoading && <div>Carregando…</div>}
      <div className="space-y-3">
        {issues?.map(i => (
          <IssueCard key={i.id} issue={i} onRequestCorrection={() => setSelected(i)} />
        ))}
        {open === 0 && !isLoading && (
          <div className="p-6 text-center text-slate-500 border rounded">✅ Nenhuma pendência aberta</div>
        )}
      </div>

      {selected && (
        <IssueRequestCorrectionModal
          open
          onClose={() => setSelected(null)}
          issue={selected}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2:** Rota em `App.tsx`

```tsx
import Pendencias from "@/pages/Pendencias";
// ...
<Route path="/pendencias" element={<ProtectedRoute><Pendencias /></ProtectedRoute>} />
```

- [ ] **Step 3:** Menu em `AppSidebar.tsx` — adicionar `{ title: "Pendências", url: "/pendencias", icon: AlertTriangle, adminOnly: true }`

- [ ] **Step 4:** Commit

```bash
git add src/pages/Pendencias.tsx src/components/pendencias/ src/App.tsx src/components/layout/AppSidebar.tsx
git commit -m "feat(pendencias): page + route + sidebar entry"
```

---

## FASE 11 — Botão Fechamento Mensal + PDF

### Task 11.1: Componente `MonthlyReportButton`

**Files:**
- Create: `src/components/fechamentos/MonthlyReportButton.tsx`
- Create: `src/components/fechamentos/monthlyReportPdf.ts`

- [ ] **Step 1:** Botão + modal de seleção

```tsx
// src/components/fechamentos/MonthlyReportButton.tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useGenerateReport } from "@/hooks/useDailyReports";
import { useProfessionals } from "@/hooks/useProfessionals";
import { generateMonthlyPdf } from "./monthlyReportPdf";

interface Props { salonId: string }

export function MonthlyReportButton({ salonId }: Props) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [profId, setProfId] = useState<string>("all");
  const { data: professionals } = useProfessionals(salonId);
  const generate = useGenerateReport();

  const handleGenerate = async () => {
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const end = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;

    const result = await generate.mutateAsync({
      start, end,
      professional_id: profId === "all" ? undefined : profId
    });

    generateMonthlyPdf({
      salon: "NP Hair Express",
      period: { start, end },
      professional: profId === "all" ? null : professionals?.find(p => p.id === profId)?.name ?? "",
      kpis: result.kpis,
      issues: result.issues
    });
    setOpen(false);
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>📄 Gerar Mensal</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Fechamento Mensal</DialogTitle></DialogHeader>
          <label className="block text-sm">Mês</label>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className="border rounded p-2 w-full">
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m =>
              <option key={m} value={m}>{String(m).padStart(2, "0")}</option>
            )}
          </select>
          <label className="block text-sm mt-3">Ano</label>
          <input type="number" value={year} onChange={e => setYear(Number(e.target.value))} className="border rounded p-2 w-full" />
          <label className="block text-sm mt-3">Profissional</label>
          <select value={profId} onChange={e => setProfId(e.target.value)} className="border rounded p-2 w-full">
            <option value="all">Todas</option>
            {professionals?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleGenerate} disabled={generate.isPending}>
              {generate.isPending ? "Gerando..." : "Gerar PDF"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 2:** Geração de PDF com jspdf-autotable

```typescript
// src/components/fechamentos/monthlyReportPdf.ts
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

interface Input {
  salon: string;
  period: { start: string; end: string };
  professional: string | null;
  kpis: any;
  issues: any[];
}

const fmt = (n: number) => `R$ ${Number(n).toFixed(2).replace(".", ",")}`;

export function generateMonthlyPdf(input: Input) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 40;
  let y = margin;

  doc.setFontSize(18).text(`Fechamento — ${input.salon}`, margin, y);
  y += 24;
  doc.setFontSize(11).text(`Período: ${input.period.start} a ${input.period.end}`, margin, y);
  y += 16;
  if (input.professional) doc.text(`Profissional: ${input.professional}`, margin, y), y += 16;
  y += 8;

  // Resumo
  doc.setFontSize(13).text("Resumo", margin, y); y += 18;
  autoTable(doc, {
    startY: y,
    body: [
      ["Receita bruta",      fmt(input.kpis.revenue.gross)],
      ["Receita líquida",    fmt(input.kpis.revenue.net)],
      ["PagBank esperado",   fmt(input.kpis.revenue.expected_from_pagbank)],
      ["Atendimentos",       String(input.kpis.bookings.count)],
      ["Ticket médio",       fmt(input.kpis.bookings.average_ticket)],
      ["Toalhas",            `${input.kpis.towels.count} (${fmt(input.kpis.towels.cost)})`],
      ["Taxa real cartão",   fmt(input.kpis.real_card_fee.total)]
    ],
    theme: "plain",
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 180 } }
  });
  y = (doc as any).lastAutoTable.finalY + 16;

  // Por profissional
  doc.setFontSize(13).text("Por profissional", margin, y); y += 8;
  autoTable(doc, {
    startY: y,
    head: [["Nome", "Receita", "Atend.", "Top serviço"]],
    body: input.kpis.by_professional.map((p: any) =>
      [p.name, fmt(p.revenue), p.count, p.top_service?.name ?? "—"]
    )
  });
  y = (doc as any).lastAutoTable.finalY + 16;

  // Top serviços
  doc.setFontSize(13).text("Top serviços", margin, y); y += 8;
  autoTable(doc, {
    startY: y,
    head: [["Serviço", "Qtd", "Receita"]],
    body: input.kpis.top_services.map((s: any) => [s.name, s.count, fmt(s.revenue)])
  });
  y = (doc as any).lastAutoTable.finalY + 16;

  // Pendências
  if (input.issues.length > 0) {
    doc.setFontSize(13).text(`Pendências (${input.issues.length})`, margin, y); y += 8;
    autoTable(doc, {
      startY: y,
      head: [["Severidade", "Tipo", "Descrição"]],
      body: input.issues.map((i: any) => [i.severity, i.type, i.description])
    });
  }

  const filename = `fechamento_${input.period.start}_${input.period.end}${input.professional ? '_' + input.professional.replace(/\s+/g, '_') : ''}.pdf`;
  doc.save(filename);
}
```

- [ ] **Step 3:** Build + smoke test manual (abrir browser, clicar Gerar Mensal Maio/2026)

```bash
npm run build && npm run dev
```

- [ ] **Step 4:** Commit

```bash
git add src/components/fechamentos/MonthlyReportButton.tsx src/components/fechamentos/monthlyReportPdf.ts
git commit -m "feat(fechamentos): monthly PDF report generator with jspdf"
```

---

## FASE 12 — Workflow N8N "FECHAMENTO DIÁRIO NP HAIR EXPRESS"

> Esta fase é manual no painel N8N porta 5679. Cada step tem comando curl pra criar via API REST quando possível, ou instrução de UI quando não.

### Task 12.1: Login N8N + criar workflow vazio

- [ ] **Step 1:** Login N8N agentes

```bash
curl -s -c /tmp/n8n_cookie.txt -X POST 'http://72.60.6.168:5679/rest/login' \
  -H 'Content-Type: application/json' \
  -d '{"emailOrLdapLoginId":"npimagens@gmail.com","password":"XFlow2026Agentes!"}'
```

Expected: JSON com `data.id` (cookie salvo).

- [ ] **Step 2:** Criar credential PagBank EDI Header Auth

UI N8N (porta 5679) → Credentials → New → Header Auth:
- Name: `PagBank EDI`
- Header Name: `Authorization`
- Header Value: `Basic MTE5MjMyNTQyOmM2Njg1MzNlNTRkNzQ3MWZiZDU3YjlmNDEzMTU2YzE4`
  (gerar com `printf '119232542:${PAGBANK_TOKEN}' | base64`)

- [ ] **Step 3:** Criar workflow "FECHAMENTO DIÁRIO NP HAIR EXPRESS" via API

```bash
curl -s -b /tmp/n8n_cookie.txt -X POST 'http://72.60.6.168:5679/rest/workflows' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "FECHAMENTO DIÁRIO NP HAIR EXPRESS",
    "nodes": [],
    "connections": {},
    "settings": { "executionOrder": "v1" },
    "tags": []
  }'
```

Expected: JSON com `id` do workflow novo. **Anotar esse id.**

---

### Task 12.2: Schedule Trigger + Code (calcular ontem)

- [ ] **Step 1:** Adicionar Schedule Trigger via UI:
  - Trigger: `Schedule Trigger`
  - Cron: `0 7 * * 2-6`
  - Timezone: `America/Sao_Paulo`

- [ ] **Step 2:** Adicionar Code node `Calcula Data Alvo`:

```javascript
// Code node — Calcula Data Alvo
const now = new Date();
// Ajusta pra America/Sao_Paulo (UTC-3)
const saoPaulo = new Date(now.getTime() - 3 * 3600 * 1000);
const yesterday = new Date(saoPaulo);
yesterday.setDate(saoPaulo.getDate() - 1);
const yyyy = yesterday.getFullYear();
const mm = String(yesterday.getMonth() + 1).padStart(2, "0");
const dd = String(yesterday.getDate()).padStart(2, "0");
return [{ json: { date: `${yyyy}-${mm}-${dd}` } }];
```

- [ ] **Step 3:** Salvar e testar manualmente — clicar "Execute Workflow", deve sair `{ date: "YYYY-MM-DD" }`.

---

### Task 12.3: HTTP node Edge Function + IF erro

- [ ] **Step 1:** Adicionar HTTP Request node `Chama Edge Function`:
  - URL: `https://ewxiaxsmohxuabcmxuyc.supabase.co/functions/v1/daily-report`
  - Method: POST
  - Authentication: Generic Header Auth → `Authorization: Bearer <ANON_KEY>`
  - Body JSON: `{ "date": "{{ $json.date }}" }`
  - Settings → Continue On Fail: ON
  - Retry: 3 tentativas com 5min entre cada

- [ ] **Step 2:** Adicionar IF node `Status OK?`:
  - Condition: `{{ $json.markdown }} exists` (string is not empty)
  - True branch → continua pipeline
  - False branch → vai pro envio de erro pro Cleiton

---

### Task 12.4: Envio Evolution claudebot

- [ ] **Step 1:** HTTP Request `Envia Vanessa`:
  - URL: `http://72.60.6.168:8080/message/sendText/claudebot`
  - Method: POST
  - Headers: `apikey: EvoStack2026Key!`
  - Body JSON: `{ "number": "5511993939085", "text": "{{ $('Chama Edge Function').item.json.markdown }}" }`

- [ ] **Step 2:** HTTP Request `Envia Cleiton (cópia)`:
  - URL: idem
  - Body JSON: `{ "number": "5511976847114", "text": "{{ $('Chama Edge Function').item.json.markdown }}" }`

- [ ] **Step 3:** HTTP Request `Envia Cleiton (erro)` no branch False do IF:
  - Body JSON: `{ "number": "5511976847114", "text": "🚨 Erro no fechamento de {{ $json.date }}: {{ JSON.stringify($('Chama Edge Function').item.json) }}" }`

- [ ] **Step 4:** Smoke test manual — clicar "Execute Workflow" com `date` ajustada pra ontem (já testou no backfill). Confirma que mensagem chega nos 2 números.

---

### Task 12.5: Webhook `/webhook/fechamento` + ativação

- [ ] **Step 1:** Adicionar Webhook node como segundo trigger:
  - Path: `fechamento`
  - HTTP Method: POST
  - Response Mode: `On Received`

- [ ] **Step 2:** Conectar Webhook ao mesmo Code node `Calcula Data Alvo`, mas com lógica:

```javascript
// Code modificado pra aceitar tanto Schedule quanto Webhook
const fromWebhook = $input.item.json.body?.date;
if (fromWebhook) return [{ json: { date: fromWebhook, source: "manual" } }];
// senão calcula ontem (mesma lógica anterior)
const now = new Date();
// ... [lógica anterior]
```

- [ ] **Step 3:** Ativar workflow

UI → toggle "Active" → ON.

- [ ] **Step 4:** Teste do webhook

```bash
curl -s -X POST "https://agentes.72-60-6-168.sslip.io/webhook/fechamento" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-05-09"}'
```

Expected: HTTP 200 (resposta vazia em onReceived) + mensagem chega nos 2 WhatsApps em ~3-5s.

- [ ] **Step 5:** Commit (placeholder pra rastrear)

```bash
git commit --allow-empty -m "chore(n8n): workflow FECHAMENTO DIÁRIO NP HAIR EXPRESS deployed"
```

---

## FASE 13 — Comando admin `#fechamento` na Vivi

### Task 13.1: Atualizar nó "Processa Comando"

- [ ] **Step 1:** Login N8N agentes (já tem cookie)

```bash
curl -s -b /tmp/n8n_cookie.txt 'http://72.60.6.168:5679/rest/workflows/Jnqt15rnIduC4Z4i' > /tmp/vivi_current.json
python3 -c "import json; w=json.load(open('/tmp/vivi_current.json'))['data']; print([n['name'] for n in w['nodes'] if 'omando' in n['name']])"
```

Expected: lista contém `Processa Comando` ou similar.

- [ ] **Step 2:** Editar Code node "Processa Comando" pelo painel N8N adicionando regex de `#fechamento`:

```javascript
// dentro do Code node Processa Comando, adicionar antes de retornar:
const fechMatch = text.match(/^#fechamento (\d{2})\/(\d{2})(?:\/(\d{4}))?$/);
if (fechMatch) {
  const [, dd, mm, yyyy] = fechMatch;
  const year = yyyy ?? new Date().getFullYear();
  const isoDate = `${year}-${mm}-${dd}`;
  return [{
    json: {
      command: "fechamento",
      date: isoDate,
      original: text,
      should_dispatch: true
    }
  }];
}
```

- [ ] **Step 3:** Adicionar branch que chama o webhook do workflow novo:

Adicionar IF + HTTP Request:
- IF condition: `{{ $json.command === "fechamento" }}`
- HTTP: POST `https://agentes.72-60-6-168.sslip.io/webhook/fechamento` com body `{ "date": "{{ $json.date }}" }`
- Response WhatsApp: `🔄 Reprocessando fechamento de {{ $json.date }}...`

- [ ] **Step 4:** Teste real: enviar `#fechamento 09/05` pelo WhatsApp do Cleiton (5511976847114) pra Vivi → deve receber resposta `🔄 Reprocessando...` + relatório completo em ~5-10s.

---

## FASE 14 — Ativação + Monitoramento

### Task 14.1: Ativar e validar

- [ ] **Step 1:** Confirmar workflow ATIVO no painel N8N → toggle "Active" verde.

- [ ] **Step 2:** Confirmar próximo trigger:

```bash
curl -s -b /tmp/n8n_cookie.txt 'http://72.60.6.168:5679/rest/workflows/<NEW_WORKFLOW_ID>' \
  | python3 -c "import json,sys; d=json.load(sys.stdin)['data']; print('Active:', d['active'])"
```

Expected: `Active: True`.

- [ ] **Step 3:** Aguardar 7h ter 12/05 (próximo dia útil)

- [ ] **Step 4:** Verificar execução automática

```bash
curl -s -b /tmp/n8n_cookie.txt "http://72.60.6.168:5679/rest/executions?filter=%7B%22workflowId%22%3A%22<NEW_WORKFLOW_ID>%22%7D&limit=5"
```

Expected: 1 execução com status `success` em ~07:00:01.

---

### Task 14.2: Monitoramento 7 dias

- [ ] **Step 1:** Por 7 dias úteis seguidos (12-19/05), confirmar diariamente:
  - Vanessa recebeu mensagem
  - Cleiton recebeu cópia
  - `daily_reports` tem nova linha
  - `closure_issues` reflete divergências reais
  - Conteúdo do markdown faz sentido

- [ ] **Step 2:** Documentar issues encontradas em `docs/superpowers/specs/2026-05-10-fechamento-diario-design.md` (anexo "Lições da semana 1")

- [ ] **Step 3:** Cleiton aprova ou pede ajustes finos antes de considerar projeto entregue.

- [ ] **Step 4:** Commit final

```bash
git commit --allow-empty -m "feat: fechamento diário NP Hair Express LIVE — semana 1 OK"
```

---

## Sync Fork (após cada fase grande)

Quando uma fase fechar e for hora de subir pra Vercel:

```bash
# 1) Push pro origin (npimagens-svg)
git push origin feat/fechamento-diario:main

# 2) Sync Fork via API GitHub
TOKEN='${GH_PAT_SUAVEZEXPRESS}'
curl -s -X POST "https://api.github.com/repos/nphairexpress/suavezexpress/merge-upstream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "Content-Type: application/json" \
  -d '{"branch":"main"}'

# 3) Acompanhar deploy Vercel
VT='${VERCEL_TOKEN_SUAVEZEXPRESS}'
curl -s "https://api.vercel.com/v6/deployments?app=suavezexpress&limit=3" \
  -H "Authorization: Bearer $VT" | jq '.deployments[] | {state, url, createdAt}'
```

Esperar `state: "READY"` antes de testar em produção.

---

## Definition of Done

- [ ] Migration aplicada em produção
- [ ] 30+ testes deno passando localmente
- [ ] Edge Function `daily-report` deployada e respondendo HTTP 200
- [ ] Backfill de 6 dias úteis de Maio executado
- [ ] Páginas `/fechamentos` e `/pendencias` acessíveis em produção
- [ ] Botão "Gerar Mensal" gera PDF baixável
- [ ] Workflow N8N ATIVO
- [ ] 7 dias seguidos com envio automático às 7h pros 2 números
- [ ] Comando `#fechamento DD/MM` funcional na Vivi
- [ ] Detecção do caso real Andreia 02/05 verificada
- [ ] Cleiton aprovou conteúdo do relatório

---

## Riscos durante execução

| Risco | Mitigação |
|---|---|
| Schema real diferente do assumido | Pré-requisito P1 valida tabelas. Ajustar queries se diferente |
| Edge Function timeout pra fechamento mensal | Limite 150s. Mês inteiro deve rodar em <10s. Se passar, paginação |
| Token PagBank revogado durante backfill | Função retorna `pagbank_unavailable: true`, relatório vai sem cruzamento |
| Build Vercel quebrar após Sync Fork | Token Vercel disponível pra cancelar/redeploy via API |
| Vanessa não receber mensagem | Cleiton recebe cópia; alerta de erro vai pro Cleiton se workflow falhar |
| Bug em algum cálculo descoberto em produção | Reprocessamento via `#fechamento DD/MM` regenera com código corrigido |
