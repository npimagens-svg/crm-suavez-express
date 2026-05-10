// Edge Function daily-report — detectores de inconsistências de fechamento
import type { AsaasPayment, ClosureIssue, ComandaWithItems, PagBankTransaction } from "./types.ts";

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
  asaas: AsaasPayment[] = [],
): ClosureIssue[] {
  // ALGORITMO AGREGADO: compara soma por método (credit/debit).
  // Por que não 1-a-1? Vários payments têm o mesmo valor (manicure R$47,
  // escova R$77...). Match por valor sozinho gera false positives gigantes.
  //
  // IMPORTANTE — Asaas: pagamentos online via Asaas entram no sistema como
  // credit_card/pix mas NÃO passam pela maquininha PagBank. Logo, antes de
  // comparar com PagBank, subtraimos do total do sistema o que veio via Asaas
  // CONFIRMADO. Assim o "esperado_pagbank" é apenas a parte presencial.
  //
  // PIX: pode vir via PagBank OU outro provedor (não bate sempre).
  // Cash: não vem no PagBank (presencial).
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

  // Asaas CONFIRMED/RECEIVED do tipo cartão — descontar do esperado PagBank
  const asaasConfirmed = asaas.filter(a =>
    ["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"].includes(a.status)
  );
  const asaasByMethod: Record<string, number> = { credit: 0, debit: 0 };
  for (const a of asaasConfirmed) {
    if (a.billingType === "CREDIT_CARD") asaasByMethod.credit += Number(a.value);
    if (a.billingType === "DEBIT_CARD")  asaasByMethod.debit  += Number(a.value);
  }

  const pagbankByMethod: Record<string, number> = { credit: 0, debit: 0 };
  for (const t of pagbank) {
    const m = PAYMENT_METHOD_TO_BRAND[t.meio_pagamento];
    if (m === "credit" || m === "debit") {
      pagbankByMethod[m] += Number(t.valor_total_transacao);
    }
  }

  for (const method of ["credit", "debit"] as const) {
    // Esperado da maquininha = sistema − Asaas confirmado (mesmo método).
    const sysTotal = systemByMethod[method];
    const asaasPart = asaasByMethod[method];
    const expectedPagbank = sysTotal - asaasPart;
    const pbTotal = pagbankByMethod[method];
    const diff = expectedPagbank - pbTotal;

    if (Math.abs(diff) > TOLERANCE) {
      const label = method === "credit" ? "crédito" : "débito";
      const fmt = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;

      const asaasNote = asaasPart > 0
        ? ` (descontando ${fmt(asaasPart)} do Asaas online)`
        : "";

      let humanDescription: string;
      if (diff > 0) {
        // sistema diz que recebeu MAIS no cartão presencial do que a maquininha
        humanDescription =
          `Hoje o sistema diz que recebeu ${fmt(expectedPagbank)} no cartão de ${label} pela maquininha${asaasNote}, ` +
          `mas o PagBank só registrou ${fmt(pbTotal)}. ` +
          `Sobraram ${fmt(Math.abs(diff))} no sistema — provavelmente alguma comanda foi lançada ` +
          `como ${label} mas o cliente pagou em PIX, dinheiro ou outro cartão.`;
      } else {
        // PagBank tem MAIS do que o sistema (faltou registrar presencial)
        humanDescription =
          `A maquininha do PagBank recebeu ${fmt(pbTotal)} no cartão de ${label} hoje, ` +
          `mas o sistema só registrou ${fmt(expectedPagbank)} presencial${asaasNote}. ` +
          `Faltam ${fmt(Math.abs(diff))} pra bater — provavelmente alguma comanda ` +
          `foi lançada com outra forma de pagamento mas o cliente pagou no ${label}.`;
      }

      issues.push({
        type: "payment_method_mismatch",
        severity: "high",
        description: humanDescription,
        expected_value: {
          method,
          system_total: sysTotal,
          asaas_subtracted: asaasPart,
          expected_pagbank: expectedPagbank,
          pagbank_total: pbTotal,
          diff,
        },
      });
    }
  }
  return issues;
}

