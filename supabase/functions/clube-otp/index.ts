// Clube da Escova — envio de OTP (prova de posse do telefone).
//
// Falha 13: entrar na fila do Clube exigia só o telefone (qualquer pessoa com
// o número de uma assinante consumia crédito dela). Agora o fluxo é:
//   1. browser chama esta function com o celular;
//   2. geramos código de 6 dígitos, gravamos SÓ O HASH em clube_otp (5 min)
//      e enviamos por WhatsApp via Z-API (segredos em salon_secrets);
//   3. browser chama a RPC clube_entrar_fila(celular, otp).
// Rate limit: máx 3 códigos por telefone a cada 10 minutos.
// Sem Z-API configurada ⇒ FALHA FECHADA (nenhum código sai por outro canal).
//
// Deploy: npx supabase functions deploy clube-otp --no-verify-jwt \
//           --project-ref ewxiaxsmohxuabcmxuyc
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSalonSecrets } from "../_shared/auth.ts";

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

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { celular } = await req.json();
    const digits = String(celular ?? "").replace(/\D/g, "");
    if (digits.length < 8) return json({ ok: false, erro: "celular_invalido" }, 400);

    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    // Só manda OTP para telefone de assinante ATIVA (não vaza se o nº existe:
    // resposta é sempre a mesma).
    const genericOk = { ok: true, enviado: true };
    const { data: assinantes } = await supa
      .from("clube_assinantes")
      .select("id, celular")
      .eq("status", "ativo");
    const isAssinante = (assinantes ?? []).some((a: { celular: string | null }) =>
      (a.celular ?? "").replace(/\D/g, "").slice(-8) === digits.slice(-8)
    );
    if (!isAssinante) {
      console.warn("clube-otp: telefone não é de assinante ativa — resposta genérica");
      return json(genericOk);
    }

    // Rate limit: 3 códigos / 10 min por telefone
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count } = await supa
      .from("clube_otp")
      .select("id", { count: "exact", head: true })
      .eq("celular_digits", digits)
      .gte("created_at", tenMinAgo);
    if ((count ?? 0) >= 3) {
      return json({ ok: false, erro: "muitas_tentativas" }, 429);
    }

    // Z-API do salão (cofre backend-only) — sem ela, falha fechada.
    const { data: salon } = await supa
      .from("salons").select("id").order("created_at").limit(1).maybeSingle();
    if (!salon?.id) return json({ ok: false, erro: "indisponivel" }, 503);
    const secrets = await getSalonSecrets(supa, salon.id);
    if (!secrets?.zapi_instance_id || !secrets?.zapi_token) {
      console.error("clube-otp: Z-API não configurada — OTP indisponível");
      return json({ ok: false, erro: "otp_indisponivel" }, 503);
    }

    // Gera código, grava HASH (sha256(codigo || id da linha))
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const { data: otpRow, error: insErr } = await supa
      .from("clube_otp")
      .insert({
        celular_digits: digits,
        code_hash: "pending",
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      })
      .select("id")
      .single();
    if (insErr || !otpRow) throw insErr ?? new Error("Falha ao criar OTP");

    const hash = await sha256Hex(code + otpRow.id);
    await supa.from("clube_otp").update({ code_hash: hash }).eq("id", otpRow.id);

    // Envia via Z-API
    const fullPhone = digits.startsWith("55") ? digits : `55${digits}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (secrets.zapi_client_token) headers["Client-Token"] = secrets.zapi_client_token;
    const res = await fetch(
      `https://api.z-api.io/instances/${secrets.zapi_instance_id}/token/${secrets.zapi_token}/send-text`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          phone: fullPhone,
          message: `Seu código do Clube da Escova: ${code}\nVale por 5 minutos. Se não foi você, ignore.`,
        }),
      },
    );
    if (!res.ok) {
      console.error("clube-otp: envio Z-API falhou", res.status);
      // invalida o OTP que não foi entregue
      await supa.from("clube_otp").update({ used: true }).eq("id", otpRow.id);
      return json({ ok: false, erro: "envio_falhou" }, 502);
    }

    return json(genericOk);
  } catch (err) {
    console.error("clube-otp error:", err);
    return json({ ok: false, erro: "interno" }, 500);
  }
});
