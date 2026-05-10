// Cliente HTTP do PagBank EDI v3.00
// Spec: docs/superpowers/specs/2026-05-10-fechamento-diario-design.md
// Token salvo em N8N Credentials + Supabase Secrets (PAGBANK_USER + PAGBANK_TOKEN)

import type { PagBankTransaction } from "./types.ts";

export interface PagBankAuth { user: string; token: string }

export interface PagBankResult {
  unavailable: boolean;
  transactions: PagBankTransaction[];
  raw: unknown;
}

const BASE_URL = "https://edi.api.pagbank.com.br/movement/v3.00/transactional";

export async function fetchPagBankTransactional(
  dateISO: string,
  auth: PagBankAuth
): Promise<PagBankResult> {
  const credentials = btoa(`${auth.user}:${auth.token}`);
  try {
    const resp = await fetch(`${BASE_URL}/${dateISO}`, {
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Accept": "application/json"
      }
    });
    if (!resp.ok) {
      console.warn(`PagBank EDI HTTP ${resp.status} for ${dateISO}`);
      return { unavailable: true, transactions: [], raw: null };
    }
    const json = await resp.json();
    return {
      unavailable: false,
      transactions: (json.detalhes ?? []) as PagBankTransaction[],
      raw: json
    };
  } catch (err) {
    console.error("PagBank EDI fetch error:", err);
    return { unavailable: true, transactions: [], raw: null };
  }
}
