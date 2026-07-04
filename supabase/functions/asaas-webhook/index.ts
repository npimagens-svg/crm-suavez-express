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

// ── Clube da Escova: planos identificados pelo valor da cobrança ──
const CLUBE_PLANOS: Record<string, { plano: string; teto: number; rotulo: string; valor: string }> = {
  "197": { plano: "4x_curto_medio", teto: 4, rotulo: "4 escovas por mês · cabelo curto/médio", valor: "R$ 197/mês" },
  "247": { plano: "4x_longo", teto: 4, rotulo: "4 escovas por mês · cabelo longo", valor: "R$ 247/mês" },
  "347": { plano: "8x_curto_medio", teto: 8, rotulo: "8 escovas por mês · cabelo curto/médio", valor: "R$ 347/mês" },
  "447": { plano: "8x_longo", teto: 8, rotulo: "8 escovas por mês · cabelo longo", valor: "R$ 447/mês" },
};

function clubeEmailBoasVindas(nome: string, def: { rotulo: string; valor: string }): string {
  return `<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:0;background:#f5f2ec;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f2ec;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;">
  <tr><td style="background:#111111;padding:32px 40px;text-align:center;">
    <div style="font-size:26px;font-weight:bold;color:#ffffff;letter-spacing:1px;">NP HAIR <span style="color:#F7A100;">EXPRESS</span></div>
    <div style="color:#F7A100;font-size:13px;letter-spacing:3px;margin-top:6px;">CLUBE DA ESCOVA</div>
  </td></tr>
  <tr><td style="padding:40px 40px 8px;">
    <h1 style="margin:0;font-size:26px;color:#111111;">${nome}, sua vaga é sua. 🧡</h1>
    <p style="font-size:16px;line-height:1.6;color:#444444;margin:16px 0 0;">
      Assinatura confirmada! A partir de agora sua escova da semana já está paga —
      é só chegar e fazer. Sem marcar horário, sem abrir a carteira no balcão.
    </p>
  </td></tr>
  <tr><td style="padding:24px 40px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff8e6;border:1px solid #ffdd85;border-radius:12px;">
      <tr><td style="padding:20px 24px;">
        <div style="font-size:12px;letter-spacing:2px;color:#b37300;font-weight:bold;">SEU PLANO</div>
        <div style="font-size:19px;color:#111111;font-weight:bold;margin-top:6px;">${def.rotulo}</div>
        <div style="font-size:15px;color:#b37300;margin-top:4px;font-weight:bold;">${def.valor} · renova automático no cartão</div>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:8px 40px 8px;">
    <h2 style="font-size:17px;color:#111111;margin:0 0 12px;">Como usar (mais fácil impossível)</h2>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr><td style="padding:8px 0;font-size:15px;color:#444444;line-height:1.5;"><b style="color:#F7A100;">1.</b>&nbsp; Venha quando quiser, dentro do seu mês — não precisa agendar nada.</td></tr>
      <tr><td style="padding:8px 0;font-size:15px;color:#444444;line-height:1.5;"><b style="color:#F7A100;">2.</b>&nbsp; Na chegada, toque em <b>“Sou do Clube da Escova”</b> na fila digital (ou diga na recepção) e entre na fila pelo celular.</td></tr>
      <tr><td style="padding:8px 0;font-size:15px;color:#444444;line-height:1.5;"><b style="color:#F7A100;">3.</b>&nbsp; Sente na cadeira e saia pronta em cerca de 40 minutos.</td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:16px 40px 8px;">
    <h2 style="font-size:17px;color:#111111;margin:0 0 12px;">Combinados rápidos</h2>
    <p style="font-size:14px;line-height:1.7;color:#555555;margin:0;">
      • Suas escovas valem dentro do mês (não acumulam pro seguinte).<br>
      • O plano cobre a escova lisa — quer modelada? Só somar R$ 10 na comanda do dia.<br>
      • Pode usar duas no mesmo dia: compromisso de manhã, festa à noite.<br>
      • Sem fidelidade: cancela quando quiser.
    </p>
  </td></tr>
  <tr><td style="padding:28px 40px;" align="center">
    <a href="https://www.nphairexpress.com.br/clube/" style="display:inline-block;background:#F7A100;color:#111111;font-weight:bold;font-size:16px;text-decoration:none;padding:15px 36px;border-radius:99px;">Ver tudo sobre o Clube</a>
  </td></tr>
  <tr><td style="background:#111111;padding:24px 40px;text-align:center;">
    <div style="color:#ffffff;font-size:14px;font-weight:bold;">NP Hair Express</div>
    <div style="color:#999999;font-size:13px;margin-top:6px;line-height:1.6;">
      R. 7 de Setembro, 374 — Centro, Salto/SP<br>
      WhatsApp: (11) 98820-8754 · nphairexpress.com.br
    </div>
    <div style="color:#666666;font-size:11px;margin-top:12px;">NP Hair Express · julho/2026</div>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

// Cobrança de assinatura do Clube: mantém clube_assinantes/clube_creditos
// e envia o e-mail de boas-vindas no primeiro pagamento. Best-effort.
// deno-lint-ignore no-explicit-any
async function handleClube(supa: any, event: string, payment: any): Promise<string> {
  const def = CLUBE_PLANOS[String(Math.round(payment.value || 0))];
  if (!def) return "clube_valor_fora_dos_planos";

  if (event === "PAYMENT_OVERDUE") {
    await supa.from("clube_assinantes")
      .update({ status: "inadimplente", updated_at: new Date().toISOString() })
      .eq("asaas_customer_id", payment.customer);
    return "clube_inadimplente";
  }

  if (!["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"].includes(event)) return "clube_skip";

  // Dados do cliente no Asaas
  const asaasKey = Deno.env.get("ASAAS_KEY") ?? "";
  // deno-lint-ignore no-explicit-any
  let cli: any = {};
  if (asaasKey) {
    try {
      const r = await fetch(`https://api.asaas.com/v3/customers/${payment.customer}`, {
        headers: { access_token: asaasKey },
      });
      if (r.ok) cli = await r.json();
    } catch (err) {
      console.error("clube: asaas customer fetch failed:", err);
    }
  }

  const { data: reg, error: upErr } = await supa.from("clube_assinantes").upsert({
    asaas_customer_id: payment.customer,
    asaas_subscription_id: payment.subscription,
    nome: cli.name || null,
    cpf: cli.cpfCnpj || null,
    celular: cli.mobilePhone || cli.phone || null,
    email: cli.email || null,
    plano: def.plano,
    teto_mensal: def.teto,
    status: "ativo",
    updated_at: new Date().toISOString(),
  }, { onConflict: "asaas_customer_id" }).select().single();
  if (upErr || !reg) {
    console.error("clube: upsert assinante falhou:", upErr);
    return "clube_upsert_erro";
  }

  // Créditos da competência da cobrança (não acumula: 1 linha por mês)
  const competencia = String(payment.paymentDate || payment.dueDate || new Date().toISOString()).slice(0, 7);
  await supa.from("clube_creditos").upsert(
    { assinante_id: reg.id, competencia, creditos_total: def.teto },
    { onConflict: "assinante_id,competencia", ignoreDuplicates: true },
  );

  // E-mail de boas-vindas (só no primeiro pagamento)
  let emailStatus = "sem_email";
  if (!reg.welcome_email_enviado && reg.email) {
    let resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      const { data: cfg } = await supa.from("system_config")
        .select("value").eq("key", "resend_api_key").maybeSingle();
      resendKey = cfg?.value || null;
    }
    if (resendKey) {
      const primeiroNome = (reg.nome || "Bem-vinda").split(" ")[0];
      const mail = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Clube da Escova · NP Hair Express <clube@nphairexpress.com.br>",
          to: [reg.email],
          subject: `${primeiroNome}, sua vaga no Clube da Escova está confirmada 🧡`,
          html: clubeEmailBoasVindas(primeiroNome, def),
        }),
      }).catch(() => null);
      if (mail?.ok) {
        emailStatus = "email_enviado";
        await supa.from("clube_assinantes")
          .update({ welcome_email_enviado: true }).eq("id", reg.id);
      } else {
        emailStatus = "email_falhou";
      }
    } else {
      emailStatus = "sem_resend_key";
    }
  }

  return `clube_ativo (${emailStatus})`;
}

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

  // Clube da Escova: cobrança de ASSINATURA mantém assinantes/créditos + boas-vindas
  if (payment.subscription) {
    action = await handleClube(supa, event, payment);
  }

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

  // Captura LEAD: cobrança nova → registra em asaas_pending_leads
  // Permite follow-up se cliente nunca pagar.
  // (Assinatura do Clube fica fora: a renovação mensal geraria lead falso.)
  if (event === "PAYMENT_CREATED" && !payment.subscription) {
    // Tenta achar queue_entry pra pegar dados do cliente
    const { data: q } = await supa
      .from("queue_entries")
      .select("id, salon_id, customer_name, customer_phone, customer_email")
      .eq("payment_id", payment.id)
      .maybeSingle();

    const salonId = q?.salon_id ?? "9793948a-e208-4054-a4df-4b8f2b3b3965";

    const { error: leadErr } = await supa.from("asaas_pending_leads").upsert({
      salon_id: salonId,
      asaas_payment_id: payment.id,
      customer_name: q?.customer_name ?? null,
      customer_phone: q?.customer_phone ?? null,
      customer_email: q?.customer_email ?? null,
      value: payment.value ?? null,
      billing_type: payment.billingType ?? null,
      description: payment.description ?? null,
      queue_entry_id: q?.id ?? null,
      status: "pending",
    }, { onConflict: "asaas_payment_id" });

    action = leadErr ? `lead_error: ${leadErr.message}` : "lead_captured";
  }

  // Atualiza status do lead quando pagamento confirma/cancela
  if (confirmed) {
    await supa.from("asaas_pending_leads").update({
      status: "paid_online",
      resolved_at: new Date().toISOString(),
      resolved_reason: `Pago via Asaas (${event})`,
    }).eq("asaas_payment_id", payment.id).eq("status", "pending");
  } else if (deleted) {
    await supa.from("asaas_pending_leads").update({
      status: "cancelled",
      resolved_at: new Date().toISOString(),
      resolved_reason: event,
    }).eq("asaas_payment_id", payment.id).eq("status", "pending");
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
