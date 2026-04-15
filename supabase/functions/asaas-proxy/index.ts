import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ASAAS_BASE_URL = "https://api.asaas.com/v3";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { action, salonId, data } = await req.json();

    // Get Asaas API key from queue_settings
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: settings } = await supabase
      .from("queue_settings")
      .select("asaas_api_key")
      .eq("salon_id", salonId)
      .single();

    if (!settings?.asaas_api_key) {
      return new Response(
        JSON.stringify({ error: "Asaas API key not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = settings.asaas_api_key;
    const headers = {
      "Content-Type": "application/json",
      access_token: apiKey,
    };

    let result;

    if (action === "createCustomer") {
      const res = await fetch(`${ASAAS_BASE_URL}/customers`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: data.name,
          cpfCnpj: data.cpfCnpj,
          phone: data.phone,
          email: data.email,
        }),
      });
      result = await res.json();

      // If customer already exists, extract ID from error
      if (result.errors) {
        const match = result.errors[0]?.description?.match(/cus_\w+/);
        if (match) {
          result = { id: match[0] };
        } else {
          return new Response(
            JSON.stringify({ error: result.errors[0]?.description || "Erro ao criar cliente" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    } else if (action === "createPayment") {
      const res = await fetch(`${ASAAS_BASE_URL}/payments`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          customer: data.customerId,
          billingType: "PIX",
          value: data.value,
          description: data.description,
          externalReference: data.externalReference,
          dueDate: new Date().toISOString().split("T")[0],
        }),
      });
      result = await res.json();

      if (result.errors) {
        return new Response(
          JSON.stringify({ error: result.errors[0]?.description || "Erro no pagamento" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else if (action === "getPixQrCode") {
      const res = await fetch(`${ASAAS_BASE_URL}/payments/${data.paymentId}/pixQrCode`, {
        headers,
      });
      result = await res.json();
    } else if (action === "getPaymentStatus") {
      const res = await fetch(`${ASAAS_BASE_URL}/payments/${data.paymentId}`, {
        headers,
      });
      const payment = await res.json();
      result = { status: payment.status };
    } else {
      return new Response(
        JSON.stringify({ error: "Invalid action" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
