// Webhook Asaas → reconcilia pagamento, fila, crédito e caixa (server-side).
//
// SEGURANÇA (falhas 8, 10, 14 corrigidas):
// - Token FAIL-CLOSED: ASAAS_WEBHOOK_TOKEN ausente ⇒ 503 e NADA é processado;
//   token errado ⇒ 401. Sem fallback hardcoded de nenhum segredo.
// - PAYMENT_CONFIRMED/RECEIVED ⇒ RPC webhook_pagamento_confirmado (transacional,
//   idempotente): cria a queue_entry a partir da purchase_intent MESMO que a
//   cliente tenha fechado o navegador. Retry/duplicata do Asaas ⇒ 1 entry só.
// - REFUND/DELETE/CHARGEBACK ⇒ RPC webhook_pagamento_revertido: cancela fila,
//   expira crédito não usado, voida pagamento interno e estorna caixa aberto.
// - Resend key: APENAS env (Supabase Secrets) — system_config não é cofre.
//
// Deploy: npx supabase functions deploy asaas-webhook --no-verify-jwt \
//           --project-ref ewxiaxsmohxuabcmxuyc
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CLEITON_WA = "5511976847114"; // alvo dos alertas urgentes
const EVOLUTION_URL = "http://172.18.0.1:8080/message/sendText/claudebot";

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

  // Dados do cliente no Asaas (chave só de env — falha fechada, sem fallback)
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

  // E-mail de boas-vindas (só no primeiro pagamento).
  // RESEND_API_KEY: APENAS Supabase Secrets — system_config NÃO é cofre.
  let emailStatus = "sem_email";
  if (!reg.welcome_email_enviado && reg.email) {
    const resendKey = Deno.env.get("RESEND_API_KEY");
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

// Alerta urgente pro Cleiton via Evolution claudebot. Best-effort — e SEM
// fallback de chave: EVOLUTION_KEY ausente ⇒ só loga (falha fechada).
// Devolve true SÓ quando a Evolution aceitou o envio (HTTP 2xx) — quem chama
// loga o resultado real em vez de assumir "enviado".
async function alertCleiton(text: string): Promise<boolean> {
  const key = Deno.env.get("EVOLUTION_KEY") ?? "";
  if (!key) {
    console.warn("alertCleiton: EVOLUTION_KEY ausente — alerta não enviado:", text.slice(0, 80));
    return false;
  }
  try {
    const r = await fetch(EVOLUTION_URL, {
      method: "POST",
      headers: { "apikey": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        number: CLEITON_WA,
        options: { delay: 1200, presence: "composing" },
        textMessage: { text },
      }),
    });
    if (!r.ok) {
      console.error("alertCleiton: Evolution respondeu", r.status, await r.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (err) {
    console.error("alertCleiton failed:", err);
    return false;
  }
}

// externalReference gerado pelo asaas-checkout é sempre o UUID da
// purchase_intent. Cobrança manual avulsa do painel Asaas não tem esse formato.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // ── FAIL CLOSED: sem token configurado, NADA é processado ──
  const expectedToken = Deno.env.get("ASAAS_WEBHOOK_TOKEN") ?? "";
  if (!expectedToken) {
    console.error("asaas-webhook: ASAAS_WEBHOOK_TOKEN não configurado — recusando");
    return new Response("Webhook not configured", { status: 503 });
  }
  const headerToken = req.headers.get("asaas-access-token") ?? "";
  if (headerToken !== expectedToken) {
    console.warn("asaas-webhook: token mismatch — recusando");
    return new Response("Unauthorized", { status: 401 });
  }

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

  const event: string = body.event ?? "";
  const payment = body.payment;
  if (!payment?.id) {
    return new Response("No payment", { status: 400 });
  }

  const confirmed = ["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"].includes(event);
  const overdue = event === "PAYMENT_OVERDUE";
  const reverted = ["PAYMENT_DELETED", "PAYMENT_REFUNDED"].includes(event);
  const chargeback = [
    "PAYMENT_CHARGEBACK_REQUESTED",
    "PAYMENT_CHARGEBACK_DISPUTE",
    "PAYMENT_AWAITING_CHARGEBACK_REVERSAL",
  ].includes(event);
  const cardRefused = event === "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED";

  let action = "ignored";

  // Clube da Escova: cobrança de ASSINATURA mantém assinantes/créditos + boas-vindas
  if (payment.subscription) {
    action = await handleClube(supa, event, payment);
  }

  // ── Pagamento confirmado → RPC transacional idempotente cria/atualiza a fila
  if (confirmed && !payment.subscription) {
    const { data: result, error: rpcErr } = await supa.rpc("webhook_pagamento_confirmado", {
      p_asaas_payment_id: payment.id,
      p_external_reference: payment.externalReference ?? null,
      p_value: payment.value ?? null,
      p_billing_type: payment.billingType ?? null,
    });
    if (rpcErr) {
      console.error("webhook_pagamento_confirmado error:", rpcErr);
      action = `confirm_error: ${rpcErr.message}`;
    } else {
      action = `confirmed (${result?.mode ?? "?"})`;
      // Pagamento confirmado SEM lastro: a RPC não achou purchase_intent nem
      // queue_entry (branch legado com 0 linhas). SÓ é anomalia real quando a
      // cobrança NASCEU do asaas-checkout (externalReference = UUID da intent)
      // e a intent sumiu. Cobrança manual avulsa do painel Asaas não é de fila.
      // E só no PAYMENT_CONFIRMED: o PAYMENT_RECEIVED seguinte é a liquidação
      // do MESMO pagamento — alertar de novo seria duplicata.
      if (result?.mode === "legacy" && Number(result?.updated_rows ?? 0) === 0) {
        const refIsIntent = UUID_RE.test(String(payment.externalReference ?? ""));
        if (refIsIntent && event === "PAYMENT_CONFIRMED") {
          console.error("pagamento confirmado sem intent/entry:", payment.id, payment.externalReference);
          const alertOk = await alertCleiton(
            `🚨 Pagamento confirmado SEM entrada na fila\n\n` +
            `🆔 ${payment.id}\n` +
            `💰 ${fmtBRL(payment.value ?? 0)}\n` +
            `📎 ref: ${payment.externalReference ?? "—"}\n\n` +
            `Não achei purchase_intent nem queue_entry pra esse pagamento. ` +
            `Verifique no painel do Asaas e no sistema — pagamento de fila confirmado sem registro.`
          );
          action = alertOk
            ? "confirmed_sem_lastro (alerta enviado)"
            : "confirmed_sem_lastro (alerta FALHOU — ver logs)";
        } else if (refIsIntent) {
          // RECEIVED do mesmo pagamento: já alertado no CONFIRMED.
          action = "confirmed_sem_lastro (RECEIVED — alerta já disparado no CONFIRMED)";
        } else {
          // Cobrança manual avulsa (ref não é intent): não é de fila, sem alerta.
          action = "confirmed (legacy, cobrança avulsa sem fila)";
        }
      }
    }
  }

  // ── Refund / delete / chargeback → reconciliação completa ──
  if (reverted || chargeback) {
    const { data: rec, error: recErr } = await supa.rpc("webhook_pagamento_revertido", {
      p_asaas_payment_id: payment.id,
      p_event: event,
    });
    if (recErr) {
      console.error("webhook_pagamento_revertido error:", recErr);
      action = `revert_error: ${recErr.message}`;
    } else {
      action = `reverted (${event})`;
      if (rec?.caixa_pendente_manual) {
        await alertCleiton(
          `⚠️ Estorno Asaas em CAIXA JÁ FECHADO\n\n` +
          `🆔 ${payment.id} (${event})\n` +
          `O pagamento interno foi anulado, mas o caixa do dia já estava fechado. ` +
          `Confira o fechamento correspondente manualmente.`
        );
      }
    }
  }

  // Captura LEAD: cobrança nova → registra em asaas_pending_leads
  if (event === "PAYMENT_CREATED" && !payment.subscription) {
    // Com o fluxo novo, a intent tem os dados do cliente ANTES do pagamento
    const { data: intent } = await supa
      .from("purchase_intents")
      .select("id, salon_id, customer_name, customer_phone, customer_email, queue_entry_id")
      .eq("asaas_payment_id", payment.id)
      .maybeSingle();

    const { data: q } = intent ? { data: null } : await supa
      .from("queue_entries")
      .select("id, salon_id, customer_name, customer_phone, customer_email")
      .eq("payment_id", payment.id)
      .maybeSingle();

    const { data: salonRow } = (intent || q) ? { data: null } : await supa
      .from("salons").select("id").order("created_at").limit(1).maybeSingle();

    const salonId = intent?.salon_id ?? q?.salon_id ?? salonRow?.id;
    if (salonId) {
      const { error: leadErr } = await supa.from("asaas_pending_leads").upsert({
        salon_id: salonId,
        asaas_payment_id: payment.id,
        customer_name: intent?.customer_name ?? q?.customer_name ?? null,
        customer_phone: intent?.customer_phone ?? q?.customer_phone ?? null,
        customer_email: intent?.customer_email ?? q?.customer_email ?? null,
        value: payment.value ?? null,
        billing_type: payment.billingType ?? null,
        description: payment.description ?? null,
        queue_entry_id: intent?.queue_entry_id ?? q?.id ?? null,
        status: "pending",
      }, { onConflict: "asaas_payment_id" });
      action = leadErr ? `lead_error: ${leadErr.message}` : "lead_captured";
    }
  }

  // Atualiza status do lead quando pagamento confirma/cancela
  if (confirmed) {
    await supa.from("asaas_pending_leads").update({
      status: "paid_online",
      resolved_at: new Date().toISOString(),
      resolved_reason: `Pago via Asaas (${event})`,
    }).eq("asaas_payment_id", payment.id).eq("status", "pending");
  } else if (reverted) {
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
  } else if (event === "PAYMENT_PARTIALLY_REFUNDED") {
    // Estorno PARCIAL não cancela fila nem voida pagamento: reconciliar na mão.
    await alertCleiton(
      `⚠️ Estorno PARCIAL no Asaas\n\n🆔 ${payment.id}\n` +
      `Fila/comanda NÃO foram alteradas automaticamente — confira e ajuste manualmente.`
    );
    action = "partial_refund_alert";
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
