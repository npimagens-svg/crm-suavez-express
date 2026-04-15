import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { QueueLead, QueueLeadInput } from "@/types/queue";

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
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as QueueLead[];
    },
    enabled: !!salonId,
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
      const { error } = await supabase.from("queue_leads").update({ notified: true }).eq("id", leadId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["queue_leads", salonId] });
      toast({ title: "Lead notificada!" });
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
  const notifiedLeads = (query.data || []).filter((l) => l.notified);

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
