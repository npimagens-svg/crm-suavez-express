import { supabase } from "@/lib/dynamicSupabaseClient";

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

async function callAsaasProxy(salonId: string, action: string, data: Record<string, unknown>) {
  const { data: result, error } = await supabase.functions.invoke("asaas-proxy", {
    body: { action, salonId, data },
  });

  if (error) throw new Error(error.message || "Erro na comunicacao com Asaas");
  if (result?.error) throw new Error(result.error);
  return result;
}

export async function createAsaasPayment(
  salonId: string,
  input: AsaasPaymentInput
): Promise<AsaasPaymentResponse> {
  // Step 1: Create customer
  const customer = await callAsaasProxy(salonId, "createCustomer", {
    name: input.customerName,
    cpfCnpj: input.customerCpfCnpj,
    phone: input.customerPhone,
    email: input.customerEmail,
  });

  const customerId = customer.id;
  if (!customerId) throw new Error("Falha ao criar cliente no Asaas");

  // Step 2: Create PIX payment
  const payment = await callAsaasProxy(salonId, "createPayment", {
    customerId,
    value: input.value,
    description: input.description,
    externalReference: input.externalReference,
  });

  // Step 3: Get PIX QR code
  const pixData = await callAsaasProxy(salonId, "getPixQrCode", {
    paymentId: payment.id,
  });

  return {
    id: payment.id,
    status: payment.status,
    invoiceUrl: payment.invoiceUrl,
    pixQrCode: pixData.success !== false ? pixData : undefined,
  };
}

export async function getAsaasPaymentStatus(salonId: string, paymentId: string): Promise<string> {
  const result = await callAsaasProxy(salonId, "getPaymentStatus", { paymentId });
  return result.status;
}
