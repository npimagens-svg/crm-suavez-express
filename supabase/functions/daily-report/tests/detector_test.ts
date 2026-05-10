// Testes da Edge Function daily-report — detector
import { assertEquals } from "std/assert/mod.ts";
import {
  detectPaymentMethodMismatch,
  detectValueMismatch,
  detectPaidWithoutPayment,
  detectPagbankOrphanTransaction,
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
