import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireCronSecret } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // ── AUTENTICAÇÃO (falha 5): só o agendador com x-cron-secret dispara o
  //    cron de e-mails. CRON_SECRET ausente ⇒ 503 (falha fechada).
  const cron = requireCronSecret(req);
  if (!cron.ok) {
    return new Response(JSON.stringify({ error: cron.error }), {
      status: cron.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // RESEND_API_KEY: APENAS Supabase Secrets (system_config não é cofre).
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      // Gracefully skip — email not configured
      return new Response(JSON.stringify({ skipped: true, message: "RESEND_API_KEY not configured, skipping email cron" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: { type: string; sent: number; errors: number }[] = [];

    // Get all salons
    const { data: salons } = await supabase.from("salons").select("id, name, trade_name, logo_url, email");
    if (!salons || salons.length === 0) {
      return new Response(JSON.stringify({ message: "No salons found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sendEmailUrl = `${supabaseUrl}/functions/v1/send-email`;

    for (const salon of salons) {
      const salonId = salon.id;

      // ============ 1. BIRTHDAY EMAILS ============
      const today = new Date();
      const monthDay = `${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

      const { data: birthdayClients } = await supabase
        .from("clients")
        .select("id, name, email, birth_date, allow_email_campaigns")
        .eq("salon_id", salonId)
        .eq("allow_email_campaigns", true)
        .not("email", "is", null)
        .not("birth_date", "is", null);

      let birthdaySent = 0, birthdayErrors = 0;
      for (const client of birthdayClients || []) {
        if (!client.email || !client.birth_date) continue;
        const bd = client.birth_date; // format: YYYY-MM-DD
        if (!bd.endsWith(monthDay)) continue;

        // Check if already sent today
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
        const { data: existing } = await supabase
          .from("email_logs")
          .select("id")
          .eq("salon_id", salonId)
          .eq("client_id", client.id)
          .eq("email_type", "birthday")
          .gte("created_at", todayStart)
          .limit(1);

        if (existing && existing.length > 0) continue;

        const res = await fetch(sendEmailUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            type: "birthday",
            salon_id: salonId,
            to_email: client.email,
            to_name: client.name,
            client_id: client.id,
            variables: {},
          }),
        });
        if (res.ok) birthdaySent++;
        else birthdayErrors++;
        await res.text(); // consume body
      }
      results.push({ type: "birthday", sent: birthdaySent, errors: birthdayErrors });

      // ============ 2. APPOINTMENT REMINDERS (24h before) ============
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStart = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 0, 0, 0).toISOString();
      const tomorrowEnd = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 23, 59, 59, 999).toISOString();

      const { data: tomorrowAppointments } = await supabase
        .from("appointments")
        .select(`
          id, client_id, scheduled_at,
          clients(id, name, email, allow_email_campaigns),
          professionals(name),
          services(name)
        `)
        .eq("salon_id", salonId)
        .in("status", ["scheduled", "confirmed"])
        .gte("scheduled_at", tomorrowStart)
        .lte("scheduled_at", tomorrowEnd);

      let appointmentReminderSent = 0, appointmentReminderErrors = 0;
      for (const appt of tomorrowAppointments || []) {
        const client = appt.clients as any;
        if (!client?.email || !client?.allow_email_campaigns) continue;

        // Check if already sent today
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
        const { data: existing } = await supabase
          .from("email_logs")
          .select("id")
          .eq("salon_id", salonId)
          .eq("client_id", client.id)
          .eq("email_type", "appointment_reminder")
          .gte("created_at", todayStart)
          .limit(1);

        if (existing && existing.length > 0) continue;

        const scheduledAt = new Date(appt.scheduled_at);
        const dateStr = `${String(scheduledAt.getDate()).padStart(2, "0")}/${String(scheduledAt.getMonth() + 1).padStart(2, "0")}/${scheduledAt.getFullYear()}`;
        const timeStr = `${String(scheduledAt.getHours()).padStart(2, "0")}:${String(scheduledAt.getMinutes()).padStart(2, "0")}`;

        const res = await fetch(sendEmailUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            type: "appointment_reminder",
            salon_id: salonId,
            to_email: client.email,
            to_name: client.name,
            client_id: client.id,
            variables: {
              service_name: (appt.services as any)?.name || "Não informado",
              professional_name: (appt.professionals as any)?.name || "Não informado",
              date: dateStr,
              time: timeStr,
            },
          }),
        });
        if (res.ok) appointmentReminderSent++;
        else appointmentReminderErrors++;
        await res.text();
      }
      results.push({ type: "appointment_reminder", sent: appointmentReminderSent, errors: appointmentReminderErrors });

      // ============ 3. EXPIRING CASHBACK (3 days) ============
      const threeDaysLater = new Date(today);
      threeDaysLater.setDate(threeDaysLater.getDate() + 3);
      const threeDaysStr = threeDaysLater.toISOString().split("T")[0];

      const { data: expiringCredits } = await supabase
        .from("client_credits")
        .select("id, client_id, credit_amount, expires_at, clients(name, email, allow_email_campaigns)")
        .eq("salon_id", salonId)
        .eq("is_used", false)
        .eq("is_expired", false)
        .lte("expires_at", threeDaysLater.toISOString())
        .gte("expires_at", today.toISOString());

      let expiringSent = 0, expiringErrors = 0;
      for (const credit of expiringCredits || []) {
        const client = credit.clients as any;
        if (!client?.email || !client?.allow_email_campaigns) continue;

        // Check if already sent
        const { data: existing } = await supabase
          .from("email_logs")
          .select("id")
          .eq("salon_id", salonId)
          .eq("client_id", credit.client_id)
          .eq("email_type", "expiring")
          .gte("created_at", new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString())
          .limit(1);

        if (existing && existing.length > 0) continue;

        const daysLeft = Math.ceil((new Date(credit.expires_at).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        const res = await fetch(sendEmailUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            type: "expiring",
            salon_id: salonId,
            to_email: client.email,
            to_name: client.name,
            client_id: credit.client_id,
            variables: {
              credit_amount: Number(credit.credit_amount).toFixed(2),
              expires_at: new Date(credit.expires_at).toLocaleDateString("pt-BR"),
              days_left: String(daysLeft),
            },
          }),
        });
        if (res.ok) expiringSent++;
        else expiringErrors++;
        await res.text();
      }
      results.push({ type: "expiring", sent: expiringSent, errors: expiringErrors });

      // ============ 4. RETURN REMINDERS ============
      const { data: reminderServices } = await supabase
        .from("services")
        .select("id, name, return_reminder_days, return_reminder_message")
        .eq("salon_id", salonId)
        .eq("send_return_reminder", true)
        .eq("is_active", true);

      let reminderSent = 0, reminderErrors = 0;
      for (const svc of reminderServices || []) {
        const reminderDays = svc.return_reminder_days || 30;
        const targetDate = new Date(today);
        targetDate.setDate(targetDate.getDate() - reminderDays);
        const targetDateStr = targetDate.toISOString().split("T")[0];

        // Find clients who had this service exactly N days ago via comanda_items
        const { data: items } = await supabase
          .from("comanda_items")
          .select(`
            comanda_id,
            comandas!inner(salon_id, client_id, closed_at, clients!inner(id, name, email, allow_email_campaigns))
          `)
          .eq("service_id", svc.id)
          .not("comandas.client_id", "is", null)
          .not("comandas.closed_at", "is", null);

        // Group by client, find those whose last service was exactly reminderDays ago
        const clientLastService: Record<string, { date: Date; name: string; email: string; clientId: string; allowEmail: boolean }> = {};
        for (const item of items || []) {
          const comanda = (item as any).comandas;
          if (!comanda?.clients) continue;
          const client = comanda.clients;
          const closedAt = new Date(comanda.closed_at);
          const cid = client.id;
          if (!clientLastService[cid] || closedAt > clientLastService[cid].date) {
            clientLastService[cid] = {
              date: closedAt,
              name: client.name,
              email: client.email,
              clientId: cid,
              allowEmail: client.allow_email_campaigns,
            };
          }
        }

        for (const [cid, info] of Object.entries(clientLastService)) {
          if (!info.email || !info.allowEmail) continue;
          const daysSince = Math.floor((today.getTime() - info.date.getTime()) / (1000 * 60 * 60 * 24));
          if (daysSince !== reminderDays) continue;

          // Check if already sent
          const { data: existing } = await supabase
            .from("email_logs")
            .select("id")
            .eq("salon_id", salonId)
            .eq("client_id", cid)
            .eq("email_type", "return_reminder")
            .gte("created_at", new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString())
            .limit(1);

          if (existing && existing.length > 0) continue;

          const res = await fetch(sendEmailUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              type: "return_reminder",
              salon_id: salonId,
              to_email: info.email,
              to_name: info.name,
              client_id: cid,
              variables: {
                service_name: svc.name,
                days: String(daysSince),
                custom_message: svc.return_reminder_message || "",
              },
            }),
          });
          if (res.ok) reminderSent++;
          else reminderErrors++;
          await res.text();
        }
      }
      results.push({ type: "return_reminder", sent: reminderSent, errors: reminderErrors });
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("email-cron error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
