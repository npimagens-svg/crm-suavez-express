// @ts-nocheck
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export type CaixaMovementType = "sangria" | "suprimento";
export type CaixaMovementMethod = "cash" | "pix" | "credit_card" | "debit_card" | "other";

export interface CaixaMovement {
  id: string;
  caixa_id: string;
  salon_id: string;
  user_id: string;
  type: CaixaMovementType;
  amount: number;
  reason: string;
  payment_method: CaixaMovementMethod;
  created_at: string;
  profile?: { full_name: string | null };
}

export interface CaixaMovementInput {
  caixa_id: string;
  type: CaixaMovementType;
  amount: number;
  reason: string;
  payment_method?: CaixaMovementMethod;
}

export function useCaixaMovements(caixaId?: string) {
  const { salonId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["caixa_movements", caixaId],
    queryFn: async () => {
      if (!caixaId) return [];
      const { data, error } = await supabase
        .from("caixa_movements")
        .select("*")
        .eq("caixa_id", caixaId)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const userIds = [...new Set((data || []).map((m: any) => m.user_id))];
      const { data: profiles } = userIds.length
        ? await supabase.from("profiles").select("user_id, full_name").in("user_id", userIds)
        : { data: [] as any[] };
      const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p]));
      return (data || []).map((m: any) => ({
        ...m,
        profile: profileMap.get(m.user_id) || null,
      })) as CaixaMovement[];
    },
    enabled: !!caixaId,
  });

  const createMutation = useMutation({
    mutationFn: async (input: CaixaMovementInput) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !salonId) throw new Error("Usuário não autenticado");
      if (!input.reason?.trim()) throw new Error("Motivo é obrigatório");
      if (!(input.amount > 0)) throw new Error("Valor deve ser maior que zero");

      const { data, error } = await supabase
        .from("caixa_movements")
        .insert({
          caixa_id: input.caixa_id,
          salon_id: salonId,
          user_id: user.id,
          type: input.type,
          amount: input.amount,
          reason: input.reason.trim(),
          payment_method: input.payment_method || "cash",
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["caixa_movements", data.caixa_id] });
      queryClient.invalidateQueries({ queryKey: ["caixas", salonId] });
      toast({
        title: data.type === "sangria" ? "Sangria registrada" : "Suprimento registrado",
        description: `R$ ${Number(data.amount).toFixed(2)} — ${data.reason}`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao registrar movimentação", description: error.message, variant: "destructive" });
    },
  });

  return {
    movements: query.data ?? [],
    isLoading: query.isLoading,
    createMovement: createMutation.mutate,
    createMovementAsync: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
  };
}
