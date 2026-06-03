// @ts-nocheck
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export type PayableStatus = "pending" | "paid" | "overdue" | "cancelled";

export interface AccountPayable {
  id: string;
  salon_id: string;
  supplier_id: string | null;
  nf_numero: string | null;
  nf_serie: string | null;
  nf_chave: string | null;
  parcela: number;
  total_parcelas: number;
  valor_original: number;
  valor_pago: number;
  juros: number;
  desconto: number;
  emissao: string | null;
  due_date: string;
  paid_at: string | null;
  status: PayableStatus;
  description: string;
  category: string | null;
  payment_method: string | null;
  bank_account_id: string | null;
  financial_transaction_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  supplier?: { id: string; name: string; trade_name: string | null } | null;
}

export interface PayableInput {
  supplier_id?: string | null;
  nf_numero?: string | null;
  nf_serie?: string | null;
  parcela?: number;
  total_parcelas?: number;
  valor_original: number;
  emissao?: string | null;
  due_date: string;
  description: string;
  category?: string | null;
  payment_method?: string | null;
  notes?: string | null;
}

export interface MarkAsPaidInput {
  id: string;
  paid_at: string;
  valor_pago?: number;
  juros?: number;
  desconto?: number;
  payment_method?: string;
  bank_account_id?: string | null;
  notes?: string;
}

export function useAccountsPayable() {
  const { salonId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["accounts_payable", salonId],
    queryFn: async () => {
      if (!salonId) return [];

      // Antes de listar, atualiza pra "overdue" o que passou
      await supabase
        .from("accounts_payable")
        .update({ status: "overdue" })
        .eq("salon_id", salonId)
        .eq("status", "pending")
        .lt("due_date", new Date().toISOString().slice(0, 10));

      const { data, error } = await supabase
        .from("accounts_payable")
        .select("*, supplier:suppliers(id,name,trade_name)")
        .eq("salon_id", salonId)
        .order("due_date", { ascending: true });

      if (error) throw error;
      return (data ?? []) as AccountPayable[];
    },
    enabled: !!salonId,
  });

  const createMutation = useMutation({
    mutationFn: async (input: PayableInput) => {
      if (!salonId) throw new Error("salon não identificado");
      const { data, error } = await supabase
        .from("accounts_payable")
        .insert({ ...input, salon_id: salonId })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts_payable", salonId] });
      toast({ title: "Conta a pagar criada" });
    },
    onError: (err: any) => toast({ title: "Erro ao criar", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...patch }: PayableInput & { id: string }) => {
      const { data, error } = await supabase
        .from("accounts_payable")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts_payable", salonId] });
      toast({ title: "Atualizado" });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const markAsPaidMutation = useMutation({
    mutationFn: async (input: MarkAsPaidInput) => {
      const { id, paid_at, valor_pago, juros = 0, desconto = 0, payment_method, bank_account_id, notes } = input;

      // Buscar conta pra usar valor_original como fallback
      const { data: payable, error: fetchErr } = await supabase
        .from("accounts_payable")
        .select("valor_original, description, category, salon_id")
        .eq("id", id)
        .single();
      if (fetchErr) throw fetchErr;

      const valorPagoFinal = valor_pago ?? Number(payable.valor_original) + juros - desconto;

      // Lança expense em financial_transactions
      const { data: tx, error: txErr } = await supabase
        .from("financial_transactions")
        .insert({
          salon_id: payable.salon_id,
          transaction_type: "expense",
          amount: valorPagoFinal,
          description: payable.description,
          category: payable.category ?? "Estoque",
          transaction_date: paid_at,
        })
        .select()
        .single();
      if (txErr) throw txErr;

      // Marca conta como paga
      const { data, error } = await supabase
        .from("accounts_payable")
        .update({
          status: "paid",
          paid_at,
          valor_pago: valorPagoFinal,
          juros,
          desconto,
          payment_method: payment_method ?? null,
          bank_account_id: bank_account_id ?? null,
          financial_transaction_id: tx.id,
          notes: notes ?? null,
        })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts_payable", salonId] });
      queryClient.invalidateQueries({ queryKey: ["financial_transactions"] });
      toast({ title: "Conta marcada como paga" });
    },
    onError: (err: any) => toast({ title: "Erro ao marcar como paga", description: err.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("accounts_payable")
        .update({ status: "cancelled" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts_payable", salonId] });
      toast({ title: "Cancelada" });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("accounts_payable").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts_payable", salonId] });
      toast({ title: "Removida" });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  return {
    payables: query.data ?? [],
    isLoading: query.isLoading,
    createPayable: createMutation.mutate,
    updatePayable: updateMutation.mutate,
    markAsPaid: markAsPaidMutation.mutate,
    cancelPayable: cancelMutation.mutate,
    deletePayable: deleteMutation.mutate,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isMarkingPaid: markAsPaidMutation.isPending,
  };
}

/** Hook leve só pro widget do Dashboard (próximas a vencer) */
export function useUpcomingPayables(daysAhead: number = 7) {
  const { salonId } = useAuth();
  return useQuery({
    queryKey: ["accounts_payable_upcoming", salonId, daysAhead],
    queryFn: async () => {
      if (!salonId) return [];
      const now = new Date();
      const limit = new Date();
      limit.setDate(limit.getDate() + daysAhead);

      const { data, error } = await supabase
        .from("accounts_payable")
        .select("id, due_date, valor_original, description, status, supplier:suppliers(name, trade_name)")
        .eq("salon_id", salonId)
        .in("status", ["pending", "overdue"])
        .lte("due_date", limit.toISOString().slice(0, 10))
        .order("due_date", { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!salonId,
    refetchInterval: 1000 * 60 * 5, // refresh a cada 5min
  });
}
