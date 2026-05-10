// Match exato: transação PagBank EDI ↔ payment do sistema.
// Persiste `payments.pagbank_nsu` quando achar par único.
// Permite detector identificar cartão SEM PagBank correspondente (suspeito).

import type { PagBankTransaction } from "./types.ts";

interface PaymentRow {
  id: string;
  comanda_id: string;
  amount: number;
  payment_method: string;
  created_at: string;
  pagbank_nsu: string | null;
}

const PAGBANK_METHOD_MAP: Record<number, string> = {
  3: "credit_card",
  8: "debit_card",
  11: "pix",
  15: "debit_card",
};

interface MatchResult {
  matched: number;
  alreadyMatched: number;
  unmatchedPagbank: PagBankTransaction[];
  unmatchedSystem: PaymentRow[];
}

/**
 * Tenta associar cada transação PagBank do dia a um payment do sistema com
 * mesmo valor, método e timestamp ±30min. Salva NSU quando match único.
 */
// deno-lint-ignore no-explicit-any
export async function matchPagbankToPayments(
  // deno-lint-ignore no-explicit-any
  supa: any,
  salonId: string,
  startDate: string,
  endDate: string,
  pagbank: PagBankTransaction[],
): Promise<MatchResult> {
  // Busca payments cartão do range que ainda não têm NSU
  const startTz = `${startDate}T00:00:00-03:00`;
  // endDate + 1 dia (pagamento pode ter sido lançado depois da venda)
  const endNext = new Date(endDate + "T00:00:00Z");
  endNext.setUTCDate(endNext.getUTCDate() + 1);
  const endTz = endNext.toISOString().slice(0, 10) + "T00:00:00-03:00";

  const { data: payments, error } = await supa
    .from("payments")
    .select("id, comanda_id, amount, payment_method, created_at, pagbank_nsu")
    .eq("salon_id", salonId)
    .in("payment_method", ["credit_card", "debit_card"])
    .gte("created_at", startTz)
    .lt("created_at", endTz);

  if (error) {
    console.error("matchPagbank query error:", error);
    return { matched: 0, alreadyMatched: 0, unmatchedPagbank: pagbank, unmatchedSystem: [] };
  }

  // deno-lint-ignore no-explicit-any
  const rows = (payments ?? []) as PaymentRow[];
  const alreadyMatched = rows.filter(r => r.pagbank_nsu).length;
  const candidates = rows.filter(r => !r.pagbank_nsu);

  // Index payments por (método, valor) pra busca rápida
  const byKey = new Map<string, PaymentRow[]>();
  for (const p of candidates) {
    const key = `${p.payment_method}__${Number(p.amount).toFixed(2)}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(p);
  }

  const TOLERANCE_MS = 30 * 60 * 1000; // 30 minutos
  const updates: Array<{ id: string; nsu: string; authorized_at: string }> = [];
  const unmatchedPagbank: PagBankTransaction[] = [];
  const consumed = new Set<string>(); // payment.id já casado

  for (const tx of pagbank) {
    const method = PAGBANK_METHOD_MAP[tx.meio_pagamento];
    if (!method || method === "pix") {
      // PIX EDI não passa pela maquininha do mesmo jeito — pular
      continue;
    }
    if (!tx.nsu || !tx.data_venda_ajuste || !tx.hora_venda_ajuste) {
      // Sem identificadores → não dá pra linkar
      unmatchedPagbank.push(tx);
      continue;
    }
    const key = `${method}__${Number(tx.valor_total_transacao).toFixed(2)}`;
    const pool = (byKey.get(key) ?? []).filter(p => !consumed.has(p.id));

    if (pool.length === 0) {
      unmatchedPagbank.push(tx);
      continue;
    }

    // Calcula timestamp da venda PagBank (em BRT, vira UTC)
    const txTime = new Date(
      `${tx.data_venda_ajuste}T${tx.hora_venda_ajuste}-03:00`
    ).getTime();

    // Acha o payment mais próximo no tempo (dentro da tolerância)
    let bestMatch: PaymentRow | null = null;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const p of pool) {
      const delta = Math.abs(new Date(p.created_at).getTime() - txTime);
      if (delta < bestDelta && delta < TOLERANCE_MS) {
        bestDelta = delta;
        bestMatch = p;
      }
    }

    if (bestMatch) {
      consumed.add(bestMatch.id);
      updates.push({
        id: bestMatch.id,
        nsu: tx.nsu,
        authorized_at: new Date(txTime).toISOString(),
      });
    } else {
      unmatchedPagbank.push(tx);
    }
  }

  // Aplica updates em lote (n=1 by 1, pois supabase-js não tem bulk update por id)
  for (const u of updates) {
    await supa
      .from("payments")
      .update({
        pagbank_nsu: u.nsu,
        pagbank_authorized_at: u.authorized_at,
      })
      .eq("id", u.id);
  }

  const unmatchedSystem = candidates.filter(p => !consumed.has(p.id));

  console.log(
    `matchPagbank: ${updates.length} novos matches, ${alreadyMatched} já matched, ` +
    `${unmatchedPagbank.length} PagBank órfãs, ${unmatchedSystem.length} sistema sem PagBank`,
  );

  return {
    matched: updates.length,
    alreadyMatched,
    unmatchedPagbank,
    unmatchedSystem,
  };
}
