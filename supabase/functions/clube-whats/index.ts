// WhatsApp pela Maia (Evolution maia-express) a pedido do banco.
//
// 22/10/2026: o banco (pg_net, saída 184.33.61.203) não alcança mais a VPS 72.60.6.168 em
// porta nenhuma (tcpdump na VPS não vê pacote: bloqueio antes dela, na borda), enquanto a
// edge alcança. Os crons do Clube (alerta_clube_lead, clube_recuperar_abandono) mandam por aqui.
// Auth: header x-queue-cron-secret == secret QUEUE_CRON_SECRET (falha fechada).
//
// Deploy: npx supabase functions deploy clube-whats --no-verify-jwt --project-ref ewxiaxsmohxuabcmxuyc
import { sendWhatsApp } from "../_shared/whatsapp_fila.ts";

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const expected = Deno.env.get("QUEUE_CRON_SECRET") ?? "";
  if (!expected) return json({ error: "QUEUE_CRON_SECRET não configurado (falha fechada)" }, 503);
  if ((req.headers.get("x-queue-cron-secret") ?? "") !== expected) return json({ error: "unauthorized" }, 401);

  let body: { number?: unknown; text?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "json inválido" }, 400);
  }
  const number = String(body?.number ?? "").replace(/\D/g, "");
  const text = String(body?.text ?? "");
  if (number.length < 10 || !text) return json({ error: "number e text obrigatórios" }, 400);

  const ok = await sendWhatsApp(number, text, "clube-whats");
  return json({ ok }, ok ? 200 : 502);
});
