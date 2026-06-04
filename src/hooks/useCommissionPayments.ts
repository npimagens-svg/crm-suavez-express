// @ts-nocheck
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export interface CommissionPayment {
  id: string;
  salon_id: string;
  professional_id: string;
  period_start: string;
  period_end: string;
  total_amount: number;
  total_commission: number;
  total_bonus: number;
  total_discount: number;
  payment_method: string | null;
  notes: string | null;
  financial_transaction_id: string | null;
  paid_at: string;
  created_at: string;
}

export interface CommissionPaymentInput {
  professional_id: string;
  professional_name: string;
  period_start: string;
  period_end: string;
  total_amount: number;
  total_commission?: number;
  total_bonus?: number;
  total_discount?: number;
  payment_method?: string;
  notes?: string;
}

export function useCommissionPayments() {
  const { salonId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["commission_payments", salonId],
    queryFn: async () => {
      if (!salonId) return [];
      const { data, error } = await supabase
        .from("commission_payments")
        .select("*")
        .eq("salon_id", salonId)
        .order("paid_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CommissionPayment[];
    },
    enabled: !!salonId,
  });

  const createMutation = useMutation({
    mutationFn: async (input: CommissionPaymentInput) => {
      if (!salonId) throw new Error("Salão não encontrado");
      const periodo = `${input.period_start.split("-").reverse().join("/")} a ${input.period_end.split("-").reverse().join("/")}`;

      // Lança a despesa no fluxo financeiro
      const { data: tx, error: txErr } = await supabase
        .from("financial_transactions")
        .insert({
          salon_id: salonId,
          transaction_type: "expense",
          amount: input.total_amount,
          description: `Comissão ${input.professional_name} (${periodo})`,
          category: "Comissões",
          transaction_date: new Date().toISOString().slice(0, 10),
        })
        .select("id")
        .single();
      if (txErr) throw txErr;

      // Registra o pagamento de comissão (idempotente por período via UNIQUE)
      const { data, error } = await supabase
        .from("commission_payments")
        .upsert({
          salon_id: salonId,
          professional_id: input.professional_id,
          period_start: input.period_start,
          period_end: input.period_end,
          total_amount: input.total_amount,
          total_commission: input.total_commission ?? 0,
          total_bonus: input.total_bonus ?? 0,
          total_discount: input.total_discount ?? 0,
          payment_method: input.payment_method ?? null,
          notes: input.notes ?? null,
          financial_transaction_id: tx.id,
          paid_at: new Date().toISOString(),
        }, { onConflict: "salon_id,professional_id,period_start,period_end" })
        .select()
        .single();
      if (error) throw error;
      return data as CommissionPayment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commission_payments", salonId] });
      queryClient.invalidateQueries({ queryKey: ["financial_transactions"] });
      toast({ title: "Comissão paga e registrada!" });
    },
    onError: (err: Error) => toast({ title: "Erro ao registrar pagamento", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (payment: CommissionPayment) => {
      if (payment.financial_transaction_id) {
        await supabase.from("financial_transactions").delete().eq("id", payment.financial_transaction_id);
      }
      const { error } = await supabase.from("commission_payments").delete().eq("id", payment.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commission_payments", salonId] });
      queryClient.invalidateQueries({ queryKey: ["financial_transactions"] });
      toast({ title: "Pagamento estornado" });
    },
    onError: (err: Error) => toast({ title: "Erro ao estornar", description: err.message, variant: "destructive" }),
  });

  return {
    payments: query.data ?? [],
    isLoading: query.isLoading,
    payCommission: createMutation.mutate,
    payCommissionAsync: createMutation.mutateAsync,
    isPaying: createMutation.isPending,
    reverseCommission: deleteMutation.mutate,
    isReversing: deleteMutation.isPending,
  };
}
