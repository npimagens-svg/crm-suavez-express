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
  // ALGORITMO AGREGADO: compara soma por método (credit/debit).
  // Por que não 1-a-1? Vários payments têm o mesmo valor (manicure R$47,
  // escova R$77...). Match por valor sozinho gera false positives gigantes.
  // PIX: pode vir via PagBank OU outro provedor (não bate sempre).
  // Cash: não vem no PagBank (presencial).
  // Logo, só checamos credit/debit no agregado.
  const TOLERANCE = 1.00; // R$ 1 de tolerância (arredondamento de taxa)
  const issues: ClosureIssue[] = [];

  const systemByMethod: Record<string, number> = { credit: 0, debit: 0 };
  for (const c of comandas.filter((x) => x.is_paid)) {
    for (const p of c.payments) {
      const m = String(p.payment_method).toLowerCase();
      if (m === "credit" || m === "debit") {
        systemByMethod[m] += Number(p.amount);
      }
    }
  }

  const pagbankByMethod: Record<string, number> = { credit: 0, debit: 0 };
  for (const t of pagbank) {
    const m = PAYMENT_METHOD_TO_BRAND[t.meio_pagamento];
    if (m === "credit" || m === "debit") {
      pagbankByMethod[m] += Number(t.valor_total_transacao);
    }
  }

  for (const method of ["credit", "debit"] as const) {
    const diff = systemByMethod[method] - pagbankByMethod[method];
    if (Math.abs(diff) > TOLERANCE) {
      const label = method === "credit" ? "Crédito" : "Débito";
      issues.push({
        type: "payment_method_mismatch",
        severity: "high",
        description:
          `${label}: sistema R$ ${systemByMethod[method].toFixed(2)} ≠ ` +
          `PagBank R$ ${pagbankByMethod[method].toFixed(2)} ` +
          `(${diff > 0 ? "+" : ""}R$ ${diff.toFixed(2)})`,
        expected_value: {
          method,
          system_total: systemByMethod[method],
          pagbank_total: pagbankByMethod[method],
          diff,
        },
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
  // Algoritmo: cada transação PagBank tem que "consumir" 1 payment do sistema
  // de valor+método iguais. Usa Set de payments já consumidos pra não casar 2x.
  const consumed = new Set<string>();
  const allPayments = comandas
    .filter((c) => c.is_paid)
    .flatMap((c) => c.payments.map((p) => ({ ...p, comandaNumber: c.comanda_number })));
  const issues: ClosureIssue[] = [];
  for (const tx of pagbank) {
    const expectedMethod = PAYMENT_METHOD_TO_BRAND[tx.meio_pagamento];
    const match = allPayments.find((p) =>
      !consumed.has(p.id) &&
      Math.abs(Number(p.amount) - Number(tx.valor_total_transacao)) < 0.01 &&
      expectedMethod === String(p.payment_method).toLowerCase()
    );
    if (match) {
      consumed.add(match.id);
      continue;
    }
    issues.push({
      type: "pagbank_orphan_transaction",
      severity: "high",
      description:
        `PagBank registrou ${tx.arranjo_ur} R$ ${Number(tx.valor_total_transacao).toFixed(2)} sem comanda equivalente no sistema`,
      expected_value: { has_comanda: true },
      actual_value: {
        brand: tx.arranjo_ur,
        amount: tx.valor_total_transacao,
        method_code: tx.meio_pagamento,
        liquido: tx.valor_liquido_transacao,
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