export function detectValueMismatch(comandas: ComandaWithItems[]): ClosureIssue[] {
  // Validação correta: subtotal == Σ items E total == subtotal − discount.
  // Antes flagava (total ≠ Σ items) sem considerar discount → false positives
  // em toda comanda com desconto (caso real #112 Rafaela mello R$17 desconto).
  const fmt = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;
  const issues: ClosureIssue[] = [];
  for (const c of comandas) {
    const itemsSum = c.items.reduce((s, i) => s + Number(i.total_price), 0);
    const subtotal = Number(c.subtotal ?? c.total ?? 0);
    const discount = Number(c.discount ?? 0);
    const total = Number(c.total ?? 0);

    // 1) subtotal não bate com Σ items (independe de desconto)
    if (itemsSum > 0 && Math.abs(itemsSum - subtotal) > 0.01) {
      issues.push({
        type: "value_mismatch",
        severity: "high",
        description:
          `Comanda #${c.comanda_number}: o subtotal está ${fmt(subtotal)} mas a soma dos serviços lançados ` +
          `dá ${fmt(itemsSum)}. Diferença de ${fmt(Math.abs(subtotal - itemsSum))} — algum serviço foi alterado ` +
          `depois ou o recálculo não foi feito.`,
        comanda_id: c.id,
        professional_id: c.professional_id ?? undefined,
        expected_value: { items_sum: itemsSum, subtotal },
        actual_value: { total, discount },
      });
      continue;
    }

    // 2) total não bate com subtotal − discount
    if (Math.abs(total - (subtotal - discount)) > 0.01) {
      issues.push({
        type: "value_mismatch",
        severity: "high",
        description:
          `Comanda #${c.comanda_number}: total ${fmt(total)} não bate com a conta ` +
          `(subtotal ${fmt(subtotal)} − desconto ${fmt(discount)} = ${fmt(subtotal - discount)}). ` +
          `Recalcule a comanda antes de fechar.`,
        comanda_id: c.id,
        professional_id: c.professional_id ?? undefined,
        expected_value: { expected_total: subtotal - discount },
        actual_value: { total, subtotal, discount },
      });
    }
  }
  return issues;
}

