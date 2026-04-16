import { supabase } from "@/lib/dynamicSupabaseClient";
import { sendEmail } from "@/lib/sendEmail";

interface NotifyParams {
  phone: string;
  email?: string | null;
  message: string;
  salonId: string;
  emailSubject?: string;
  emailBody?: string;
}


async function sendWhatsApp(phone: string, message: string, salonId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.functions.invoke("zapi-proxy", {
      body: { salonId, phone, message },
    });

    if (error) {
      console.error("WhatsApp send failed:", error);
      return false;
    }
    return !!data?.messageId;
  } catch (error) {
    console.error("WhatsApp send failed:", error);
    return false;
  }
}

export async function notifyClient({ phone, email, message, salonId, emailSubject, emailBody }: NotifyParams) {
  const whatsappSent = await sendWhatsApp(phone, message, salonId);

  if (email && emailSubject) {
    try {
      await sendEmail({
        type: "campaign",
        salon_id: salonId,
        to_email: email,
        to_name: "",
        subject: emailSubject,
        body: emailBody || message,
      });
    } catch (error) {
      console.error("Email send failed:", error);
    }
  }

  return whatsappSent;
}

export async function notifyQueueEntry(
  salonId: string,
  entry: { customer_phone: string; customer_email: string | null; customer_name: string },
  type: "entered" | "advance" | "next" | "skipped" | "credit",
  extra?: { position?: number; estimatedTime?: string; creditAmount?: number; trackingUrl?: string }
) {
  const messages: Record<string, { whatsapp: string; emailSubject: string; emailBody: string }> = {
    entered: {
      whatsapp: `Oi ${entry.customer_name}! Voce entrou na fila do NP Hair Express. Posicao: ${extra?.position}a. Acompanhe aqui: ${extra?.trackingUrl}`,
      emailSubject: "Voce entrou na fila - NP Hair Express",
      emailBody: `Oi ${entry.customer_name}! Voce esta na posicao ${extra?.position} da fila. Acompanhe em tempo real: ${extra?.trackingUrl}`,
    },
    advance: {
      whatsapp: `${entry.customer_name}, faltam aproximadamente ${extra?.estimatedTime} minutos pro seu atendimento no NP Hair. Venha se preparando!`,
      emailSubject: "Sua vez esta chegando - NP Hair Express",
      emailBody: `Faltam aproximadamente ${extra?.estimatedTime} minutos para o seu atendimento.`,
    },
    next: {
      whatsapp: `${entry.customer_name}, voce e a proxima! Chegue ao NP Hair Express nos proximos 15 minutos.`,
      emailSubject: "Voce e a proxima! - NP Hair Express",
      emailBody: `Sua vez chegou! Por favor, chegue ao NP Hair Express nos proximos 15 minutos.`,
    },
    skipped: {
      whatsapp: `${entry.customer_name}, passamos a proxima da fila. Voce ainda esta na lista, avise quando chegar!`,
      emailSubject: "",
      emailBody: "",
    },
    credit: {
      whatsapp: `${entry.customer_name}, voce recebeu um credito de R$${extra?.creditAmount?.toFixed(2)} valido por 30 dias no NP Hair Express. Volte quando quiser!`,
      emailSubject: "Credito disponivel - NP Hair Express",
      emailBody: `Voce recebeu um credito de R$${extra?.creditAmount?.toFixed(2)} valido por 30 dias. Volte quando quiser!`,
    },
  };

  const msg = messages[type];
  if (!msg) return;

  const sendEmailForTypes = ["entered", "next", "credit"];

  await notifyClient({
    phone: entry.customer_phone,
    email: sendEmailForTypes.includes(type) ? entry.customer_email : null,
    message: msg.whatsapp,
    salonId,
    emailSubject: msg.emailSubject || undefined,
    emailBody: msg.emailBody || undefined,
  });
}

export async function notifyLead(
  salonId: string,
  lead: { phone: string; name: string },
  currentQueueSize: number,
  queueUrl: string
): Promise<boolean> {
  return await notifyClient({
    phone: lead.phone,
    message: `${lead.name}, a fila do NP Hair ta rapidinha agora! So ${currentQueueSize} pessoa(s). Quer entrar? ${queueUrl}`,
    salonId,
  });
}

export async function notifyReception(salonId: string, subject: string, body: string) {
  const { data: settings } = await supabase
    .from("queue_settings")
    .select("reception_email")
    .eq("salon_id", salonId)
    .single();

  if (settings?.reception_email) {
    await sendEmail({
      type: "campaign",
      salon_id: salonId,
      to_email: settings.reception_email,
      to_name: "Recepcao",
      subject,
      body,
    });
  }
}
