// Testes da Edge Function daily-report — detector
import { assertEquals } from "std/assert/mod.ts";
import {
  detectCashbackOverdraft,
  detectComandaOpen24h,
  detectDuplicateServiceSameClient,
  detectPagbankOrphanTransaction,
  detectPaidWithoutPayment,
  detectPaymentMethodMismatch,
  detectPaymentWithoutPaidFlag,
  detectProfessionalMissing,
  detectValueMismatch,
} from "../detector.ts";
import divergent from "./fixtures/divergent_day.json" with { type: "json" };
import pagbank from "./fixtures/pagbank_response.json" with { type: "json" };

// =============================================================================
// Task 4.1 — 4 detectores high severity
// =============================================================================

Deno.test("detectPaymentMethodMismatch: pega Andreia (cash no sistema, debit no PagBank)", () => {
  const issues = detectPaymentMethodMismatch(divergent.comandas, pagbank.detalhes);
  const andreia = issues.find((i) => i.comanda_id === "c75");
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
