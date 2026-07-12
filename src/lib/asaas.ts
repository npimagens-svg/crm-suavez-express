import { supabase } from "@/lib/dynamicSupabaseClient";

// Fluxo NOVO de checkout (falhas 3/10/11/12 corrigidas):
// - O browser manda apenas serviços escolhidos + dados de contato.
// - Preço, salão e snapshot ficam SERVER-SIDE (purchase_intents, via
//   Edge Function asaas-checkout).
// - Cartão: checkout HOSPEDADO do Asaas (invoice_url) — número/CVV nunca
//   passam pelo nosso código.
// - A entrada na fila é criada pelo asaas-webhook; o browser só consulta o
//   status da intenção (RPC fila_intent_status) e recebe o token opaco.

export interface CheckoutInput {
  serviceIds: string[];
  name: string;
  cpfCnpj: string;
  phone: string;
  email?: string;
  billing: "pix" | "card";
  notifyMinutesBefore?: number;
  idempotencyKey?: string;
}

export interface PixQrCode {
  encodedImage: string;
  payload: string;
  expirationDate: string;
}

export interface CheckoutResponse {
  intent_id: string;
  total: number;
  description: string;
  billing: "pix" | "card";
  invoice_url: string | null;
  pix_qr_code: PixQrCode | null;
  reused?: boolean;
}

export async function createCheckout(input: CheckoutInput): Promise<CheckoutResponse> {
  const { data, error } = await supabase.functions.invoke("asaas-checkout", {
    body: {
      service_ids: input.serviceIds,
      name: input.name,
      cpf_cnpj: input.cpfCnpj,
      phone: input.phone,
      email: input.email || null,
      billing: input.billing,
      notify_minutes_before: input.notifyMinutesBefore ?? 40,
      idempotency_key: input.idempotencyKey ?? null,
    },
  });
  if (error) {
    throw new Error(error.message || "Erro na comunicação com o servidor");
  }
  if (data?.error) throw new Error(data.error);
  return data as CheckoutResponse;
}

export interface IntentStatus {
  found: boolean;
  status?: "pending" | "paid" | "queued" | "cancelled" | "refunded" | "chargeback";
  tracking_token?: string | null;
}

export async function getIntentStatus(intentId: string): Promise<IntentStatus> {
  const { data, error } = await supabase.rpc("fila_intent_status", { p_intent: intentId });
  if (error) throw new Error(error.message);
  return (data ?? { found: false }) as IntentStatus;
}

// ── Recuperação pós-fechamento do navegador ─────────────────────────────────
// Caso real: a cliente paga o PIX e fecha a aba ANTES do polling confirmar.
// A entrada na fila nasce no SERVIDOR (asaas-webhook) de qualquer jeito; o que
// se perdia era o vínculo do navegador com ela (o tracking_token só chegava
// pelo polling). Guardamos o intent_id pendente e, ao reabrir a página,
// reencontramos o token via fila_intent_status — sem risco de duplicar nada,
// porque o front nunca insere na fila.
const PENDING_INTENT_KEY = "fila_pending_intent";
const PENDING_INTENT_TTL_MS = 24 * 60 * 60 * 1000; // cobrança vence no dia

export function savePendingIntent(intentId: string): void {
  try {
    localStorage.setItem(PENDING_INTENT_KEY, JSON.stringify({ intent_id: intentId, ts: Date.now() }));
  } catch { /* storage indisponível não impede o fluxo */ }
}

export function clearPendingIntent(): void {
  try { localStorage.removeItem(PENDING_INTENT_KEY); } catch { /* noop */ }
}

export function loadPendingIntent(): string | null {
  try {
    const raw = localStorage.getItem(PENDING_INTENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { intent_id?: string; ts?: number };
    if (!parsed.intent_id || !parsed.ts || Date.now() - parsed.ts > PENDING_INTENT_TTL_MS) {
      clearPendingIntent();
      return null;
    }
    return parsed.intent_id;
  } catch {
    clearPendingIntent();
    return null;
  }
}
