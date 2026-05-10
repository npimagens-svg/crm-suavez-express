// Webhook Asaas → sincroniza queue_entries.payment_status + alerta chargeback
//
// Eventos cobertos:
//   PAYMENT_CONFIRMED, PAYMENT_RECEIVED      → queue.payment_status = 'confirmed'
//   PAYMENT_OVERDUE                          → log (enum queue não suporta overdue)
//   PAYMENT_DELETED, PAYMENT_REFUNDED        → queue.payment_status = 'refunded'
//   PAYMENT_PARTIALLY_REFUNDED               → log
//   PAYMENT_UPDATED                          → log (mudança valor/vencimento)
//   PAYMENT_CREDIT_CARD_CAPTURE_REFUSED      → log + alerta WhatsApp (cartão recusado)
//   PAYMENT_CHARGEBACK_REQUESTED             → 🚨 ALERTA WHATSAPP IMEDIATO pro Cleiton
//   PAYMENT_CHARGEBACK_DISPUTE               → 🚨 ALERTA dispute em curso
//   PAYMENT_AWAITING_CHARGEBACK_REVERSAL     → 🚨 ALERTA dispute perdida
//
// Token de auth: secret ASAAS_WEBHOOK_TOKEN (gerado pelo Asaas, formato whsec_*).
// Deploy: npx supabase functions deploy asaas-webhook --no-verify-jwt
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CLEITON_WA = "5511976847114"; // alvo dos alertas urgentes
const EVOLUTION_URL = "http://172.18.0.1:8080/message/sendText/claudebot";
const EVOLUTION_KEY = Deno.env.get("EVOLUTION_KEY") ?? "EvoStack2026Key!";

const fmtBRL = (n: number) =>
  `R$ ${Number(n).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

// Tenta enviar mensagem urgente pro Cleiton via Evolution claudebot.
// Best-effort: erro NÃO trava o webhook (Asaas precisa de 200 rápido).
async function alertCleiton(text: string): Promise<void> {
  try {
    await fetch(EVOLUTION_URL, {
      method: "POST",
      headers: { "apikey": EVOLUTION_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        number: CLEITON_WA,
        options: { delay: 1200, presence: "composing" },
        textMessage: { text },
      }),
    });
  } catch (err) {
    console.error("alertCleiton failed:", err);
  }
}

Deno.serve(async (req) => {
  // GET/HEAD = sanity check (front Asaas valida URL).
  if (req.method === "GET" || req.method === "HEAD") {
    return new Response(
      JSON.stringify({ ok: true, service: "asaas-webhook" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const headerToken = req.headers.get("asaas-access-token") ?? "";
  const expectedToken = Deno.env.get("ASAAS_WEBHOOK_TOKEN") ?? "";

  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  if (expectedToken && headerToken !== expectedToken) {
    console.warn("Asaas webhook: token mismatch, ignoring");
    return new Response("Token mismatch", { status: 401 });
  }

  const event: string = body.event ?? "";
  const payment = body.payment;
  if (!payment?.id) {
    return new Response("No payment", { status: 400 });
  }

  // Mapeia evento → novo payment_status do queue_entries
  const confirmed = ["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"].includes(event);
  const overdue = event === "PAYMENT_OVERDUE";
  const deleted = ["PAYMENT_DELETED", "PAYMENT_REFUNDED", "PAYMENT_PARTIALLY_REFUNDED"].includes(event);
  const chargeback = [
    "PAYMENT_CHARGEBACK_REQUESTED",
    "PAYMENT_CHARGEBACK_DISPUTE",
    "PAYMENT_AWAITING_CHARGEBACK_REVERSAL",
  ].includes(event);
  const cardRefused = event === "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED";

  let newStatus: string | null = null;
  if (confirmed) newStatus = "confirmed";
  else if (deleted) newStatus = "refunded";

  let action = "ignored";

  // Sync queue_entries quando aplicável
  if (newStatus) {
    const { data: updated, error: qErr } = await supa
      .from("queue_entries")
      .update({
        payment_status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("payment_id", payment.id)
      .select("id, salon_id, customer_name");

    if (qErr) {
      console.error("queue_entries update error:", qErr);
    } else {
      action = `${newStatus} (${updated?.length ?? 0} rows)`;
    }
  }

  // 🚨 ALERTAS URGENTES via WhatsApp
  if (chargeback) {
    const valueText = payment.value ? fmtBRL(Number(payment.value)) : "(valor ?)";
    const customerHint = payment.description ?? payment.customer ?? payment.id;
    let title: string;
    if (event === "PAYMENT_CHARGEBACK_REQUESTED") {
      title = "🚨 CHARGEBACK ABERTO";
    } else if (event === "PAYMENT_CHARGEBACK_DISPUTE") {
      title = "🚨 CHARGEBACK em DISPUTE";
    } else {
      title = "🚨 CHARGEBACK PERDIDO — vai descontar";
    }
    await alertCleiton(
      `${title}\n\n` +
      `💳 Valor: *${valueText}*\n` +
      `📝 Cobrança: ${customerHint}\n` +
      `🆔 ${payment.id}\n\n` +
      `Entre no Asaas e veja o que fazer (defender, refund, etc).\n` +
      `https://www.asaas.com/payments/show/${payment.id}`
    );
    action = `chargeback_alert_sent (${event})`;
  } else if (cardRefused) {
    const valueText = payment.value ? fmtBRL(Number(payment.value)) : "(valor ?)";
    await alertCleiton(
      `⚠️ Cartão recusado no Asaas\n\n` +
      `💳 Valor: ${valueText}\n` +
      `🆔 ${payment.id}\n` +
      `📝 ${payment.description ?? ""}\n\n` +
      `Cliente provavelmente vai voltar pedindo pra pagar de outra forma. ` +
      `Verifique antes de atender.`
    );
    action = "card_refused_alert_sent";
  } else if (overdue) {
    action = "overdue_logged";
  } else if (event === "PAYMENT_UPDATED") {
    action = "updated_logged";
  }

  console.log(
    `Asaas webhook: event=${event} payment=${payment.id} status=${payment.status} → ${action}`,
  );

  return new Response(
    JSON.stringify({ ok: true, event, payment_id: payment.id, action }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
});
