// @ts-nocheck
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { isSameDay, startOfDay, endOfDay } from "date-fns";

export interface Caixa {
  id: string;
  salon_id: string;
  user_id: string;
  opened_at: string;
  closed_at: string | null;
  opening_balance: number;
  closing_balance: number | null;
  total_cash: number;
  total_pix: number;
  total_credit_card: number;
  total_debit_card: number;
  total_other: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  profile?: {
    full_name: string;
    avatar_url: string | null;
  };
}

export interface CaixaInput {
  opening_balance: number;
  notes?: string;
  opened_at?: string; // ISO string — master can backdate when registering a retro caixa
}

export function useCaixas() {
  const { salonId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: caixas = [], isLoading, error } = useQuery({
    queryKey: ["caixas", salonId],
    queryFn: async () => {
      if (!salonId) return [];
      
      // Fetch caixas
      const { data: caixasData, error: caixasError } = await supabase
        .from("caixas")
        .select("*")
        .eq("salon_id", salonId)
        .order("opened_at", { ascending: false });

      if (caixasError) throw caixasError;

      // Fetch profiles + professional avatars for all user_ids
      const userIds = [...new Set(caixasData.map(c => c.user_id))];
      const [{ data: profiles }, { data: professionals }] = await Promise.all([
        supabase.from("profiles").select("user_id, full_name, avatar_url").in("user_id", userIds),
        supabase.from("professionals").select("user_id, avatar_url").in("user_id", userIds),
      ]);

      // Map profiles to caixas, using professional avatar as fallback
      const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);
      const profAvatarMap = new Map(professionals?.map(p => [p.user_id, p.avatar_url]) || []);

      return caixasData.map(caixa => {
        const profile = profileMap.get(caixa.user_id);
        const profAvatar = profAvatarMap.get(caixa.user_id);
        return {
          ...caixa,
          profile: profile ? {
            ...profile,
            avatar_url: profile.avatar_url || profAvatar || null,
          } : undefined,
        };
      }) as Caixa[];
    },
    enabled: !!salonId,
  });

  const openCaixaMutation = useMutation({
    mutationFn: async (input: CaixaInput) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !salonId) throw new Error("Usuário não autenticado");

      // Check if user has ANY open caixa (regardless of date)
      const { data: existingOpen } = await supabase
        .from("caixas")
        .select("id, opened_at")
        .eq("salon_id", salonId)
        .eq("user_id", user.id)
        .is("closed_at", null)
        .limit(1);

      if (existingOpen && existingOpen.length > 0) {
        const openDate = new Date(existingOpen[0].opened_at);
        const dateStr = openDate.toLocaleDateString("pt-BR");
        throw new Error(`Você já possui um caixa aberto (${dateStr}). Feche-o antes de abrir um novo.`);
      }

      const insertPayload: Record<string, any> = {
        salon_id: salonId,
        user_id: user.id,
        opening_balance: input.opening_balance,
        notes: input.notes,
      };
      if (input.opened_at) insertPayload.opened_at = input.opened_at;

      const { data, error } = await supabase
        .from("caixas")
        .insert(insertPayload)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["caixas", salonId] });
      toast({ title: "Caixa aberto com sucesso" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao abrir caixa", description: error.message, variant: "destructive" });
    },
  });

  const closeCaixaMutation = useMutation({
    mutationFn: async ({ caixaId, closingBalance, notes }: { caixaId: string; closingBalance: number; notes?: string }) => {
      const { data, error } = await supabase
        .from("caixas")
        .update({
          closed_at: new Date().toISOString(),
          closing_balance: closingBalance,
          notes: notes,
        })
        .eq("id", caixaId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["caixas", salonId] });
      toast({ title: "Caixa fechado com sucesso" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao fechar caixa", description: error.message, variant: "destructive" });
    },
  });

  const reopenCaixaMutation = useMutation({
    mutationFn: async (caixaId: string) => {
      const { data, error } = await supabase
        .from("caixas")
        .update({
          closed_at: null,
          closing_balance: null,
        })
        .eq("id", caixaId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["caixas", salonId] });
      toast({ title: "Caixa reaberto com sucesso" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao reabrir caixa", description: error.message, variant: "destructive" });
    },
  });

  const updateCaixaTotalsMutation = useMutation({
    mutationFn: async ({ caixaId, paymentMethod, amount }: { caixaId: string; paymentMethod: string; amount: number }) => {
      const { data: currentCaixa, error: fetchError } = await supabase
        .from("caixas")
        .select("*")
        .eq("id", caixaId)
        .single();

      if (fetchError) throw fetchError;

      const updates: Partial<Caixa> = {};
      switch (paymentMethod) {
        case "cash":
          updates.total_cash = (currentCaixa.total_cash || 0) + amount;
          break;
        case "pix":
          updates.total_pix = (currentCaixa.total_pix || 0) + amount;
          break;
        case "credit_card":
          updates.total_credit_card = (currentCaixa.total_credit_card || 0) + amount;
          break;
        case "debit_card":
          updates.total_debit_card = (currentCaixa.total_debit_card || 0) + amount;
          break;
        case "other":
          updates.total_other = (currentCaixa.total_other || 0) + amount;
          break;
      }

      const { data, error } = await supabase
        .from("caixas")
        .update(updates)
        .eq("id", caixaId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["caixas", salonId] });
    },
  });

  const updateCaixaMutation = useMutation({
    mutationFn: async ({ caixaId, openingBalance, notes }: { caixaId: string; openingBalance?: number; notes?: string }) => {
      const updates: Partial<Caixa> = {};
      if (openingBalance !== undefined) updates.opening_balance = openingBalance;
      if (notes !== undefined) updates.notes = notes;

      const { data, error } = await supabase
        .from("caixas")
        .update(updates)
        .eq("id", caixaId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["caixas", salonId] });
      toast({ title: "Caixa atualizado com sucesso" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao atualizar caixa", description: error.message, variant: "destructive" });
    },
  });

  // Recalculate caixa totals from actual payment records
  const recalculateCaixaTotalsMutation = useMutation({
    mutationFn: async (caixaId: string) => {
      // Get all comandas linked to this caixa
      const { data: comandas, error: comandasError } = await supabase
        .from("comandas")
        .select("id")
        .eq("caixa_id", caixaId);
      if (comandasError) throw comandasError;

      const comandaIds = (comandas || []).map(c => c.id);

      // Sum payments by method from actual payment records
      const totals = { cash: 0, pix: 0, credit_card: 0, debit_card: 0, other: 0 };

      if (comandaIds.length > 0) {
        const { data: payments, error: paymentsError } = await supabase
          .from("payments")
          .select("payment_method, amount")
          .in("comanda_id", comandaIds);
        if (paymentsError) throw paymentsError;

        for (const p of (payments || [])) {
          const method = p.payment_method as keyof typeof totals;
          if (method in totals) {
            totals[method] += Number(p.amount);
          }
        }
      }

      // Update caixa with recalculated totals
      const { data, error } = await supabase
        .from("caixas")
        .update({
          total_cash: totals.cash,
          total_pix: totals.pix,
          total_credit_card: totals.credit_card,
          total_debit_card: totals.debit_card,
          total_other: totals.other,
        })
        .eq("id", caixaId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["caixas", salonId] });
      toast({ title: "Totais do caixa recalculados com sucesso" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao recalcular totais", description: error.message, variant: "destructive" });
    },
  });

  // Get the current user's open caixa (any date — user must close before opening new)
  const getCurrentUserOpenCaixa = async (): Promise<Caixa | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !salonId) return null;

    const { data: caixaData, error } = await supabase
      .from("caixas")
      .select("*")
      .eq("salon_id", salonId)
      .eq("user_id", user.id)
      .is("closed_at", null)
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Error fetching current user caixa:", error);
      return null;
    }

    if (!caixaData) return null;

    // Fetch profile + professional avatar for this user
    const [{ data: profileData }, { data: profData }] = await Promise.all([
      supabase.from("profiles").select("user_id, full_name, avatar_url").eq("user_id", user.id).maybeSingle(),
      supabase.from("professionals").select("avatar_url").eq("user_id", user.id).maybeSingle(),
    ]);

    return {
      ...caixaData,
      profile: profileData ? {
        ...profileData,
        avatar_url: profileData.avatar_url || profData?.avatar_url || null,
      } : undefined,
    } as Caixa;
  };

  // Get open caixas (all users)
  const openCaixas = caixas.filter(c => !c.closed_at);

  // Get closed caixas
  const closedCaixas = caixas.filter(c => c.closed_at);

  // Get caixas by date
  const getCaixasByDate = (date: Date) => {
    return caixas.filter(c => isSameDay(new Date(c.opened_at), date));
  };

  return {
    caixas,
    openCaixas,
    closedCaixas,
    isLoading,
    error,
    openCaixa: openCaixaMutation.mutate,
    openCaixaAsync: openCaixaMutation.mutateAsync,
    closeCaixa: closeCaixaMutation.mutate,
    reopenCaixa: reopenCaixaMutation.mutate,
    updateCaixa: updateCaixaMutation.mutate,
    updateCaixaTotals: updateCaixaTotalsMutation.mutate,
    updateCaixaTotalsAsync: updateCaixaTotalsMutation.mutateAsync,
    recalculateCaixaTotals: recalculateCaixaTotalsMutation.mutate,
    getCurrentUserOpenCaixa,
    getCaixasByDate,
    isOpening: openCaixaMutation.isPending,
    isClosing: closeCaixaMutation.isPending,
    isReopening: reopenCaixaMutation.isPending,
    isUpdating: updateCaixaMutation.isPending,
    isRecalculating: recalculateCaixaTotalsMutation.isPending,
  };
}
