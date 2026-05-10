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

export function calculateTopServices(comandas: ComandaWithItems[]): ServiceStats[] {
  const paid = comandas.filter(c => c.is_paid);
  const byService = new Map<string, { name: string; count: number; revenue: number }>();
  for (const c of paid) {
    for (const item of c.items) {
      const k = item.service_id;
      if (!byService.has(k)) byService.set(k, { name: item.service_name, count: 0, revenue: 0 });
      const agg = byService.get(k)!;
      agg.count += item.quantity;
      agg.revenue += Number(item.total_price);
    }
  }
  return [...byService.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
}

export function calculatePaymentMix(comandas: ComandaWithItems[]): PaymentMix {
  const empty = { count: 0, gross: 0, net: 0 };
  const mix: PaymentMix = {
    credit: { ...empty }, debit: { ...empty }, pix: { ...empty }, cash: { ...empty }
  };
  for (const c of comandas.filter(x => x.is_paid)) {
    for (const p of c.payments) {
      const key = (p.payment_method ?? "").toLowerCase() as keyof PaymentMix;
      if (!(key in mix)) continue;
      mix[key].count += 1;
      mix[key].gross += Number(p.amount);
      mix[key].net += Number(p.net_amount ?? p.amount);
    }
  }
  return mix;
}

export function calculateRealCardFee(
  pagbank: PagBankTransaction[]
): { total: number; by_brand: Record<string, number> } {
  let total = 0;
  const by_brand: Record<string, number> = {};
  for (const t of pagbank) {
    const fee = Number(t.taxa_intermediacao ?? 0);
    if (fee === 0) continue; // PIX, dinheiro
    total += fee;
    by_brand[t.arranjo_ur] = (by_brand[t.arranjo_ur] ?? 0) + fee;
  }
  return { total, by_brand };
}
