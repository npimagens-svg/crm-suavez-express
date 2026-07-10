// Checkout público da fila digital — SUBSTITUI o uso público do asaas-proxy.
//
// Segurança (correção das falhas 3, 10, 11, 12):
// - O browser manda APENAS: serviços escolhidos, dados de contato e forma.
// - O SERVIDOR resolve salão, valida serviços ativos, calcula o PREÇO do banco
//   (snapshot gravado em purchase_intents) e cria a cobrança no Asaas com
//   externalReference = id da intent.
// - CARTÃO: nunca recebemos número/CVV — devolvemos a invoiceUrl do checkout
//   HOSPEDADO do Asaas.
// - A queue_entry é criada pelo asaas-webhook (idempotente), NÃO pelo browser.
// - Segredos: salon_secrets (backend-only) com fallback ASAAS_KEY (Supabase
//   Secrets). Ausentes ⇒ falha fechada.
//
// Deploy: npx supabase functions deploy asaas-checkout --no-verify-jwt \
//           --project-ref ewxiaxsmohxuabcmxuyc
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSalonSecrets } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ASAAS_BASE_URL = "https://api.asaas.com/v3";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const serviceIds: string[] = Array.isArray(body.service_ids) ? body.service_ids : [];
    const name = String(body.name ?? "").trim();
    const phone = String(body.phone ?? "").replace(/\D/g, "");
    const email = body.email ? String(body.email).trim() : null;
    const cpfCnpj = String(body.cpf_cnpj ?? "").replace(/\D/g, "");
    const billing = body.billing === "card" ? "card" : "pix";
    const notifyMinutes = Number(body.notify_minutes_before) || 40;
    const idempotencyKey = body.idempotency_key ? String(body.idempotency_key).slice(0, 80) : null;

    if (!name || phone.length < 8 || serviceIds.length === 0 || serviceIds.length > 10) {
      return json({ error: "Dados inválidos" }, 400);
    }
    if (!cpfCnpj) return json({ error: "CPF obrigatório" }, 400);

    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    // Servidor resolve o salão (single-tenant) — browser NÃO manda salonId.
    const { data: salon } = await supa
      .from("salons").select("id").order("created_at").limit(1).maybeSingle();
    if (!salon?.id) return json({ error: "Salão não configurado" }, 500);
    const salonId = salon.id;

    // Idempotência: mesma compra reenviada devolve a intent existente.
    if (idempotencyKey) {
      const { data: existing } = await supa
        .from("purchase_intents")
        .select("id, status, asaas_payment_id")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existing) {
        return json({ intent_id: existing.id, status: existing.status, reused: true });
      }
    }

    // Preço vem do BANCO — o que o browser acha que custa é irrelevante.
    const { data: services, error: svcErr } = await supa
      .from("services")
      .select("id, name, price")
      .eq("salon_id", salonId)
      .eq("is_active", true)
      .eq("queue_enabled", true)
      .in("id", serviceIds);
    if (svcErr) throw svcErr;
    if (!services || services.length !== serviceIds.length) {
      return json({ error: "Serviço inválido ou indisponível" }, 400);
    }
    const total = services.reduce((sum: number, s: { price: number }) => sum + Number(s.price || 0), 0);
    if (total <= 0) return json({ error: "Valor inválido" }, 400);
    const description = services.map((s: { name: string }) => s.name).join(" + ");

    // Segredo do Asaas: cofre por salão → fallback Supabase Secrets. Falha fechada.
    const secrets = await getSalonSecrets(supa, salonId);
    const asaasKey = secrets?.asaas_api_key || Deno.env.get("ASAAS_KEY") || "";
    if (!asaasKey) return json({ error: "Pagamento indisponível no momento" }, 503);
    const asaasHeaders = { "Content-Type": "application/json", access_token: asaasKey };

    // Intenção de compra ANTES do pagamento (snapshot server-side).
    const { data: intent, error: intentErr } = await supa
      .from("purchase_intents")
      .insert({
        salon_id: salonId,
        customer_name: name,
        customer_phone: phone,
        customer_email: email,
        service_ids: serviceIds,
        description,
        total,
        billing_type: billing === "card" ? "CREDIT_CARD" : "PIX",
        idempotency_key: idempotencyKey,
        notify_minutes_before: notifyMinutes,
        status: "pending",
      })
      .select("id")
      .single();
    if (intentErr || !intent) throw intentErr ?? new Error("Falha ao criar intenção");

    // Cliente no Asaas
    const custRes = await fetch(`${ASAAS_BASE_URL}/customers`, {
      method: "POST",
      headers: asaasHeaders,
      body: JSON.stringify({ name, cpfCnpj, phone, email: email || undefined }),
    });
    let customer = await custRes.json();
    if (customer.errors) {
      const match = customer.errors[0]?.description?.match(/cus_\w+/);
      if (match) customer = { id: match[0] };
      else {
        await supa.from("purchase_intents").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", intent.id);
        return json({ error: customer.errors[0]?.description || "Erro ao registrar cliente" }, 400);
      }
    }

    // Cobrança — externalReference = intent.id (o webhook usa isso).
    const payRes = await fetch(`${ASAAS_BASE_URL}/payments`, {
      method: "POST",
      headers: asaasHeaders,
      body: JSON.stringify({
        customer: customer.id,
        billingType: billing === "card" ? "CREDIT_CARD" : "PIX",
        value: total,
        description,
        externalReference: intent.id,
        dueDate: new Date().toISOString().split("T")[0],
      }),
    });
    const payment = await payRes.json();
    if (payment.errors) {
      await supa.from("purchase_intents").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", intent.id);
      return json({ error: payment.errors[0]?.description || "Erro no pagamento" }, 400);
    }

    await supa.from("purchase_intents").update({
      asaas_customer_id: customer.id,
      asaas_payment_id: payment.id,
      updated_at: new Date().toISOString(),
    }).eq("id", intent.id);

    // PIX: QR code; cartão: checkout hospedado (invoiceUrl) — sem cartão bruto.
    let pixQrCode = null;
    if (billing === "pix") {
      const qrRes = await fetch(`${ASAAS_BASE_URL}/payments/${payment.id}/pixQrCode`, { headers: asaasHeaders });
      const qr = await qrRes.json();
      if (qr && qr.success !== false) pixQrCode = qr;
    }

    return json({
      intent_id: intent.id,
      total,
      description,
      billing,
      invoice_url: payment.invoiceUrl ?? null,
      pix_qr_code: pixQrCode,
    });
  } catch (err) {
    console.error("asaas-checkout error:", err);
    return json({ error: "Erro interno" }, 500);
  }
});
