// Cron da FILA (roda a cada minuto via pg_cron + pg_net):
//
// 1) AVISO AUTOMÁTICO DE VEZ CHEGANDO — server-side, no tempo que a CLIENTE
//    escolheu (notify_minutes_before). Substitui o hook do navegador
//    (useQueueNotificationCheck), que só funcionava com a tela da recepção
//    aberta. notify_sent só é marcado quando o envio de fato SUCEDE.
// 2) LEADS "ME AVISA QUANDO A FILA DIMINUIR" (queue_leads) — cada lead novo
//    vira e-mail imediato pro dono (npimagens@gmail.com), com link wa.me.
// 3) AVISO AUTOMÁTICO DO LEAD (21/10/2026) — só no horário de atendimento: lead do
//    dia, ainda não avisado, recebe 1 WhatsApp quando a fila (mesmo número da página
//    pública, fila_public_painel) fica abaixo do que ela pediu. Regra em ./leads.ts.
// 0) RECONCILIAÇÃO SEM WEBHOOK (10/10/2026) — intent 'pending' com cobrança há
//    2 min–24 h: consulta o Asaas e, se pago, chama a mesma RPC do asaas-webhook
//    (webhook_pagamento_confirmado, idempotente). Roda antes do bloqueio de casa
//    fechada, como o webhook. Falha aqui nunca derruba os passos 1 e 2.
//    Entrada criada com o salão fechado → WhatsApp "você será atendida em ..."
//    (_shared/whatsapp_fila.ts, mesmo aviso do asaas-webhook).
//
// Auth: header x-queue-cron-secret == secret QUEUE_CRON_SECRET (falha fechada).
// Deploy: npx supabase functions deploy queue-cron --no-verify-jwt \
//           --project-ref ewxiaxsmohxuabcmxuyc
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSalonSecrets } from "../_shared/auth.ts";
import { decidirReconciliacao, mesmoTelefone } from "./reconcilia.ts";
import { avisarSeForaDoHorario, sendWhatsApp } from "../_shared/whatsapp_fila.ts";
import { decidirLead, montarAvisoLead, tamanhoFila } from "./leads.ts";

const LINK_FILA = "https://suavezexpress.vercel.app/fila";
const LEAD_MAX_TENTATIVAS = 3;
const LEAD_MAX_AVISOS_DIA = 30; // teto de WhatsApp automático de lead por dia (formulário é público)

const OWNER_EMAIL = Deno.env.get("QUEUE_LEADS_EMAIL") ?? "npimagens@gmail.com";

// lead.name/phone vêm de formulário PÚBLICO anônimo — escapar antes de pôr no HTML do e-mail
const esc = (s: unknown) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const ASAAS_BASE_URL = "https://api.asaas.com/v3";

