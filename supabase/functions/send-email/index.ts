import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireCronSecret, requireStaff } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface EmailRequest {
  type: "cashback" | "expiring" | "birthday" | "welcome" | "campaign" | "return_reminder" | "appointment_created" | "appointment_confirmation" | "appointment_reminder" | "appointment_update" | "appointment_cancellation";
  salon_id: string;
  to_email: string;
  to_name: string;
  client_id?: string;
  variables?: Record<string, string>;
  campaign_id?: string;
  subject?: string;
  body?: string;
}

const WHATSAPP_NUMBER = "5511978355751";

function whatsappUrl(subject: string): string {
  const msg = encodeURIComponent(`Olá! Vi o e-mail "${subject}" e gostaria de agendar um horário 💇‍♀️`);
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`;
}

function whatsappButton(subject: string, primaryColor: string): string {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 8px 0;">
      <tr><td align="center">
        <a href="${whatsappUrl(subject)}" target="_blank" style="display:inline-block;background:#25D366;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;padding:14px 32px;border-radius:50px;letter-spacing:0.5px;">
          📲 Agendar pelo WhatsApp
        </a>
      </td></tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 0 0;">
      <tr><td align="center">
        <p style="color:#a1a1aa;font-size:12px;margin:0;">Clique acima para falar conosco direto no WhatsApp</p>
      </td></tr>
    </table>`;
}

function generateHtml(
  logoUrl: string | null,
  salonName: string,
  title: string,
  bodyContent: string,
  subject: string,
  primaryColor: string = "#6366f1",
  showWhatsapp: boolean = true
): string {
  const logoBlock = logoUrl
    ? `<img src="${logoUrl}" alt="${salonName}" style="max-height:70px;margin-bottom:12px;border-radius:12px;" />`
    : "";

  const whatsBlock = showWhatsapp ? whatsappButton(subject, primaryColor) : "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
    body { font-family: 'Inter', Arial, Helvetica, sans-serif; }
  </style>
</head>
<body style="margin:0;padding:0;background:linear-gradient(135deg,#f0f0f5 0%,#e8e6f0 100%);font-family:'Inter',Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
<tr><td align="center">

<!-- Card -->
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(99,102,241,0.12);">
  
  <!-- Header -->
  <tr><td style="background:linear-gradient(135deg,${primaryColor} 0%,#818cf8 50%,#a78bfa 100%);padding:36px 24px 28px;text-align:center;">
    ${logoBlock}
    <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:700;letter-spacing:-0.5px;text-shadow:0 2px 8px rgba(0,0,0,0.15);">${salonName}</h1>
  </td></tr>

  <!-- Title bar -->
  <tr><td style="padding:0;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:28px 32px 0;">
        <div style="background:linear-gradient(135deg,${primaryColor}10 0%,#a78bfa10 100%);border-radius:14px;padding:20px 24px;border-left:4px solid ${primaryColor};">
          <h2 style="color:#18181b;margin:0;font-size:20px;font-weight:700;">${title}</h2>
        </div>
      </td></tr>
    </table>
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:24px 32px 8px;">
    <div style="color:#3f3f46;font-size:15px;line-height:1.8;">
      ${bodyContent}
    </div>
    ${whatsBlock}
  </td></tr>

  <!-- Divider -->
  <tr><td style="padding:8px 32px 0;">
    <div style="height:1px;background:linear-gradient(90deg,transparent,#e4e4e7,transparent);"></div>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:20px 32px 28px;text-align:center;">
    <p style="color:#a1a1aa;font-size:12px;margin:0 0 8px;">
      Você recebeu este e-mail porque é cliente do <strong>${salonName}</strong>.
    </p>
    <p style="color:#c4c4cc;font-size:11px;margin:0;">
      Feito com 💜 para você
    </p>
  </td></tr>

</table>
<!-- /Card -->

</td></tr>
</table>
</body>
</html>`;
}

function highlightBox(content: string, emoji: string, color: string = "#6366f1"): string {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
      <tr><td style="background:${color}08;border:1px solid ${color}20;border-radius:12px;padding:16px 20px;">
        <p style="margin:0;font-size:15px;color:#18181b;">${emoji} ${content}</p>
      </td></tr>
    </table>`;
}

