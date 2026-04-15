import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { QueueEntry, QueueEntryInput, QueueStats } from "@/types/queue";

export function useQueue() {
  const { salonId } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const query = useQuery({
    queryKey: ["queue", salonId],
    queryFn: async () => {
      if (!salonId) return [];
      const { data, error } = await supabase
        .from("queue_entries")
        .select(`
          *,
          service:services(id, name, price, duration_minutes),
          professional:professionals(id, name)
        `)
        .eq("salon_id", salonId)
        .in("status", ["waiting", "checked_in", "in_service"])
        .order("position", { ascending: true });

      if (error) throw error;
      return data as QueueEntry[];
    },
    enabled: !!salonId,
  });

  const getNextPosition = async (): Promise<number> => {
    if (!salonId) return 1;
    const { data } = await supabase
      .from("queue_entries")
      .select("position")
      .eq("salon_id", salonId)
      .in("status", ["waiting", "checked_in", "in_service"])
      .order("position", { ascending: false })
      .limit(1);

    return (data && data.length > 0) ? data[0].position + 1 : 1;
  };

  const addToQueueMutation = useMutation({
    mutationFn: async (input: QueueEntryInput) => {
      if (!salonId) throw new Error("Salon not found");
      const position = await getNextPosition();

      const { data, error } = await supabase
        .from("queue_entries")
        .insert({
          salon_id: salonId,
          customer_name: input.customer_name,
          customer_phone: input.customer_phone,
          customer_email: input.customer_email || null,
          service_id: input.service_id,
          source: input.source,
          position,
          notify_minutes_before: input.notify_minutes_before || 40,
          payment_id: input.payment_id || null,
          payment_status: input.source === "walk_in" ? "confirmed" : "pending",
          status: input.source === "walk_in" ? "checked_in" : "waiting",
          checked_in_at: input.source === "walk_in" ? new Date().toISOString() : null,
        })
        .select(`
          *,
          service:services(id, name, price, duration_minutes)
        `)
        .single();

      if (error) throw error;
      return data as QueueEntry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["queue", salonId] });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao adicionar na fila", description: error.message, variant: "destructive" });
    },
  });

  const checkInMutation = useMutation({
    mutationFn: async (entryId: string) => {
      const { error } = await supabase
        .from("queue_entries")
        .update({ status: "checked_in", checked_in_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", entryId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["queue", salonId] });
      toast({ title: "Check-in realizado!" });
    },
  });

  const assignProfessionalMutation = useMutation({
    mutationFn: async ({ entryId, professionalId }: { entryId: string; professionalId: string }) => {
      const { error } = await supabase
        .from("queue_entries")
        .update({ assigned_professional_id: professionalId, status: "in_service", updated_at: new Date().toISOString() })
        .eq("id", entryId);
      if (error) throw error;
      return { entryId, professionalId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["queue", salonId] });
      toast({ title: "Profissional atribuído!" });
    },
  });

  const completeMutation = useMutation({
    mutationFn: async (entryId: string) => {
      const { error } = await supabase
        .from("queue_entries")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .eq("id", entryId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["queue", salonId] });
    },
  });

  const skipMutation = useMutation({
    mutationFn: async (entryId: string) => {
      const nextPos = await getNextPosition();
      const { error } = await supabase
        .from("queue_entries")
        .update({ position: nextPos, updated_at: new Date().toISOString() })
        .eq("id", entryId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["queue", salonId] });
      toast({ title: "Cliente pulada na fila" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (entryId: string) => {
      const { data: entry } = await supabase
        .from("queue_entries")
        .select("*, service:services(price)")
        .eq("id", entryId)
        .single();

      if (!entry) throw new Error("Entrada não encontrada");

      if (entry.source === "online" && entry.payment_status === "confirmed") {
        const { data: settings } = await supabase
          .from("queue_settings")
          .select("credit_validity_days")
          .eq("salon_id", salonId)
          .single();

        const validityDays = settings?.credit_validity_days || 30;
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + validityDays);

        await supabase.from("customer_credits").insert({
          salon_id: salonId,
          customer_id: entry.customer_id,
          customer_phone: entry.customer_phone,
          amount: entry.service?.price || 0,
          origin_queue_entry_id: entryId,
          expires_at: expiresAt.toISOString(),
        });
      }

      const newStatus = entry.source === "online" ? "no_show" : "cancelled";
      const { error } = await supabase
        .from("queue_entries")
        .update({
          status: newStatus,
          payment_status: entry.source === "online" ? "credit" : entry.payment_status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", entryId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["queue", salonId] });
      toast({ title: "Cliente removida da fila" });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      const updates = orderedIds.map((id, index) =>
        supabase.from("queue_entries").update({ position: index + 1, updated_at: new Date().toISOString() }).eq("id", id)
      );
      await Promise.all(updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["queue", salonId] });
    },
  });

  const entries = query.data || [];
  const activeEntries = entries.filter((e) => ["waiting", "checked_in"].includes(e.status));
  const inServiceCount = entries.filter((e) => e.status === "in_service").length;
  const totalMinutes = activeEntries.reduce((sum, e) => sum + (e.service?.duration_minutes || 45), 0);
  const activeProfessionals = Math.max(inServiceCount, 1);
  const estimatedMinutes = Math.ceil(totalMinutes / activeProfessionals);

  const stats: QueueStats = {
    totalInQueue: activeEntries.length,
    inflatedCount: 0,
    estimatedMinutes,
    activeProfessionals,
  };

  return {
    entries,
    activeEntries,
    stats,
    isLoading: query.isLoading,
    addToQueue: addToQueueMutation.mutateAsync,
    isAdding: addToQueueMutation.isPending,
    checkIn: checkInMutation.mutate,
    assignProfessional: assignProfessionalMutation.mutateAsync,
    complete: completeMutation.mutate,
    skip: skipMutation.mutate,
    remove: removeMutation.mutate,
    reorder: reorderMutation.mutate,
  };
}