// Faz o papel do asaas-webhook para intents pagas cujo evento não chegou (incidente do Asaas em 09/10).
// deno-lint-ignore no-explicit-any
async function reconciliarSemWebhook(supa: any): Promise<{ reconciled: number; reconcile_errors: number; reconcile_skipped_ja_na_fila: number }> {
  const res = { reconciled: 0, reconcile_errors: 0, reconcile_skipped_ja_na_fila: 0 };
  const agora = Date.now();
  const { data: intents, error } = await supa
    .from("purchase_intents")
    .select("id, salon_id, asaas_payment_id, customer_name, customer_phone")
    .eq("status", "pending")
    .not("asaas_payment_id", "is", null)
    .lte("created_at", new Date(agora - 2 * 60_000).toISOString())
    .gte("created_at", new Date(agora - 24 * 3_600_000).toISOString())
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) {
    console.error("queue-cron: reconciliação, leitura das intents falhou", error.message);
    res.reconcile_errors++;
    return res;
  }

  const chaves = new Map<string, string>(); // salon_id → chave do Asaas (cofre, fallback ASAAS_KEY)
  for (const intent of intents ?? []) {
    try {
      let chave = chaves.get(intent.salon_id);
      if (chave === undefined) {
        const secrets = await getSalonSecrets(supa, intent.salon_id);
        const lida: string = secrets?.asaas_api_key || Deno.env.get("ASAAS_KEY") || "";
        chaves.set(intent.salon_id, lida);
        chave = lida;
      }
      if (!chave) throw new Error("chave do Asaas ausente");

      const r = await fetch(`${ASAAS_BASE_URL}/payments/${encodeURIComponent(intent.asaas_payment_id)}`, {
        headers: { access_token: chave },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error(`Asaas HTTP ${r.status}`);
      const payment = await r.json();
      const acao = decidirReconciliacao(payment);

      if (acao === "confirmar") {
        // Guarda (vigia de 09/10): a recepção pode já ter posto a cliente na fila sem pagamento (walk_in).
        // Nesse caso a RPC criaria uma 2ª entrada; não escreve, só avisa.
        const { data: naFila, error: filaErr } = await supa
          .from("queue_entries")
          .select("id, source, customer_phone")
          .eq("salon_id", intent.salon_id)
          .in("status", ["waiting", "checked_in", "in_service"])
          .is("payment_id", null);
        if (filaErr) throw new Error(`ler fila: ${filaErr.message}`);
        // deno-lint-ignore no-explicit-any
        const ja = (naFila ?? []).find((e: any) => mesmoTelefone(e.customer_phone, intent.customer_phone));
        if (ja) {
          console.warn(`queue-cron: pago sem webhook mas já na fila como ${ja.source ?? "?"}: ${intent.asaas_payment_id} ${intent.customer_name ?? ""}`);
          res.reconcile_skipped_ja_na_fila++;
          continue;
        }
        // Mesmos parâmetros do asaas-webhook (bloco "Pagamento confirmado → RPC").
        const { data: result, error: rpcErr } = await supa.rpc("webhook_pagamento_confirmado", {
          p_asaas_payment_id: payment.id ?? intent.asaas_payment_id,
          p_external_reference: payment.externalReference ?? null,
          p_value: payment.value ?? null,
          p_billing_type: payment.billingType ?? null,
        });
        if (rpcErr) throw new Error(`RPC: ${rpcErr.message}`);
        console.log(`queue-cron: reconciliado sem webhook: ${intent.asaas_payment_id} → ${result?.mode ?? "?"}`);
        res.reconciled++;
        // Entrada nasceu agora: se o salão está fechado, avisa a cliente quando será atendida (best-effort).
        if (result?.mode === "created") await avisarSeForaDoHorario(supa, result.queue_entry_id, "queue-cron");
      } else if (acao === "cancelar") {
        // Igual ao asaas-checkout; o filtro em 'pending' evita sobrescrever o que o webhook já resolveu.
        const { error: updErr } = await supa.from("purchase_intents")
          .update({ status: "cancelled", updated_at: new Date().toISOString() })
          .eq("id", intent.id).eq("status", "pending");
        if (updErr) throw new Error(`cancelar intent: ${updErr.message}`);
        console.log(`queue-cron: intent ${intent.id} cancelada (${intent.asaas_payment_id} removida/estornada no Asaas)`);
      }
    } catch (e) {
      console.error(`queue-cron: reconciliação falhou para ${intent.asaas_payment_id}`, String(e).slice(0, 160));
      res.reconcile_errors++;
    }
  }
  return res;
}

Deno.serve(async (req) => {
  const expected = Deno.env.get("QUEUE_CRON_SECRET") ?? "";
  if (!expected) return json({ error: "QUEUE_CRON_SECRET não configurado (falha fechada)" }, 503);
  if ((req.headers.get("x-queue-cron-secret") ?? "") !== expected) {
    return json({ error: "não autorizado" }, 401);
  }

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const out = {
    notified: 0, skipped_no_phone: 0, leads_emailed: 0, leads_notified: 0, errors: 0, skipped_casa_fechada: false,
    reconciled: 0, reconcile_errors: 0, reconcile_skipped_ja_na_fila: 0,
  };

  // ── 0. Reconciliação sem webhook (isolada: nada aqui derruba os passos 1 e 2) ──
  try {
    const rec = await reconciliarSemWebhook(supa);
    out.reconciled = rec.reconciled;
    out.reconcile_errors = rec.reconcile_errors;
    out.reconcile_skipped_ja_na_fila = rec.reconcile_skipped_ja_na_fila;
  } catch (e) {
    console.error("queue-cron: reconciliação erro inesperado", String(e).slice(0, 160));
    out.reconcile_errors++;
  }

  // Com a casa FECHADA ninguém deve receber "sua vez está chegando" — foi o que
  // aconteceu em 08/09, quando a cliente pagou num dia sem expediente e ainda
  // recebeu o aviso pra comparecer.
  // 10/10/2026: a fila online passou a vender 24 h (queue_settings = horário de
  // ATENDIMENTO). Quem compra às 23h já recebe no pagamento o aviso de quando
  // será atendida, e não pode receber "sua vez chegou" de madrugada. Por isso
  // "ja_fechou" e "ainda_nao_abriu" também pulam o passo 1 (os avisos voltam
  // sozinhos na abertura, porque notify_sent segue false).
  // "fechado_hoje"/"pausada" encerram aqui como antes (passo 2 incluso); fora do
  // horário num dia de expediente só o passo 1 é pulado e os leads seguem.
  let foraDoHorario = false;
  const { data: salaoRow } = await supa.from("salons").select("id").order("created_at").limit(1).maybeSingle();
  if (salaoRow?.id) {
    const { data: estado } = await supa.rpc("fila_estado_abertura", { p_salon: salaoRow.id });
    const motivo = (estado as { motivo?: string } | null)?.motivo;
    if (motivo === "fechado_hoje" || motivo === "pausada") {
      out.skipped_casa_fechada = true;
      return json(out);
    }
    if (motivo === "ja_fechou" || motivo === "ainda_nao_abriu") {
      foraDoHorario = true;
      out.skipped_casa_fechada = true;
    }
  }

  // ── 1. Aviso de vez chegando (só com o salão em horário de atendimento) ──
  const entries = foraDoHorario ? [] : (await supa
    .from("queue_entries")
    .select("id, salon_id, customer_name, customer_phone, position, notify_minutes_before, service:services(duration_minutes)")
    .in("status", ["waiting", "checked_in"])
    .eq("notify_sent", false)
    .not("notify_minutes_before", "is", null)).data;

  if (entries && entries.length > 0) {
    const salonId = entries[0].salon_id;
    const { count: profCount } = await supa
      .from("professionals")
      .select("id", { count: "exact", head: true })
      .eq("salon_id", salonId)
      .eq("is_active", true);
    const professionals = Math.max(profCount || 1, 1);

    for (const entry of entries) {
      const { data: ahead } = await supa
        .from("queue_entries")
        .select("service:services(duration_minutes)")
        .eq("salon_id", entry.salon_id)
        .in("status", ["waiting", "checked_in", "in_service"])
        .lt("position", entry.position);

      // deno-lint-ignore no-explicit-any
      const totalMinAhead = (ahead || []).reduce((sum: number, e: any) => sum + (e.service?.duration_minutes || 45), 0);
      const estimatedMin = Math.ceil(totalMinAhead / professionals);
      if (estimatedMin > entry.notify_minutes_before) continue;

      const phone = String(entry.customer_phone ?? "").replace(/\D/g, "");
      if (phone.length < 10) {
        // sem telefone não há o que enviar — marca pra não re-varrer eternamente
        await supa.from("queue_entries").update({ notify_sent: true, updated_at: new Date().toISOString() }).eq("id", entry.id);
        out.skipped_no_phone++;
        continue;
      }

      const first = String(entry.customer_name ?? "").trim().split(/\s+/)[0] || "Oi";
      const message = estimatedMin <= 5
        ? `${first}, sua vez no NP Hair Express está chegando — é agora! Se não for conseguir vir, nos avise que deixamos seu crédito guardado no seu cadastro.`
        : `${first}, faltam aproximadamente ${estimatedMin} minutos para o seu atendimento no NP Hair Express. Já vá se preparando — te esperamos!`;

      const ok = await sendWhatsApp(phone, message);
      if (ok) {
        await supa.from("queue_entries").update({ notify_sent: true, updated_at: new Date().toISOString() }).eq("id", entry.id);
        out.notified++;
      } else {
        out.errors++; // fica false e o próximo minuto tenta de novo
      }
    }
  }

  // ── 2. Leads "me avisa" → e-mail do dono ─────────────────────────────────
  const { data: leads } = await supa
    .from("queue_leads")
    .select("id, name, phone, max_queue_size, created_at")
    .eq("emailed", false)
    .order("created_at", { ascending: true })
    .limit(10);

  if (leads && leads.length > 0) {
    let resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    if (!resendKey) {
      const { data: cfg } = await supa.from("system_config").select("value").eq("key", "resend_api_key").maybeSingle();
      resendKey = cfg?.value ?? "";
    }
    for (const lead of leads) {
      if (!resendKey) break;
      const phone = String(lead.phone ?? "").replace(/\D/g, "");
      const wa = phone ? `https://wa.me/${phone.startsWith("55") ? phone : "55" + phone}` : null;
      const quando = new Date(lead.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/124 Safari/537.36",
          },
          body: JSON.stringify({
            from: "Fila NP Hair Express <clube@nphairexpress.com.br>",
            to: [OWNER_EMAIL],
            subject: `🔔 Lead da fila — ${esc(String(lead.name ?? "").split(" ")[0]) || "cliente"} pediu aviso`,
            html: `
              <div style="font-family:system-ui,Arial;max-width:520px;margin:0 auto;padding:20px;color:#1f2937">
                <h2 style="color:#F7A100;margin:0 0 6px">Cliente pediu pra ser avisada da fila</h2>
                <p>Ela olhou a fila, achou grande e deixou o contato. Chama quando a fila estiver com até <b>${esc(lead.max_queue_size)}</b> pessoas:</p>
                <table style="font-size:15px;line-height:1.9">
                  <tr><td><b>Nome:</b></td><td>${esc(lead.name) || "—"}</td></tr>
                  <tr><td><b>WhatsApp:</b></td><td>${esc(lead.phone) || "—"}</td></tr>
                  <tr><td><b>Avisar com fila ≤</b></td><td>${esc(lead.max_queue_size)} pessoas</td></tr>
                  <tr><td><b>Pedido em:</b></td><td>${quando}</td></tr>
                </table>
                ${wa ? `<p style="margin-top:16px"><a href="${wa}" style="background:#25D366;color:#fff;text-decoration:none;padding:12px 24px;border-radius:50px;font-weight:bold">Chamar no WhatsApp</a></p>` : ""}
                <p style="color:#9ca3af;font-size:12px;margin-top:20px">A recepção também pode notificar pelo painel (Fila → Leads → Notificar).</p>
              </div>`,
          }),
        });
        if (res.ok) {
          await supa.from("queue_leads").update({ emailed: true }).eq("id", lead.id);
          out.leads_emailed++;
        } else {
          console.error("queue-cron: Resend falhou, HTTP", res.status);
          out.errors++;
        }
      } catch (e) {
        console.error("queue-cron: Resend erro", String(e).slice(0, 120));
        out.errors++;
      }
    }
  }

  // ── 3. Aviso automático do lead (só com o salão em horário de atendimento) ──
  if (!foraDoHorario && salaoRow?.id) {
    try {
      await avisarLeads(supa, salaoRow.id, out);
    } catch (e) {
      console.error("queue-cron: aviso de lead erro inesperado", String(e).slice(0, 160));
      out.errors++;
    }
  }

  return json(out);
});

