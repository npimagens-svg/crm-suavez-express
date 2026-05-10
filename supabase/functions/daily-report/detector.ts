// Edge Function daily-report — detectores de inconsistências de fechamento
import type { ClosureIssue, ComandaWithItems, PagBankTransaction } from "./types.ts";

// Mapa meio_pagamento (PagBank EDI) → método do sistema
const PAYMENT_METHOD_TO_BRAND: Record<number, string> = {
  3: "credit",
  8: "debit",
  11: "pix",
  15: "debit",
};

// =============================================================================
// HIGH severity (4)
// =============================================================================

export function detectPaymentMethodMismatch(
  comandas: ComandaWithItems[],
  pagbank: PagBankTransaction[],
): ClosureIssue[] {
  const issues: ClosureIssue[] = [];
  // Para cada comanda paga: tenta casar com transação PagBank por valor
  // Se valor bate mas método diverge, é mismatch
  for (const c of comandas.filter((x) => x.is_paid)) {
    for (const p of c.payments) {
      const tx = pagbank.find((t) =>
        Math.abs(Number(t.valor_total_transacao) - Number(p.amount)) < 0.01
      );
      if (!tx) continue;
      const expectedMethod = PAYMENT_METHOD_TO_BRAND[tx.meio_pagamento];
      if (!expectedMethod || expectedMethod === p.payment_method.toLowerCase()) continue;
      issues.push({
        type: "payment_method_mismatch",
        severity: "high",
        description:
          `Comanda #${c.comanda_number}: sistema diz ${p.payment_method} mas PagBank registrou ${tx.arranjo_ur}`,
        comanda_id: c.id,
        professional_id: c.professional_id ?? undefined,
        expected_value: {
          method: expectedMethod,
          brand: tx.arranjo_ur,
          gross: tx.valor_total_transacao,
          net: tx.valor_liquido_transacao,
        },
        actual_value: { method: p.payment_method, amount: p.amount },
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
        description:
          `Comanda #${c.comanda_number}: total R$${c.total} ≠ soma dos itens R$${itemsSum}`,
        comanda_id: c.id,
        professional_id: c.professional_id ?? undefined,
        expected_value: { total: itemsSum },
        actual_value: { total: c.total },
      });
    }
  }
  return issues;
}

export function detectPaidWithoutPayment(comandas: ComandaWithItems[]): ClosureIssue[] {
  return comandas
    .filter((c) => c.is_paid && c.payments.length === 0)
    .map((c) => ({
      type: "paid_without_payment",
      severity: "high",
      description: `Comanda #${c.comanda_number} marcada como paga mas sem pagamento registrado`,
      comanda_id: c.id,
      professional_id: c.professional_id ?? undefined,
      expected_value: { has_payment: true },
      actual_value: { has_payment: false, total: c.total },
    }));
}

export function detectPagbankOrphanTransaction(
  comandas: ComandaWithItems[],
  pagbank: PagBankTransaction[],
): ClosureIssue[] {
  const allPayments = comandas.flatMap((c) => c.payments.map((p) => ({ ...p, comanda: c })));
  const issues: ClosureIssue[] = [];
  for (const tx of pagbank) {
    const match = allPayments.find((p) =>
      Math.abs(Number(p.amount) - Number(tx.valor_total_transacao)) < 0.01 &&
      PAYMENT_METHOD_TO_BRAND[tx.meio_pagamento] === p.payment_method.toLowerCase()
    );
    if (match) continue;
    issues.push({
      type: "pagbank_orphan_transaction",
      severity: "high",
      description:
        `PagBank registrou ${tx.arranjo_ur} R$${tx.valor_total_transacao} sem comanda correspondente`,
      expected_value: { has_comanda: true },
      actual_value: {
        brand: tx.arranjo_ur,
        amount: tx.valor_total_transacao,
        method_code: tx.meio_pagamento,
      },
    });
  }
  return issues;
}
