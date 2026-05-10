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

// =============================================================================
// MEDIUM severity (4)
// =============================================================================

export function detectComandaOpen24h(comandas: ComandaWithItems[]): ClosureIssue[] {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  return comandas
    .filter((c) => !c.is_paid && new Date(c.created_at).getTime() < cutoff)
    .map((c) => {
      const hours = Math.round((Date.now() - new Date(c.created_at).getTime()) / 3600000);
      return {
        type: "comanda_open_24h",
        severity: "medium" as const,
        description: `Comanda #${c.comanda_number} aberta há ${hours}h sem fechamento`,
        comanda_id: c.id,
        professional_id: c.professional_id ?? undefined,
        actual_value: { hours_open: hours, total: c.total },
      };
    });
}

export function detectProfessionalMissing(comandas: ComandaWithItems[]): ClosureIssue[] {
  return comandas
    .filter((c) => !c.professional_id)
    .map((c) => ({
      type: "professional_missing",
      severity: "medium" as const,
      description: `Comanda #${c.comanda_number} sem profissional atribuída`,
      comanda_id: c.id,
    }));
}

export function detectPaymentWithoutPaidFlag(comandas: ComandaWithItems[]): ClosureIssue[] {
  return comandas
    .filter((c) => !c.is_paid && c.payments.length > 0)
    .map((c) => ({
      type: "payment_without_paid_flag",
      severity: "medium" as const,
      description: `Comanda #${c.comanda_number}: tem pagamento mas flag is_paid=false`,
      comanda_id: c.id,
      professional_id: c.professional_id ?? undefined,
    }));
}

export function detectCashbackOverdraft(
  credits: Array<{ client_id: string; balance: number }>,
): ClosureIssue[] {
  return credits
    .filter((c) => Number(c.balance) < 0)
    .map((c) => ({
      type: "cashback_overdraft",
      severity: "medium" as const,
      description: `Cliente ${c.client_id}: saldo de cashback negativo (R$${c.balance})`,
      actual_value: { client_id: c.client_id, balance: c.balance },
    }));
}

// =============================================================================
// LOW severity (1)
// =============================================================================

export function detectDuplicateServiceSameClient(comandas: ComandaWithItems[]): ClosureIssue[] {
  const issues: ClosureIssue[] = [];
  for (const c of comandas) {
    for (const item of c.items) {
      if (item.quantity > 2) {
        issues.push({
          type: "duplicate_service_same_client",
          severity: "low",
          description:
            `Comanda #${c.comanda_number}: ${item.quantity}× ${item.service_name} pro mesmo cliente`,
          comanda_id: c.id,
          professional_id: c.professional_id ?? undefined,
          actual_value: { service: item.service_name, quantity: item.quantity },
        });
      }
    }
  }
  return issues;
}

// =============================================================================
// AGREGADOR
// =============================================================================

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