// deno-lint-ignore no-explicit-any
async function avisarLeads(supa: any, salonId: string, out: { leads_notified: number; errors: number }) {
  const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }); // YYYY-MM-DD
  const { data: leads, error } = await supa
    .from("queue_leads")
    .select("id, name, phone, max_queue_size, notify_attempts")
    .eq("salon_id", salonId)
    .eq("atendimento_em", hoje)
    .eq("notified", false)
    .lt("notify_attempts", LEAD_MAX_TENTATIVAS)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw new Error(`ler leads: ${error.message}`);
  if (!leads || leads.length === 0) return;

  const { count: enviadosHoje } = await supa
    .from("queue_leads")
    .select("id", { count: "exact", head: true })
    .eq("salon_id", salonId)
    .eq("atendimento_em", hoje)
    .eq("notify_result", "enviado");
  let restantes = LEAD_MAX_AVISOS_DIA - (enviadosHoje ?? 0);
  if (restantes <= 0) return;

  const { data: painel, error: painelErr } = await supa.rpc("fila_public_painel");
  if (painelErr) throw new Error(`fila_public_painel: ${painelErr.message}`);
  const filaAgora = tamanhoFila(painel);

  const { data: naFila } = await supa
    .from("queue_entries")
    .select("customer_phone")
    .eq("salon_id", salonId)
    .in("status", ["waiting", "checked_in", "in_service"]);
  // deno-lint-ignore no-explicit-any
  const telefonesNaFila = (naFila ?? []).map((e: any) => e.customer_phone);

  const { data: avisados } = await supa
    .from("queue_leads")
    .select("phone")
    .eq("salon_id", salonId)
    .eq("atendimento_em", hoje)
    .eq("notified", true);
  // deno-lint-ignore no-explicit-any
  const telefonesAvisados: string[] = (avisados ?? []).map((l: any) => l.phone);

  const marcar = (id: string, result: string) =>
    supa.from("queue_leads")
      .update({ notified: true, notified_at: new Date().toISOString(), notify_result: result })
      .eq("id", id).eq("notified", false);

  for (const lead of leads) {
    const decisao = decidirLead(lead, filaAgora, telefonesNaFila, telefonesAvisados);
    if (decisao === "esperar") continue;
    if (decisao !== "enviar") {
      await marcar(lead.id, decisao);
      continue;
    }
    if (restantes <= 0) break;
    restantes--;
    const ok = await sendWhatsApp(String(lead.phone), montarAvisoLead(lead.name, filaAgora, LINK_FILA), "queue-cron lead");
    if (ok) {
      await marcar(lead.id, "enviado");
      telefonesAvisados.push(lead.phone);
      out.leads_notified++;
    } else {
      await supa.from("queue_leads").update({ notify_attempts: (lead.notify_attempts ?? 0) + 1 }).eq("id", lead.id);
      out.errors++;
    }
  }
}
