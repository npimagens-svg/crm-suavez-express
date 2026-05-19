import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { sendEmail } from "@/lib/sendEmail";

export interface Client {
  id: string;
  salon_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  phone_landline: string | null;
  birth_date: string | null;
  notes: string | null;
  tags: string[];
  gender: string | null;
  cpf: string | null;
  rg: string | null;
  cep: string | null;
  state: string | null;
  city: string | null;
  neighborhood: string | null;
  address: string | null;
  address_number: string | null;
  address_complement: string | null;
  how_met: string | null;
  profession: string | null;
  allow_email_campaigns: boolean;
  allow_sms_campaigns: boolean;
  allow_online_booking: boolean;
  add_cpf_invoice: boolean;
  allow_ai_service: boolean;
  allow_whatsapp_campaigns: boolean;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientInput {
  name: string;
  email?: string;
  phone?: string;
  phone_landline?: string;
  birth_date?: string;
  notes?: string;
  tags?: string[];
  gender?: string;
  cpf?: string;
  rg?: string;
  cep?: string;
  state?: string;
  city?: string;
  neighborhood?: string;
  address?: string;
  address_number?: string;
  address_complement?: string;
  how_met?: string;
  profession?: string;
  allow_email_campaigns?: boolean;
  allow_sms_campaigns?: boolean;
  allow_online_booking?: boolean;
  add_cpf_invoice?: boolean;
  allow_ai_service?: boolean;
  allow_whatsapp_campaigns?: boolean;
  avatar_url?: string | null;
}

export function useClients() {
  const { salonId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["clients", salonId],
    queryFn: async () => {
      if (!salonId) return [];
      // Fetch all clients (Supabase default limit is 1000)
      const allClients: Client[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("clients")
          .select("*")
          .eq("salon_id", salonId)
          .order("name")
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allClients.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }
      return allClients;
    },
    enabled: !!salonId,
  });

  const createMutation = useMutation({
    mutationFn: async (input: ClientInput) => {
      if (!salonId) throw new Error("Salão não encontrado");
      const cleaned: Record<string, any> = { salon_id: salonId };
      for (const [key, value] of Object.entries(input)) {
        // Skip `id` entirely on insert — let the DB default (gen_random_uuid) generate it.
        // Passing id=null/undefined explicitly overrides the default and triggers a NOT NULL violation.
        if (key === "id") continue;
        cleaned[key] = (value === "" || value === undefined) ? null : value;
      }
      const { data, error } = await supabase
        .from("clients")
        .insert(cleaned)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["clients", salonId] });
      toast({ title: "Cliente criado com sucesso!" });
      // Send welcome email
      if (data?.email && salonId) {
        sendEmail({
          type: "welcome",
          salon_id: salonId,
          to_email: data.email,
          to_name: data.name,
          client_id: data.id,
        }).catch(() => {}); // fire-and-forget
      }
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao criar cliente", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...input }: ClientInput & { id: string }) => {
      // Converter strings vazias em null para campos de data (PostgreSQL não aceita "")
      const cleaned: Record<string, any> = {};
      for (const [key, value] of Object.entries(input)) {
        cleaned[key] = (value === "" || value === undefined) ? null : value;
      }
      const { data, error } = await supabase
        .from("clients")
        .update(cleaned)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients", salonId] });
      toast({ title: "Cliente atualizado com sucesso!" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao atualizar cliente", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("clients").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients", salonId] });
      toast({ title: "Cliente removido com sucesso!" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao remover cliente", description: error.message, variant: "destructive" });
    },
  });

  return {
    clients: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    createClient: createMutation.mutate,
    updateClient: updateMutation.mutate,
    deleteClient: deleteMutation.mutate,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
