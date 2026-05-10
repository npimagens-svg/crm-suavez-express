import type {
  ComandaWithItems,
  PagBankTransaction,
  PaymentMix,
  ProfessionalStats,
  ServiceStats,
} from "./types.ts";

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

export function calculateBookings(
  comandas: ComandaWithItems[]
): { count: number; average_ticket: number } {
  const paid = comandas.filter(c => c.is_paid);
  const count = paid.length;
  const total = paid.reduce((sum, c) => sum + Number(c.total), 0);
  const average_ticket = count === 0 ? 0 : total / count;
  return { count, average_ticket };
}
