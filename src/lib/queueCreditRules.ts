// Regra ÚNICA de crédito da fila (falha 16) — a MESMA usada no frontend, na
// RPC fila_creditos_fim_do_dia() e documentada para o cron. Pura e testável.

export type QueueStatus =
  | "waiting" | "checked_in" | "in_service" | "completed" | "cancelled" | "no_show";
export type QueuePaymentStatus = "pending" | "confirmed" | "refunded" | "credit";

export interface CreditDecisionInput {
  status: QueueStatus;
  payment_status: QueuePaymentStatus;
  paid_amount?: number | null;
  service_prices_sum?: number | null; // fallback multi-serviço (falha 15)
}

export interface CreditDecision {
  generate: boolean;
  amount: number;
}

/**
 * Fim do dia: gera crédito SÓ quando a cliente PAGOU (confirmed) e estava
 * AGUARDANDO (waiting/checked_in) sem ter sido atendida.
 *  - no_show / cancelled: NÃO geram crédito aqui (recepção marcou de
 *    propósito; cancelamento pago já gerou crédito na hora).
 *  - Valor = paid_amount (snapshot do que foi pago). Fallback = soma dos
 *    preços de TODOS os serviços (multi-serviço), nunca só o primeiro.
 */
export function decideEndOfDayCredit(input: CreditDecisionInput): CreditDecision {
  const eligibleStatus = input.status === "waiting" || input.status === "checked_in";
  if (!eligibleStatus || input.payment_status !== "confirmed") {
    return { generate: false, amount: 0 };
  }
  const amount = input.paid_amount != null
    ? Number(input.paid_amount)
    : Number(input.service_prices_sum ?? 0);
  return { generate: true, amount };
}
