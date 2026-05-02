import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export interface Service {
  id: string;
  salon_id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price: number;
  commission_percent: number | null;
  category: string | null;
  is_active: boolean;
  queue_enabled: boolean;
  send_return_reminder: boolean;
  return_reminder_days: number | null;
  return_reminder_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServiceInput {
  name: string;
  description?: string;
  duration_minutes: number;
  price: number;
  commission_percent?: number;
  category?: string;
  is_active?: boolean;
  queue_enabled?: boolean;
  send_return_reminder?: boolean;
  return_reminder_days?: number;
  return_reminder_message?: string;
}

export function useServices() {
  const { salonId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["services", salonId],
    queryFn: async () => {
      if (!salonId) return [];
      const { data, error } = await supabase
        .from("services")
        .select("*")
        .eq("salon_id", salonId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as Service[];
    },
    enabled: !!salonId,
  });

  const createMutation = useMutation({
    mutationFn: async (input: ServiceInput) => {
      if (!salonId) throw new Error("Salão não encontrado");
      const { data, error } = await supabase
        .from("services")
        .insert({ ...input, salon_id: salonId })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services", salonId] });
      toast({ title: "Serviço criado com sucesso!" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao criar serviço", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...input }: ServiceInput & { id: string }) => {
      const { data, error } = await supabase
        .from("services")
        .update(input)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services", salonId] });
      toast({ title: "Serviço atualizado com sucesso!" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao atualizar serviço", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Try hard delete first (works for services with no history)
      const { error: deleteError } = await supabase.from("services").delete().eq("id", id);
      if (!deleteError) return { archived: false };

      // Fallback to soft delete if FK constraint blocks (service has history)
      const isFkError = deleteError.code === "23503" || /foreign key|violates/i.test(deleteError.message);
      if (!isFkError) throw deleteError;

      const { error: updateError } = await supabase
        .from("services")
        .update({ is_active: false })
        .eq("id", id);
      if (updateError) throw updateError;
      return { archived: true };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["services", salonId] });
      toast({
        title: result?.archived ? "Serviço arquivado" : "Serviço removido com sucesso!",
        description: result?.archived
          ? "O serviço tem histórico vinculado (fila/comandas) e foi ocultado da lista. O histórico foi preservado."
          : undefined,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao remover serviço", description: error.message, variant: "destructive" });
    },
  });

  return {
    services: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    createService: createMutation.mutate,
    updateService: updateMutation.mutate,
    deleteService: deleteMutation.mutate,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
