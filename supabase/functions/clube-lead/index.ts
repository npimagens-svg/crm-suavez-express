// Captura o lead do PASSO 1 do checkout do Clube (abandono de carrinho):
// grava em clube_leads e avisa por e-mail na hora, pra equipe recuperar.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("method", { status: 405, headers: CORS });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return new Response("bad json", { status: 400, headers: CORS });
  }

  const nome = String(body.nome ?? "").trim().slice(0, 120);
  const whatsapp = String(body.whatsapp ?? "").replace(/\D/g, "").slice(0, 13);
  const email = String(body.email ?? "").trim().slice(0, 160) || null;
  const plano = String(body.plano ?? "").slice(0, 60) || null;
  const valor = Number(body.valor) || null;
  // honeypot simples: campo extra preenchido = bot
  if (body.site) return new Response("ok", { headers: CORS });
  if (nome.length < 5 || whatsapp.length < 10) {
    return new Response("invalid", { status: 400, headers: CORS });
  }

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // dedup: mesmo whatsapp nas últimas 6h não duplica nem re-avisa
  const corte = new Date(Date.now() - 6 * 3600_000).toISOString();
  const { data: recente } = await supa
    .from("clube_leads")
    .select("id")
    .eq("whatsapp", whatsapp)
    .gte("created_at", corte)
    .limit(1)
    .maybeSingle();
  if (recente) return new Response(JSON.stringify({ ok: true, dup: true }), { headers: { ...CORS, "content-type": "application/json" } });

  await supa.from("clube_leads").insert({ nome, whatsapp, email, plano, valor });

  // e-mail imediato pro Cleiton
  let resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    const { data: cfg } = await supa.from("system_config")
      .select("value").eq("key", "resend_api_key").maybeSingle();
    resendKey = cfg?.value || null;
  }
  if (resendKey) {
    const waLink = `https://wa.me/55${whatsapp.replace(/^55/, "")}`;
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/124 Safari/537.36",
      },
      body: JSON.stringify({
        from: "Clube da Escova <clube@nphairexpress.com.br>",
        to: ["npimagens@gmail.com"],
        subject: `🛒 Abandono de checkout — ${nome.split(" ")[0]} (${plano ?? "Clube"})`,
        html: `
          <div style="font-family:system-ui,Arial;max-width:520px;margin:0 auto;padding:20px;color:#1f2937">
            <h2 style="color:#F7A100;margin:0 0 6px">Quase assinou o Clube 👀</h2>
            <p>Preencheu os dados no passo 1 e parou no cartão. Corre atrás:</p>
            <table style="font-size:15px;line-height:1.9">
              <tr><td style="color:#6b7280;padding-right:14px">Nome</td><td><b>${nome}</b></td></tr>
              <tr><td style="color:#6b7280">WhatsApp</td><td><b>${whatsapp}</b></td></tr>
              <tr><td style="color:#6b7280">E-mail</td><td>${email ?? "—"}</td></tr>
              <tr><td style="color:#6b7280">Plano</td><td>${plano ?? "—"}${valor ? ` · R$ ${valor}` : ""}</td></tr>
            </table>
            <p style="margin:22px 0"><a href="${waLink}" style="background:#F7A100;color:#000;font-weight:700;padding:12px 22px;border-radius:8px;text-decoration:none">Chamar no WhatsApp</a></p>
            <p style="font-size:12px;color:#9ca3af">NP Hair Express · captura automática do checkout</p>
          </div>`,
      }),
    }).catch(() => null);
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, "content-type": "application/json" } });
});
