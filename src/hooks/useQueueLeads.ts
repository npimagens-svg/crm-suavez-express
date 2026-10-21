import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { QueueLead, QueueLeadInput } from "@/types/queue";

// Dia de hoje em Brasília (YYYY-MM-DD). Lead vale só no dia de atendimento dele
// (atendimento_em, preenchido no banco): o que não é de hoje some da aba sozinho.
export const hojeSP = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

export function useQueueLeads() {
  const { salonId } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const query = useQuery({
    queryKey: ["queue_leads", salonId],
    queryFn: async () => {
      if (!salonId) return [];
      const { data, error } = await supabase
        .from("queue_leads")
        .select("*")
        .eq("salon_id", salonId)
        .eq("atendimento_em", hojeSP())
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as QueueLead[];
    },
    enabled: !!salonId,
    // atualiza o "há X min" e vira o dia sem recarregar a página
    refetchInterval: 60_000,
  });

  const addLeadMutation = useMutation({
    mutationFn: async (input: QueueLeadInput) => {
      if (!salonId) throw new Error("Salon not found");
      const { data, error } = await supabase
        .from("queue_leads")
        .insert({ salon_id: salonId, name: input.name, phone: input.phone, max_queue_size: input.max_queue_size })
        .select()
        .single();
      if (error) throw error;
      return data as QueueLead;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["queue_leads", salonId] });
    },
  });

  const markNotifiedMutation = useMutation({
    mutationFn: async (leadId: string) => {
      const { error } = await supabase.from("queue_leads").update({ notified: true, notified_at: new Date().toISOString(), notify_result: "manual" }).eq("id", leadId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["queue_leads", salonId] });
      toast({ title: "Cliente avisada!" });
    },
  });

  const deleteLeadMutation = useMutation({
    mutationFn: async (leadId: string) => {
      const { error } = await supabase.from("queue_leads").delete().eq("id", leadId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["queue_leads", salonId] });
    },
  });

  const pendingLeads = (query.data || []).filter((l) => !l.notified);
  // avisadas de hoje: a mais recente primeiro
  const notifiedLeads = (query.data || []).filter((l) => l.notified).reverse();

  return {
    leads: query.data || [],
    pendingLeads,
    notifiedLeads,
    isLoading: query.isLoading,
    addLead: addLeadMutation.mutateAsync,
    markNotified: markNotifiedMutation.mutate,
    deleteLead: deleteLeadMutation.mutate,
  };
}
