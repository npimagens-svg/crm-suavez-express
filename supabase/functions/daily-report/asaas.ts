// Cliente HTTP do Asaas v3 — gateway de pagamento online da fila.
// Diferente do PagBank (taxa real cartão presencial), o Asaas processa PIX +
// cartão online. A API key fica em queue_settings.asaas_api_key (1 por salão)
// e é passada pra cá pela generateReport.

import type { AsaasPayment } from "./types.ts";

const BASE_URL = "https://api.asaas.com/v3";
const PAGE_LIMIT = 100;

export interface AsaasResult {
  unavailable: boolean;
  payments: AsaasPayment[];
  raw: unknown;
}

/**
 * Busca todos os payments criados entre dateFromISO e dateToISO (inclusive).
 * Pagina enquanto hasMore=true. Em qualquer erro (HTTP != 2xx, exception),
 * devolve unavailable=true e payments vazio.
 */
export async function fetchAsaasPayments(
  dateFromISO: string,
  dateToISO: string,
  apiKey: string,
): Promise<AsaasResult> {
  if (!apiKey) {
    return { unavailable: true, payments: [], raw: null };
  }

  const all: AsaasPayment[] = [];
  let offset = 0;
  let lastRaw: unknown = null;

  try {
    while (true) {
      const url =
        `${BASE_URL}/payments` +
        `?dateCreated[ge]=${dateFromISO}` +
        `&dateCreated[le]=${dateToISO}` +
        `&limit=${PAGE_LIMIT}` +
        `&offset=${offset}`;

      const resp = await fetch(url, {
        headers: {
          "access_token": apiKey,
          "Accept": "application/json",
        },
      });

      if (!resp.ok) {
        console.warn(`Asaas HTTP ${resp.status} for ${dateFromISO}..${dateToISO}`);
        return { unavailable: true, payments: [], raw: null };
      }

      const json = await resp.json() as {
        data?: AsaasPayment[];
        hasMore?: boolean;
        limit?: number;
        offset?: number;
        totalCount?: number;
      };
      lastRaw = json;

      const batch = (json.data ?? []) as AsaasPayment[];
      all.push(...batch);

      if (!json.hasMore || batch.length === 0) break;
      offset += batch.length;
      // Sanity: limita a 50 páginas (5000 payments num período) — qualquer
      // coisa acima é provavelmente loop infinito por bug de paginação.
      if (offset >= PAGE_LIMIT * 50) {
        console.warn("Asaas pagination cap reached at", offset);
        break;
      }
    }

    return { unavailable: false, payments: all, raw: lastRaw };
  } catch (err) {
    console.error("Asaas fetch error:", err);
    return { unavailable: true, payments: [], raw: null };
  }
}
