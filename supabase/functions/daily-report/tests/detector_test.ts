// Testes da Edge Function daily-report — detector
import { assertEquals } from "std/assert/mod.ts";
import {
  detectAsaasPaymentPending,
  detectCashbackOverdraft,
  detectComandaOpen24h,
  detectDuplicateServiceSameClient,
  detectPagbankOrphanTransaction,
  detectPaidWithoutPayment,
  detectPaymentMethodMismatch,
  detectPaymentWithoutPaidFlag,
  detectProfessionalMissing,
  detectValueMismatch,
  runAllDetectors,
} from "../detector.ts";
import divergent from "./fixtures/divergent_day.json" with { type: "json" };
import pagbank from "./fixtures/pagbank_response.json" with { type: "json" };

// =============================================================================
// Task 4.1 — 4 detectores high severity
// =============================================================================

Deno.test("detectPaymentMethodMismatch: detecta divergência agregada de débito (Andreia)", () => {
  // divergent fixture: 1 comanda cash R$64 + 1 credit R$240
  // pagbank: 1 debit R$64 (Andreia errada) + 1 credit R$240
  // Sistema: credit 240, debit 0
  // PagBank: credit 240, debit 64
  // Diff: credit ok, debit -64 → emite 1 issue de débito
  const issues = detectPaymentMethodMismatch(divergent.comandas, pagbank.detalhes);
  assertEquals(issues.length, 1);
  assertEquals(issues[0].severity, "high");
  assertEquals(issues[0].type, "payment_method_mismatch");
  // Diff de débito ~ -64
  const ev = issues[0].expected_value as Record<string, number>;
  assertEquals(ev.method as unknown as string, "debit");
  assertEquals(Math.round(ev.diff), -64);
});

Deno.test("detectPaymentMethodMismatch: dia perfeito não emite issue", () => {
  // Sistema com 1 credit R$100, PagBank com 1 credit R$100 — sem diff
  const comandas = [{
    id: "c1", salon_id: "s1", client_id: null, professional_id: null,
    comanda_number: 1, total: 100, is_paid: true,
    created_at: "2026-05-09T10:00:00Z", closed_at: "2026-05-09T10:30:00Z",
    items: [], payments: [{ id: "p1", amount: 100, payment_method: "credit", fee_amount: 0, net_amount: 100, installments: 1 }]
  }];
  const pb = [{ meio_pagamento: 3, arranjo_ur: "CREDIT_VISA", valor_total_transacao: 100, valor_liquido_transacao: 97, taxa_intermediacao: 3, data_prevista_pagamento: "", quantidade_parcelas: 1 }];
  const issues = detectPaymentMethodMismatch(comandas, pb);
  assertEquals(issues.length, 0);
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
    payments: [],
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

// =============================================================================
// Task 4.2 — 4 medium + 1 low detectores
// =============================================================================

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
  const c = [{
    ...divergent.comandas[0],
    is_paid: false,
    payments: [{
      id: "x",
      amount: 64,
      payment_method: "cash",
      fee_amount: 0,
      net_amount: 64,
      installments: 0,
    }],
  }];
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
  const dandara = issues.find((i) => i.comanda_id === "c90");
  assertEquals(dandara?.severity, "low");
});

Deno.test("detectAsaasPaymentPending: emite issue pra PENDING+OVERDUE", () => {
  const asaas = [
    { id: "p1", status: "PENDING",   billingType: "PIX",         value: 100, netValue: 99, customer: "c1", dateCreated: "2026-05-09" },
    { id: "p2", status: "RECEIVED",  billingType: "PIX",         value: 200, netValue: 199, customer: "c2", dateCreated: "2026-05-09" },
    { id: "p3", status: "OVERDUE",   billingType: "CREDIT_CARD", value: 80,  netValue: 78, customer: "c3", dateCreated: "2026-05-08" },
    { id: "p4", status: "CONFIRMED", billingType: "PIX",         value: 50,  netValue: 49, customer: "c4", dateCreated: "2026-05-09" },
  ];
  const issues = detectAsaasPaymentPending(asaas);
  assertEquals(issues.length, 2);
  assertEquals(issues[0].severity, "medium");
  assertEquals(issues[0].type, "asaas_payment_pending");
});

Deno.test("detectAsaasPaymentPending: descreve com valor e data", () => {
  const asaas = [
    { id: "p1", status: "PENDING", billingType: "PIX", value: 100, netValue: 99, customer: "c1", dateCreated: "2026-05-09" },
  ];
  const issues = detectAsaasPaymentPending(asaas);
  const desc = issues[0].description;
  if (!desc.includes("R$ 100,00") || !desc.includes("09/05") || !desc.includes("PIX")) {
    throw new Error("description não menciona valor/data/método: " + desc);
  }
});

Deno.test("detectAsaasPaymentPending: lista vazia → 0 issues", () => {
  assertEquals(detectAsaasPaymentPending([]).length, 0);
});

// =============================================================================
// Task 4.3 — Agregador
// =============================================================================

Deno.test("runAllDetectors: roda todos e concatena", () => {
  const issues = runAllDetectors({
    comandas: divergent.comandas,
    pagbank: pagbank.detalhes,
    credits: [],
  });
  assertEquals(issues.length >= 3, true);
  // ordenado por severidade
  const severities = issues.map((i) => i.severity);
  const idx = (s: string) => ({ high: 0, medium: 1, low: 2 }[s] ?? 99);
  for (let i = 1; i < severities.length; i++) {
    assertEquals(idx(severities[i - 1]) <= idx(severities[i]), true);
  }
});
