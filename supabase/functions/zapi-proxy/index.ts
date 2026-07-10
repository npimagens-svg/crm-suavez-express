// Envio de WhatsApp via Z-API — SÓ para staff autenticado do salão.
//
// SEGURANÇA (falha 4 corrigida):
// - Antes: qualquer pessoa na internet mandava mensagem arbitrária em nome do
//   salão. Agora: exige JWT válido de usuário com salão (ou service_role para
//   chamadas server→server internas).
// - O salonId NÃO vem do browser: é o salão do usuário autenticado.
// - Segredos Z-API saem de salon_secrets (backend-only), não de queue_settings.
//
// Deploy: npx supabase functions deploy zapi-proxy --no-verify-jwt \
//           --project-ref ewxiaxsmohxuabcmxuyc
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSalonSecrets, requireStaff } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

    const { phone, message, salonId: bodySalonId } = await req.json();
    if (!phone || !message) return json({ error: "phone e message obrigatórios" }, 400);

    // Salão = o do usuário autenticado. service_role pode indicar no body.
    let salonId = staff.salonId;
    if (salonId === "*") {
      salonId = bodySalonId;
      if (!salonId) return json({ error: "salonId obrigatório para service_role" }, 400);
    }

    const secrets = await getSalonSecrets(supa, salonId);
    if (!secrets?.zapi_instance_id || !secrets?.zapi_token) {
      return json({ error: "Z-API not configured" }, 200);
    }

    const cleanPhone = String(phone).replace(/\D/g, "");
    const fullPhone = cleanPhone.startsWith("55") ? cleanPhone : `55${cleanPhone}`;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (secrets.zapi_client_token) {
      headers["Client-Token"] = secrets.zapi_client_token;
    }

    const res = await fetch(
      `https://api.z-api.io/instances/${secrets.zapi_instance_id}/token/${secrets.zapi_token}/send-text`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ phone: fullPhone, message: String(message) }),
      },
    );

    const result = await res.json();
    return json(result, 200);
  } catch (error) {
    console.error("zapi-proxy error:", error);
    return json({ error: "Erro interno" }, 500);
  }
});