function buildEmailContent(
  type: string,
  vars: Record<string, string>,
  salonName: string,
  logoUrl: string | null,
  customSubject?: string,
  customBody?: string
): { subject: string; html: string } {
  const name = vars.client_name || "Cliente";

  switch (type) {
    case "cashback": {
      const subject = `🎉 Você ganhou R$ ${vars.credit_amount} de cashback no ${salonName}!`;
      const body = `
        <p>Olá <strong>${name}</strong>! 👋</p>
        <p>Obrigado por sua visita! Temos uma surpresa incrível pra você:</p>
        ${highlightBox(`<strong>R$ ${vars.credit_amount}</strong> de cashback gerado!`, "💰", "#10b981")}
        ${highlightBox(`Válido até <strong>${vars.expires_at}</strong>`, "📅")}
        ${highlightBox(`Valor mínimo de compra: <strong>R$ 100,00</strong>`, "🛒")}
        <p>Use esse crédito na sua próxima visita e aproveite! 🥰</p>
        <p style="margin-top:24px;">Com carinho,<br/><strong>${salonName}</strong> 💜</p>`;
      return { subject, html: generateHtml(logoUrl, salonName, "Cashback Gerado! 🎉", body, subject) };
    }

    case "expiring": {
      const subject = `⏰ Seu cashback de R$ ${vars.credit_amount} expira em ${vars.days_left} dias!`;
      const body = `
        <p>Olá <strong>${name}</strong>! 👋</p>
        <p>Seu crédito está prestes a expirar — não deixe escapar!</p>
        ${highlightBox(`<strong>R$ ${vars.credit_amount}</strong> disponível`, "💰", "#f59e0b")}
        ${highlightBox(`Expira em <strong>${vars.expires_at}</strong> (${vars.days_left} dias!)`, "⏰", "#ef4444")}
        <p>Agende agora e aproveite esse desconto especial! 🏃‍♀️</p>
        <p style="margin-top:24px;">Te esperamos!<br/><strong>${salonName}</strong> 💜</p>`;
      return { subject, html: generateHtml(logoUrl, salonName, "Cashback Expirando! ⏰", body, subject) };
    }

    case "birthday": {
      const subject = `🎂 Feliz Aniversário, ${name}! Temos um presente pra você`;
      const body = `
        <p>Olá <strong>${name}</strong>! 🥳</p>
        ${highlightBox(`<strong>Hoje é seu dia especial!</strong> Parabéns pelo seu aniversário! 🎂🎈`, "🎉", "#ec4899")}
        <p>Queremos celebrar com você! Passe no <strong>${salonName}</strong> e receba nosso carinho especial de aniversário.</p>
        <p style="font-size:28px;text-align:center;margin:20px 0;">🎁🎂🥂✨</p>
        <p>Que esse novo ciclo seja repleto de beleza e alegria!</p>
        <p style="margin-top:24px;">Com muito amor,<br/><strong>${salonName}</strong> 💜</p>`;
      return { subject, html: generateHtml(logoUrl, salonName, "Feliz Aniversário! 🎂", body, subject) };
    }

    case "welcome": {
      const subject = `Bem-vindo(a) ao ${salonName}! 💇‍♀️`;
      const body = `
        <p>Olá <strong>${name}</strong>! 👋</p>
        ${highlightBox(`Seja muito bem-vindo(a) à família <strong>${salonName}</strong>!`, "🌟", "#6366f1")}
        <p>Estamos prontos para cuidar de você com todo carinho e dedicação. ✨</p>
        ${highlightBox(`Programa de Fidelidade: ganhe <strong>7% de cashback</strong> em cada visita!`, "🎁", "#10b981")}
        <p>Agende sua primeira visita e descubra tudo que preparamos pra você!</p>
        <p style="margin-top:24px;">Até breve!<br/><strong>${salonName}</strong> 💜</p>`;
      return { subject, html: generateHtml(logoUrl, salonName, "Bem-vindo(a)! 💇‍♀️", body, subject) };
    }

    case "return_reminder": {
      const subject = `💇 Hora de cuidar do seu ${vars.service_name}, ${name}!`;
      const customMsg = vars.custom_message || `Que tal agendar seu retorno? Estamos te esperando com saudade!`;
      const body = `
        <p>Olá <strong>${name}</strong>! 👋</p>
        ${highlightBox(`Já faz <strong>${vars.days} dias</strong> desde o seu último <strong>${vars.service_name}</strong>`, "📅", "#f59e0b")}
        <p>${customMsg}</p>
        <p>Nossos profissionais estão prontos para deixar você incrível novamente! 💅✨</p>
        <p style="margin-top:24px;">Esperamos você!<br/><strong>${salonName}</strong> 💜</p>`;
      return { subject, html: generateHtml(logoUrl, salonName, "Hora de Retornar! 💇", body, subject) };
    }

    case "appointment_created": {
      const subject = `📋 Agendamento criado no ${salonName}!`;
      const serviceLines = (vars.service_name || "").split("\n").filter(Boolean);
      const serviceHtml = serviceLines.length > 1
        ? serviceLines.map(s => highlightBox(`${s}`, "💇‍♀️", "#6366f1")).join("")
        : highlightBox(`<strong>Serviço:</strong> ${vars.service_name || "Não informado"}`, "💇‍♀️", "#6366f1");
      const body = `
        <p>Olá <strong>${name}</strong>! 👋</p>
        <p>Seu agendamento foi <strong>criado</strong> com sucesso! Confira os detalhes:</p>
        ${serviceHtml}
        ${highlightBox(`<strong>Data:</strong> ${vars.date} às <strong>${vars.time}</strong>`, "📅", "#f59e0b")}
        ${highlightBox(`<strong>Profissional:</strong> ${vars.professional_name || "Não informado"}`, "👤", "#3b82f6")}
        ${highlightBox(`<strong>Status:</strong> Aguardando confirmação`, "⏳", "#f59e0b")}
        <p>Você receberá uma confirmação em breve. Caso precise alterar, entre em contato conosco. 😊</p>
        <p style="margin-top:24px;">Com carinho,<br/><strong>${salonName}</strong> 💜</p>`;
      return { subject, html: generateHtml(logoUrl, salonName, "Agendamento Criado! 📋", body, subject) };
    }

    case "appointment_confirmation": {
      const subject = `✅ Agendamento confirmado no ${salonName}!`;
      const serviceLines = (vars.service_name || "").split("\n").filter(Boolean);
      const serviceHtml = serviceLines.length > 1
        ? serviceLines.map(s => highlightBox(`${s}`, "💇‍♀️", "#6366f1")).join("")
        : highlightBox(`<strong>Serviço:</strong> ${vars.service_name || "Não informado"}`, "💇‍♀️", "#6366f1");
      const body = `
        <p>Olá <strong>${name}</strong>! 👋</p>
        <p>Seu agendamento foi <strong>confirmado</strong> com sucesso! ✅</p>
        ${serviceHtml}
        ${highlightBox(`<strong>Data:</strong> ${vars.date} às <strong>${vars.time}</strong>`, "📅", "#10b981")}
        ${highlightBox(`<strong>Profissional:</strong> ${vars.professional_name || "Não informado"}`, "👤", "#3b82f6")}
        <p>Estamos te esperando! Caso precise remarcar, entre em contato conosco. 😊</p>
        <p style="margin-top:24px;">Com carinho,<br/><strong>${salonName}</strong> 💜</p>`;
      return { subject, html: generateHtml(logoUrl, salonName, "Agendamento Confirmado! ✅", body, subject) };
    }

    case "appointment_reminder": {
      const subject = `⏰ Lembrete: seu horário amanhã no ${salonName}!`;
      const body = `
        <p>Olá <strong>${name}</strong>! 👋</p>
        <p>Passando para lembrar do seu agendamento de <strong>amanhã</strong>:</p>
        ${highlightBox(`<strong>Serviço:</strong> ${vars.service_name || "Não informado"}`, "💇‍♀️", "#6366f1")}
        ${highlightBox(`<strong>Data:</strong> ${vars.date} às <strong>${vars.time}</strong>`, "📅", "#f59e0b")}
        ${highlightBox(`<strong>Profissional:</strong> ${vars.professional_name || "Não informado"}`, "👤", "#3b82f6")}
        <p>Te esperamos! Caso precise remarcar, entre em contato conosco com antecedência. 🙏</p>
        <p style="margin-top:24px;">Até amanhã!<br/><strong>${salonName}</strong> 💜</p>`;
      return { subject, html: generateHtml(logoUrl, salonName, "Lembrete de Agendamento! ⏰", body, subject) };
    }

    case "appointment_update": {
      const subject = `📋 Seu agendamento no ${salonName} foi atualizado`;
      const serviceLines = (vars.service_name || "").split("\n").filter(Boolean);
      const serviceHtml = serviceLines.length > 1
        ? serviceLines.map(s => highlightBox(`${s}`, "💇‍♀️", "#6366f1")).join("")
        : highlightBox(`<strong>Serviço:</strong> ${vars.service_name || "Não informado"}`, "💇‍♀️", "#6366f1");
      const body = `
        <p>Olá <strong>${name}</strong>! 👋</p>
        <p>Seu agendamento foi <strong>atualizado</strong>. Confira os novos detalhes:</p>
        ${serviceHtml}
        ${highlightBox(`<strong>Data:</strong> ${vars.date} às <strong>${vars.time}</strong>`, "📅", "#f59e0b")}
        ${highlightBox(`<strong>Profissional:</strong> ${vars.professional_name || "Não informado"}`, "👤", "#3b82f6")}
        <p>Caso tenha dúvidas sobre a alteração, entre em contato conosco. 😊</p>
        <p style="margin-top:24px;">Com carinho,<br/><strong>${salonName}</strong> 💜</p>`;
      return { subject, html: generateHtml(logoUrl, salonName, "Agendamento Atualizado! 📋", body, subject) };
    }

    case "appointment_cancellation": {
      const subject = `❌ Agendamento cancelado no ${salonName}`;
      const body = `
        <p>Olá <strong>${name}</strong>! 👋</p>
        <p>Informamos que seu agendamento foi <strong>cancelado</strong>:</p>
        ${highlightBox(`<strong>Serviço:</strong> ${vars.service_name || "Não informado"}`, "💇‍♀️", "#ef4444")}
        ${highlightBox(`<strong>Data:</strong> ${vars.date} às <strong>${vars.time}</strong>`, "📅", "#6b7280")}
        ${highlightBox(`<strong>Profissional:</strong> ${vars.professional_name || "Não informado"}`, "👤", "#6b7280")}
        <p>Se desejar reagendar, entre em contato conosco. Estamos à disposição! 😊</p>
        <p style="margin-top:24px;">Com carinho,<br/><strong>${salonName}</strong> 💜</p>`;
      return { subject, html: generateHtml(logoUrl, salonName, "Agendamento Cancelado ❌", body, subject) };
    }

    case "campaign": {
      const subject = customSubject || "Novidades do " + salonName;
      const body = `<div style="white-space:pre-wrap;line-height:1.8;">${customBody || ""}</div>`;
      return { subject, html: generateHtml(logoUrl, salonName, subject, body, subject) };
    }

    default:
      return { subject: "Mensagem do " + salonName, html: generateHtml(logoUrl, salonName, "Mensagem", "<p>Olá!</p>", "Mensagem") };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── AUTENTICAÇÃO (falha 5): staff do salão, service_role interno ou
    //    segredo de cron. Sem nenhum dos três ⇒ recusa.
    const cron = requireCronSecret(req);
    if (!cron.ok) {
      const staff = await requireStaff(req, supabase);
      if (!staff.ok) {
        return new Response(JSON.stringify({ error: staff.error }), {
          status: staff.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // RESEND_API_KEY: APENAS Supabase Secrets (falha 6 — system_config não é
    // cofre). Ausente ⇒ pula com aviso (nenhum e-mail sai por via insegura).
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ skipped: true, reason: "RESEND_API_KEY não configurada" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload: EmailRequest = await req.json();
    const { type, salon_id, to_email, to_name, client_id, variables = {}, campaign_id, subject: customSubject, body: customBody } = payload;

    if (!to_email || !salon_id || !type) {
      throw new Error("Campos obrigatórios: type, salon_id, to_email");
    }

    const { data: salon } = await supabase
      .from("salons")
      .select("name, trade_name, logo_url, email")
      .eq("id", salon_id)
      .single();

    const salonName = salon?.trade_name || salon?.name || "Salão";
    const logoUrl = salon?.logo_url || null;
    const fromEmail = salon?.email || "noreply@resend.dev";

    const { subject, html } = buildEmailContent(
      type,
      { ...variables, client_name: to_name },
      salonName,
      logoUrl,
      customSubject,
      customBody
    );

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: `${salonName} <${fromEmail}>`,
        to: [to_email],
        subject,
        html,
      }),
    });

    const resendData = await resendRes.json();
    const status = resendRes.ok ? "sent" : "failed";
    const errorMessage = resendRes.ok ? null : JSON.stringify(resendData);

    await supabase.from("email_logs").insert({
      salon_id,
      client_id: client_id || null,
      email_type: type,
      subject,
      status,
      error_message: errorMessage,
      campaign_id: campaign_id || null,
      resend_id: resendRes.ok ? resendData.id : null,
      to_email,
    });

    if (!resendRes.ok) {
      throw new Error(`Resend error: ${JSON.stringify(resendData)}`);
    }

    return new Response(JSON.stringify({ success: true, id: resendData.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("send-email error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
