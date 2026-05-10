// Webhook Asaas → sincroniza queue_entries.payment_status
//
// Configurado em https://www.asaas.com/config/notifications:
//   URL:           https://ewxiaxsmohxuabcmxuyc.supabase.co/functions/v1/asaas-webhook
//   Eventos:       PAYMENT_CONFIRMED, PAYMENT_RECEIVED, PAYMENT_OVERDUE,
//                  PAYMENT_DELETED, PAYMENT_REFUNDED
//   Access Token:  igual ao queue_settings.asaas_api_key do salão
//
// Deploy: npx supabase functions deploy asaas-webhook --no-verify-jwt
// (sem JWT porque Asaas não manda Bearer Authorization).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const headerToken = req.headers.get("asaas-access-token") ?? "";

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  // Validação opcional: se vier token no header, ele DEVE bater com alguma
  // queue_settings.asaas_api_key. Se vier vazio, aceita (MVP).
  if (headerToken) {
    const { data: qs } = await supa
      .from("queue_settings")
      .select("salon_id")
      .eq("asaas_api_key", headerToken)
      .limit(1)
      .maybeSingle();

    if (!qs) {
      console.warn("Asaas webhook: token mismatch, ignoring");
      return new Response("Token mismatch", { status: 401 });
    }
  }

  const event: string = body.event ?? "";
  const payment = body.payment;
  if (!payment?.id) {
    return new Response("No payment", { status: 400 });
  }

  // Mapeia evento -> novo payment_status do queue_entries
  const confirmed = ["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"].includes(event);
  const overdue = event === "PAYMENT_OVERDUE";
  const deleted = ["PAYMENT_DELETED", "PAYMENT_REFUNDED"].includes(event);

  let newStatus: string | null = null;
  if (confirmed) newStatus = "confirmed";
  else if (overdue) newStatus = "pending"; // mantém pending; overdue não é enum válido
  else if (deleted) newStatus = "refunded";

  let action = "ignored";
  if (newStatus) {
    const updatePayload: Record<string, unknown> = {
      payment_status: newStatus,
      updated_at: new Date().toISOString(),
    };

    const { data: updated, error: qErr } = await supa
      .from("queue_entries")
      .update(updatePayload)
      .eq("payment_id", payment.id)
      .select("id, salon_id, customer_name");

    if (qErr) {
      console.error("queue_entries update error:", qErr);
    } else {
      action = `${newStatus} (${updated?.length ?? 0} rows)`;
      if (confirmed && updated && updated.length > 0) {
        console.log(
          `Asaas ${payment.id} confirmed → ${updated[0].customer_name} (${updated[0].salon_id})`
        );
      }
    }
  }

  console.log(
    `Asaas webhook: event=${event} payment=${payment.id} status=${payment.status} → ${action}`
  );

  return new Response(
    JSON.stringify({ ok: true, event, payment_id: payment.id, action }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
});
