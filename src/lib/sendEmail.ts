import { supabase } from "@/lib/dynamicSupabaseClient";

interface SendEmailParams {
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

export async function sendEmail(params: SendEmailParams) {
  // E-mails automáticos de AGENDAMENTO desativados (salão é walk-in — Cleiton 08/07).
  // Cobre confirmação/lembrete/alteração/cancelamento de agendamento num ponto só.
  if (params.type.startsWith("appointment_")) {
    return { skipped: true, reason: "appointment emails disabled" };
  }
  const { data, error } = await supabase.functions.invoke("send-email", {
    body: params,
  });
  if (error) throw error;
  return data;
}
