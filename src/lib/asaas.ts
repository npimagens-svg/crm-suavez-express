import { supabase } from "@/lib/dynamicSupabaseClient";

const ASAAS_BASE_URL = "https://api.asaas.com/v3";

async function getAsaasKey(salonId: string): Promise<string | null> {
  const { data } = await supabase
    .from("queue_settings")
    .select("asaas_api_key")
    .eq("salon_id", salonId)
    .single();
  return data?.asaas_api_key || null;
}

export interface AsaasPaymentInput {
  customerName: string;
  customerCpfCnpj: string;
  customerPhone: string;
  customerEmail?: string;
  value: number;
  description: string;
  externalReference: string;
}

export interface AsaasPaymentResponse {
  id: string;
  status: string;
  invoiceUrl: string;
  pixQrCode?: {
    encodedImage: string;
    payload: string;
    expirationDate: string;
  };
}

export async function createAsaasPayment(
  salonId: string,
  input: AsaasPaymentInput
): Promise<AsaasPaymentResponse> {
  const apiKey = await getAsaasKey(salonId);
  if (!apiKey) throw new Error("Asaas API key not configured");

  const customerRes = await fetch(`${ASAAS_BASE_URL}/customers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", access_token: apiKey },
    body: JSON.stringify({
      name: input.customerName,
      cpfCnpj: input.customerCpfCnpj,
      phone: input.customerPhone,
      email: input.customerEmail,
    }),
  });

  const customer = await customerRes.json();
  const customerId = customer.id || customer.errors?.[0]?.description?.match(/cus_\w+/)?.[0];
  if (!customerId) throw new Error("Falha ao criar cliente no Asaas");

  const paymentRes = await fetch(`${ASAAS_BASE_URL}/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", access_token: apiKey },
    body: JSON.stringify({
      customer: customerId,
      billingType: "PIX",
      value: input.value,
      description: input.description,
      externalReference: input.externalReference,
      dueDate: new Date().toISOString().split("T")[0],
    }),
  });

  const payment = await paymentRes.json();
  if (payment.errors) throw new Error(payment.errors[0]?.description || "Erro no pagamento");

  const pixRes = await fetch(`${ASAAS_BASE_URL}/payments/${payment.id}/pixQrCode`, {
    headers: { access_token: apiKey },
  });
  const pixData = await pixRes.json();

  return {
    id: payment.id,
    status: payment.status,
    invoiceUrl: payment.invoiceUrl,
    pixQrCode: pixData.success !== false ? pixData : undefined,
  };
}

export async function getAsaasPaymentStatus(salonId: string, paymentId: string): Promise<string> {
  const apiKey = await getAsaasKey(salonId);
  if (!apiKey) throw new Error("Asaas API key not configured");

  const res = await fetch(`${ASAAS_BASE_URL}/payments/${paymentId}`, {
    headers: { access_token: apiKey },
  });
  const data = await res.json();
  return data.status;
}
