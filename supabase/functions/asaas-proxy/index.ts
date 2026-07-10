// asaas-proxy — TRANCADO (falha 3 corrigida).
//
// O fluxo público de checkout mudou para a function asaas-checkout:
// - preço/serviço/salão resolvidos SERVER-SIDE via purchase_intents;
// - cartão via checkout hospedado do Asaas (nunca recebemos número/CVV).
//
// Esta function permanece APENAS como utilitário INTERNO de consulta de
// status para staff autenticado (debug/recepção). As actions de escrita
// (createCustomer/createPayment/createCardPayment) foram REMOVIDAS —
// createCardPayment recebia número de cartão + CVV brutos do browser.
//
// Deploy: npx supabase functions deploy asaas-proxy --no-verify-jwt \
//           --project-ref ewxiaxsmohxuabcmxuyc
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSalonSecrets, requireStaff } from "../_shared/auth.ts";

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
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const staff = await requireStaff(req, supa);
    if (!staff.ok) return json({ error: staff.error }, staff.status);

    const { action, data } = await req.json();

    // Salão do usuário autenticado — nunca do body.
    let salonId = staff.salonId;
    if (salonId === "*") {
      const { data: salon } = await supa
        .from("salons").select("id").order("created_at").limit(1).maybeSingle();
      salonId = salon?.id;
    }
    if (!salonId) return json({ error: "Salão não encontrado" }, 400);

    const secrets = await getSalonSecrets(supa, salonId);
    const apiKey = secrets?.asaas_api_key || Deno.env.get("ASAAS_KEY") || "";
    if (!apiKey) return json({ error: "Asaas API key not configured" }, 503);

    const headers = { "Content-Type": "application/json", access_token: apiKey };

    if (action === "getPaymentStatus") {
      const res = await fetch(`${ASAAS_BASE_URL}/payments/${data?.paymentId}`, { headers });
      const payment = await res.json();
      return json({ status: payment.status });
    }

    if (action === "getPixQrCode") {
      const res = await fetch(`${ASAAS_BASE_URL}/payments/${data?.paymentId}/pixQrCode`, { headers });
      return json(await res.json());
    }

    // Qualquer action de escrita foi removida deste proxy.
    return json({ error: "Ação não suportada — use asaas-checkout" }, 410);
  } catch (error) {
    console.error("asaas-proxy error:", error);
    return json({ error: "Erro interno" }, 500);
  }
});
