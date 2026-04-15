import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { salonId, professionalId } = await req.json();
    if (!salonId || !professionalId) {
      return new Response(
        JSON.stringify({ error: "salonId and professionalId required" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Mark current queue entry as completed
    const { data: currentEntry } = await supabase
      .from("queue_entries")
      .select("id")
      .eq("salon_id", salonId)
      .eq("assigned_professional_id", professionalId)
      .eq("status", "in_service")
      .maybeSingle();

    if (currentEntry) {
      await supabase
        .from("queue_entries")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .eq("id", currentEntry.id);
    }

    // 2. Find next in queue
    const { data: nextEntries } = await supabase
      .from("queue_entries")
      .select("*")
      .eq("salon_id", salonId)
      .in("status", ["checked_in", "waiting"])
      .order("position", { ascending: true })
      .limit(3);

    if (!nextEntries || nextEntries.length === 0) {
      return new Response(
        JSON.stringify({ message: "No one in queue", completed: currentEntry?.id }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const next = nextEntries.find((e) => e.status === "checked_in") || nextEntries[0];

    if (!next || next.notify_next_sent) {
      return new Response(
        JSON.stringify({ message: "Next already notified", completed: currentEntry?.id }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Get Z-API credentials
    const { data: settings } = await supabase
      .from("queue_settings")
      .select("zapi_instance_id, zapi_token, zapi_client_token, reception_email")
      .eq("salon_id", salonId)
      .single();

    // 4. Send WhatsApp
    if (settings?.zapi_instance_id && settings?.zapi_token) {
      const cleanPhone = next.customer_phone.replace(/\D/g, "");
      const fullPhone = cleanPhone.startsWith("55") ? cleanPhone : `55${cleanPhone}`;

      const zapiHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (settings.zapi_client_token) {
        zapiHeaders["Client-Token"] = settings.zapi_client_token;
      }

      const message = `${next.customer_name}, voce e a proxima! Chegue ao NP Hair Express nos proximos 15 minutos.`;

      await fetch(
        `https://api.z-api.io/instances/${settings.zapi_instance_id}/token/${settings.zapi_token}/send-text`,
        {
          method: "POST",
          headers: zapiHeaders,
          body: JSON.stringify({ phone: fullPhone, message }),
        }
      );
    }

    // 5. Send email
    if (next.customer_email) {
      const { data: resendConfig } = await supabase
        .from("system_config")
        .select("value")
        .eq("key", "resend_api_key")
        .maybeSingle();

      if (resendConfig?.value) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendConfig.value}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "NP Hair Express <fila@nphairexpress.com.br>",
            to: next.customer_email,
            subject: "Você é a próxima! - NP Hair Express",
            html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e5e5"><div style="background:#18181b;padding:24px;text-align:center"><h1 style="color:#fff;margin:0;font-size:22px">NP Hair Express</h1></div><div style="padding:24px"><p style="font-size:16px;color:#27272a">Oi <strong>${next.customer_name}</strong>!</p><div style="background:#dcfce7;border-radius:8px;padding:16px;text-align:center;margin:20px 0"><p style="margin:0;font-size:24px;font-weight:bold;color:#16a34a">Você é a próxima!</p></div><p style="font-size:16px;color:#27272a">Chegue ao NP Hair Express nos próximos <strong>15 minutos</strong>.</p></div><div style="background:#f4f4f5;padding:16px;text-align:center"><p style="margin:0;font-size:12px;color:#a1a1aa">NP Hair Express — Salto/SP</p></div></div>`,
          }),
        });
      }
    }

    // 6. Mark as notified
    await supabase
      .from("queue_entries")
      .update({ notify_next_sent: true, updated_at: new Date().toISOString() })
      .eq("id", next.id);

    return new Response(
      JSON.stringify({
        message: "Next client notified",
        completed: currentEntry?.id,
        notified: next.id,
        notifiedName: next.customer_name,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
