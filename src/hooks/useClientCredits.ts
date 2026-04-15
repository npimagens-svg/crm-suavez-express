import { supabase } from "@/lib/dynamicSupabaseClient";
import { useAuth } from "@/contexts/AuthContext";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { sendEmail } from "@/lib/sendEmail";

let LOYALTY_PERCENT = 0.07; // Default 7%, loaded from system_config
const LOYALTY_VALIDITY_DAYS = 15;
const MIN_PURCHASE_AMOUNT = 100;

export function useGenerateLoyaltyCredit() {
  const { salonId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ clientId, comandaId, comandaTotal }: { clientId: string; comandaId: string; comandaTotal: number }) => {
      if (!salonId || !clientId || comandaTotal <= 0) return null;

      // Load cashback percent from system_config
      const { data: configData } = await supabase
        .from("system_config")
        .select("value")
        .eq("key", "cashback_percent")
        .maybeSingle();
      if (configData?.value) {
        LOYALTY_PERCENT = parseFloat(configData.value) / 100;
      }

      const creditAmount = Math.round(comandaTotal * LOYALTY_PERCENT * 100) / 100;
      const expiresAt = addDays(new Date(), LOYALTY_VALIDITY_DAYS).toISOString();

      const { data, error } = await supabase
        .from("client_credits")
        .insert({
          salon_id: salonId,
          client_id: clientId,
          comanda_id: comandaId,
          credit_amount: creditAmount,
          min_purchase_amount: MIN_PURCHASE_AMOUNT,
          expires_at: expiresAt,
        })
        .select("*, clients(name, email)")
        .single();

      if (error) throw error;

      // Send cashback email
      const client = (data as any)?.clients;
      if (client?.email && salonId) {
        sendEmail({
          type: "cashback",
          salon_id: salonId,
          to_email: client.email,
          to_name: client.name,
          client_id: clientId,
          variables: {
            credit_amount: creditAmount.toFixed(2),
            expires_at: format(new Date(expiresAt), "dd/MM/yyyy", { locale: ptBR }),
          },
        }).catch(() => {});
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-credits"] });
    },
  });
}

export function useApplyLoyaltyCredit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ creditId, comandaId }: { creditId: string; comandaId: string }) => {
      const { error } = await supabase
        .from("client_credits")
        .update({
          is_used: true,
          used_at: new Date().toISOString(),
          used_in_comanda_id: comandaId,
        })
        .eq("id", creditId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-credits"] });
    },
  });
}
