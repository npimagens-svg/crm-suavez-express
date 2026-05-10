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
