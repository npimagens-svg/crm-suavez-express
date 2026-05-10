import type {
  AsaasPayment,
  ComandaWithItems,
  PagBankTransaction,
  PaymentMix,
  PaymentProvider,
  ProfessionalStats,
  ProviderBreakdown,
  ServiceStats,
} from "./types.ts";

export function calculateRevenue(
  comandas: ComandaWithItems[],
  pagbank: PagBankTransaction[],
  asaas: AsaasPayment[] = []
): { gross: number; net: number; expected_from_pagbank: number; expected_from_asaas: number } {
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
  // Só conta o que foi efetivamente recebido (CONFIRMED+RECEIVED).
  // Ignora PENDING/OVERDUE/REFUNDED.
  const expected_from_asaas = asaas
    .filter(p => p.status === "CONFIRMED" || p.status === "RECEIVED" || p.status === "RECEIVED_IN_CASH")
    .reduce((sum, p) => sum + Number(p.value), 0);
  return { gross, net, expected_from_pagbank, expected_from_asaas };
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
  const emptyProvider = (): ProviderBreakdown => ({ pagbank: 0, asaas: 0, manual: 0 });
  const emptyBucket = () => ({ count: 0, gross: 0, net: 0, by_provider: emptyProvider() });
  const mix: PaymentMix = {
    credit: emptyBucket(),
    debit:  emptyBucket(),
    pix:    emptyBucket(),
    cash:   { count: 0, gross: 0, net: 0 },
  };
  for (const c of comandas.filter(x => x.is_paid)) {
    for (const p of c.payments) {
      const key = (p.payment_method ?? "").toLowerCase() as keyof PaymentMix;
      if (!(key in mix)) continue;
      const amount = Number(p.amount);
      const netAmount = Number(p.net_amount ?? p.amount);
      const provider: PaymentProvider =
        (p.payment_provider ?? "manual") as PaymentProvider;

      if (key === "cash") {
        const bucket = mix.cash;
        bucket.count += 1;
        bucket.gross += amount;
        bucket.net += netAmount;
      } else {
        const bucket = mix[key];
        bucket.count += 1;
        bucket.gross += amount;
        bucket.net += netAmount;
        if (provider === "pagbank" || provider === "asaas" || provider === "manual") {
          bucket.by_provider[provider] += amount;
        } else {
          // provider desconhecido vira manual (defensivo)
          bucket.by_provider.manual += amount;
        }
      }
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

export function calculateNewVsReturning(
  today: ComandaWithItems[],
  historyPaid: Array<{ client_id: string | null; closed_at: string | null }>
): { new_count: number; returning_count: number; new_revenue: number } {
  const known = new Set(historyPaid.filter(h => h.client_id).map(h => h.client_id!));
  const todayClients = new Map<string, number>();
  for (const c of today.filter(x => x.is_paid && x.client_id)) {
    todayClients.set(c.client_id!, (todayClients.get(c.client_id!) ?? 0) + Number(c.total));
  }
  let new_count = 0, returning_count = 0, new_revenue = 0;
  for (const [cid, revenue] of todayClients) {
    if (known.has(cid)) {
      returning_count += 1;
    } else {
      new_count += 1;
      new_revenue += revenue;
    }
  }
  return { new_count, returning_count, new_revenue };
}

export function calculateCashback(
  credits: Array<{ amount: number; type: "earned" | "redeemed" }>
): { credited: number; redeemed: number; balance_change: number } {
  let credited = 0, redeemed = 0;
  for (const c of credits) {
    if (c.type === "earned") credited += Math.abs(Number(c.amount));
    else if (c.type === "redeemed") redeemed += Math.abs(Number(c.amount));
  }
  return { credited, redeemed, balance_change: credited - redeemed };
}

export function calculateTowels(comandas: ComandaWithItems[]): { count: number; cost: number } {
  const count = comandas.filter(c => c.is_paid).length;
  return { count, cost: count * 1.60 };
}

export function calculateQueueUnattended(
  entries: Array<{ id: string; status: string; client_name: string }>
): { count: number; list: Array<{ id: string; client: string }> } {
  const list = entries
    .filter(e => e.status === "abandoned" || e.status === "timeout")
    .map(e => ({ id: e.id, client: e.client_name }));
  return { count: list.length, list };
}

export function calculateSevenDayAverage(
  history: Array<{ date: string; revenue: number; bookings: number }>
): { revenue: number; bookings: number; ticket: number } {
  if (history.length === 0) return { revenue: 0, bookings: 0, ticket: 0 };
  const last = history.slice(0, 7);
  const revenue = last.reduce((s, h) => s + h.revenue, 0) / last.length;
  const bookings = last.reduce((s, h) => s + h.bookings, 0) / last.length;
  const ticket = bookings === 0 ? 0 : revenue / bookings;
  return { revenue, bookings, ticket };
}