export function detectPaidWithoutPayment(comandas: ComandaWithItems[]): ClosureIssue[] {
  const fmt = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;
  return comandas
    .filter((c) => c.is_paid && c.payments.length === 0 && Number(c.total) > 0)
    .map((c) => ({
      type: "paid_without_payment",
      severity: "high" as const,
      description:
        `Comanda #${c.comanda_number} foi marcada como paga (${fmt(Number(c.total))}) mas não tem ` +
        `nenhum pagamento registrado (dinheiro, PIX ou cartão). Foi cortesia ou faltou registrar?`,
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
    const fmtBr = (n: number) => `R$ ${Number(n).toFixed(2).replace(".", ",")}`;
    const brandLabel: Record<string, string> = {
      CREDIT_VISA: "Visa crédito",
      CREDIT_MASTERCARD: "MasterCard crédito",
      CREDIT_ELO: "Elo crédito",
      DEBIT_VISA: "Visa débito",
      DEBIT_MASTERCARD: "MasterCard débito",
      DEBIT_ELO: "Elo débito",
      PIX: "PIX",
    };
    const label = brandLabel[tx.arranjo_ur] ?? tx.arranjo_ur;
    issues.push({
      type: "pagbank_orphan_transaction",
      severity: "high",
      description:
        `A maquininha do PagBank recebeu ${fmtBr(tx.valor_total_transacao)} via ${label} ` +
        `mas não tem comanda correspondente no sistema. Alguém recebeu o pagamento ` +
        `sem registrar a comanda? Ou a comanda foi lançada com outra forma de pagamento?`,
      expected_value: { has_comanda: true },
      actual_value: {
        brand: tx.arranjo_ur,
        brand_label: label,
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
  const fmt = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;
  return comandas
    .filter((c) => !c.is_paid && new Date(c.created_at).getTime() < cutoff)
    .map((c) => {
      const hours = Math.round((Date.now() - new Date(c.created_at).getTime()) / 3600000);
      const days = Math.floor(hours / 24);
      const timeLabel = days >= 1
        ? `${days} dia${days > 1 ? "s" : ""}`
        : `${hours} horas`;
      return {
        type: "comanda_open_24h",
        severity: "medium" as const,
        description:
          `Comanda #${c.comanda_number} (${fmt(Number(c.total))}) está aberta há ${timeLabel} ` +
          `sem ser fechada. Cliente foi embora sem pagar, esquecimento, ou pagamento por receber?`,
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
      description:
        `Comanda #${c.comanda_number} não tem profissional atribuída. ` +
        `Sem isso a comissão não vai pra ninguém. Edite a comanda e selecione quem atendeu.`,
      comanda_id: c.id,
    }));
}

export function detectPaymentWithoutPaidFlag(comandas: ComandaWithItems[]): ClosureIssue[] {
  return comandas
    .filter((c) => !c.is_paid && c.payments.length > 0)
    .map((c) => ({
      type: "payment_without_paid_flag",
      severity: "medium" as const,
      description:
        `Comanda #${c.comanda_number} tem pagamento registrado mas ainda está aberta. ` +
        `Provavelmente esqueceu de finalizar — vá na comanda e clique em "Fechar".`,
      comanda_id: c.id,
      professional_id: c.professional_id ?? undefined,
    }));
}

export function detectCashbackOverdraft(
  credits: Array<{ client_id: string; balance: number; client_name?: string }>,
): ClosureIssue[] {
  const fmt = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;
  return credits
    .filter((c) => Number(c.balance) < 0)
    .map((c) => ({
      type: "cashback_overdraft",
      severity: "medium" as const,
      description:
        `Cliente ${c.client_name ?? c.client_id} está com saldo de cashback negativo ` +
        `(${fmt(c.balance)}). Resgataram mais do que tinham — ajustar.`,
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
            `Comanda #${c.comanda_number} tem ${item.quantity}× ${item.service_name} no mesmo cliente. ` +
            `É legítimo (cliente fez 3 serviços iguais) ou foi lançamento duplicado pra inflar comissão? Vale conferir.`,
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
// Asaas pending (medium)
// =============================================================================

export function detectAsaasPaymentPending(
  asaasPayments: AsaasPayment[],
  comandas: ComandaWithItems[] = [],
  clientNameById: Record<string, string> = {},
): ClosureIssue[] {
  const fmt = (n: number) => `R$ ${Number(n).toFixed(2).replace(".", ",")}`;
  const fmtDate = (iso: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
    return m ? `${m[3]}/${m[2]}` : iso;
  };
  const billingLabel: Record<string, string> = {
    PIX: "PIX",
    CREDIT_CARD: "cartão de crédito",
    DEBIT_CARD: "cartão de débito",
    BOLETO: "boleto",
    UNDEFINED: "pagamento",
  };

  // Indexa comandas pagas do dia por VALOR (R$ X → lista de comandas) pra cruzamento.
  // Match exato (.01 tolerância) — se cobrança Asaas R$87 e tem comanda paga R$87
  // no dia, mostra como provável cliente.
  const comandasByValue = new Map<string, Array<{ num: number; client: string; method: string }>>();
  for (const c of comandas.filter(x => x.is_paid)) {
    const key = Number(c.total).toFixed(2);
    const client = c.client_id ? (clientNameById[c.client_id] ?? "cliente sem nome") : "cliente sem nome";
    const method = c.payments.length > 0
      ? c.payments.map(p => translateMethod(p.payment_method)).join("/")
      : "—";
    if (!comandasByValue.has(key)) comandasByValue.set(key, []);
    comandasByValue.get(key)!.push({ num: c.comanda_number, client, method });
  }

  return asaasPayments
    .filter(p => p.status === "PENDING" || p.status === "OVERDUE")
    .map(p => {
      const label = billingLabel[p.billingType] ?? p.billingType ?? "pagamento";
      const when = fmtDate(p.dateCreated);
      const valueKey = Number(p.value).toFixed(2);
      const candidates = comandasByValue.get(valueKey) ?? [];

      let humanDescription: string;
      if (candidates.length === 0) {
        humanDescription =
          `Cobrança Asaas de ${fmt(Number(p.value))} (${label}) criada em ${when} ainda está PENDENTE ` +
          `e não bate com nenhuma comanda paga do dia. Cliente pode ter desistido — ` +
          `vale cancelar a cobrança no Asaas.`;
      } else if (candidates.length === 1) {
        const c = candidates[0];
        humanDescription =
          `Cobrança Asaas de ${fmt(Number(p.value))} (${label}) pendente. ` +
          `Provavelmente é a Comanda #${c.num} de ${c.client} (paga ${c.method}). ` +
          `Confere e fecha a cobrança no Asaas.`;
      } else {
        const list = candidates.slice(0, 3)
          .map(c => `#${c.num} ${c.client} (${c.method})`).join(" · ");
        humanDescription =
          `Cobrança Asaas de ${fmt(Number(p.value))} (${label}) pendente. ` +
          `Hoje teve ${candidates.length} comandas do mesmo valor: ${list}${candidates.length > 3 ? "..." : ""}. ` +
          `Identifica qual cliente é e fecha a cobrança.`;
      }

      return {
        type: "asaas_payment_pending" as const,
        severity: "medium" as const,
        description: humanDescription,
        actual_value: {
          asaas_id: p.id,
          status: p.status,
          billing_type: p.billingType,
          value: p.value,
          date_created: p.dateCreated,
          description: p.description ?? null,
          candidate_comandas: candidates.map(c => c.num),
        },
      };
    });
}

function translateMethod(m: string): string {
  const t = String(m).toLowerCase();
  if (t === "credit"     || t === "credit_card") return "crédito";
  if (t === "debit"      || t === "debit_card")  return "débito";
  if (t === "pix")  return "PIX";
  if (t === "cash") return "dinheiro";
  return m;
}

// =============================================================================
// AGREGADOR
// =============================================================================

export interface DetectorInput {
  comandas: ComandaWithItems[];
  pagbank: PagBankTransaction[];
  credits: Array<{ client_id: string; balance: number }>;
  asaas?: AsaasPayment[];
  clientNameById?: Record<string, string>;
}

export function runAllDetectors(input: DetectorInput): ClosureIssue[] {
  const all = [
    ...detectPaymentMethodMismatch(input.comandas, input.pagbank, input.asaas ?? []),
    ...detectValueMismatch(input.comandas),
    ...detectPaidWithoutPayment(input.comandas),
    ...detectPagbankOrphanTransaction(input.comandas, input.pagbank),
    ...detectComandaOpen24h(input.comandas),
    ...detectProfessionalMissing(input.comandas),
    ...detectPaymentWithoutPaidFlag(input.comandas),
    ...detectCashbackOverdraft(input.credits),
    ...detectAsaasPaymentPending(input.asaas ?? [], input.comandas, input.clientNameById ?? {}),
    ...detectDuplicateServiceSameClient(input.comandas),
  ];
  const sev = { high: 0, medium: 1, low: 2 } as const;
  return all.sort((a, b) => sev[a.severity] - sev[b.severity]);
}
