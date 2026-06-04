import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export type AdjustmentType = "bonus" | "discount";

export interface CommissionAdjustment {
  id: string;
  salon_id: string;
  professional_id: string;
  adjustment_date: string;
  adjustment_type: AdjustmentType;
  amount: number;
  description: string;
  created_by_name: string | null;
  created_at: string;
}

export interface CommissionAdjustmentInput {
  professional_id: string;
  adjustment_date: string;
  adjustment_type: AdjustmentType;
  amount: number;
  description: string;
  created_by_name?: string | null;
}

interface UseCommissionAdjustmentsParams {
  periodStart?: string;
  periodEnd?: string;
  professionalId?: string;
}

export function useCommissionAdjustments({
  periodStart,
  periodEnd,
  professionalId,
}: UseCommissionAdjustmentsParams = {}) {
  const { salonId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["commission-adjustments", salonId, periodStart, periodEnd, professionalId ?? "all"],
    queryFn: async () => {
      if (!salonId) return [] as CommissionAdjustment[];
      let q = supabase
        .from("commission_adjustments")
        .select("*")
        .eq("salon_id", salonId)
        .order("adjustment_date", { ascending: false });

      if (periodStart) q = q.gte("adjustment_date", periodStart);
      if (periodEnd) q = q.lte("adjustment_date", periodEnd);
      if (professionalId) q = q.eq("professional_id", professionalId);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CommissionAdjustment[];
    },
    enabled: !!salonId,
  });

  const createMutation = useMutation({
    mutationFn: async (input: CommissionAdjustmentInput) => {
      if (!salonId) throw new Error("Salão não encontrado");
      const { data, error } = await supabase
        .from("commission_adjustments")
        .insert({ ...input, salon_id: salonId })
        .select()
        .single();
      if (error) throw error;
      return data as CommissionAdjustment;
    },
    onSuccess: (adj) => {
      queryClient.invalidateQueries({ queryKey: ["commission-adjustments", salonId] });
      toast({
        title: adj.adjustment_type === "bonus" ? "Bônus adicionado" : "Desconto adicionado",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Erro ao registrar ajuste",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("commission_adjustments")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commission-adjustments", salonId] });
      toast({ title: "Ajuste removido" });
    },
    onError: (error: Error) => {
      toast({
        title: "Erro ao remover ajuste",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return {
    adjustments: query.data ?? [],
    isLoading: query.isLoading,
    createAdjustment: createMutation.mutate,
    deleteAdjustment: deleteMutation.mutate,
    isCreating: createMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
