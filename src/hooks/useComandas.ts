import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export interface ComandaPayment {
  id: string;
  payment_method: string;
  amount: number;
  fee_amount: number | null;
  net_amount: number | null;
  card_brand_id: string | null;
}

export interface Comanda {
  id: string;
  salon_id: string;
  client_id: string | null;
  professional_id: string | null;
  appointment_id: string | null;
  caixa_id: string | null;
  comanda_number: number | null;
  subtotal: number;
  discount: number;
  total: number;
  is_paid: boolean;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  client?: {
    id: string;
    name: string;
  };
  professional?: {
    id: string;
    name: string;
  };
  items?: ComandaItem[];
  payments?: ComandaPayment[];
}

export interface ComandaItem {
  id: string;
  comanda_id: string;
  service_id: string | null;
  product_id: string | null;
  professional_id: string | null;
  description: string;
  item_type: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  product_cost: number;
  created_at: string;
  professional?: {
    id: string;
    name: string;
  };
}

export interface ComandaInput {
  client_id?: string | null;
  professional_id?: string | null;
  appointment_id?: string | null;
  caixa_id?: string | null;
  discount?: number;
}

export interface ComandaItemInput {
  comanda_id: string;
  service_id?: string | null;
  product_id?: string | null;
  professional_id?: string | null;
  description: string;
  item_type: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  product_cost?: number;
}

export interface ComandasRange {
  from?: Date;
  to?: Date;
}

export function useComandas(range?: ComandasRange) {
  const { salonId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Período server-side (falha 20): sem teto fixo de 90 dias. Default = mês
  // corrente; telas de comissão/histórico passam o intervalo desejado.
  const fromDate = range?.from
    ? new Date(range.from)
    : (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })();
  const toDate = range?.to ?? null;

  const query = useQuery({
    queryKey: ["comandas", salonId, fromDate.toISOString(), toDate?.toISOString() ?? "open"],
    queryFn: async () => {
      if (!salonId) return [];

      let q = supabase
        .from("comandas")
        .select(`
          *,
          client:clients(id, name),
          professional:professionals(id, name),
          items:comanda_items(
            id,
            description,
            item_type,
            quantity,
            unit_price,
            total_price,
            service_id,
            product_id,
            professional_id,
            product_cost,
            professional:professionals(id, name)
          ),
          payments(
            id,
            payment_method,
            amount,
            fee_amount,
            net_amount,
            card_brand_id
          )
        `)
        .eq("salon_id", salonId)
        .gte("created_at", fromDate.toISOString());
      if (toDate) q = q.lte("created_at", toDate.toISOString());

      const { data, error } = await q.order("created_at", { ascending: false });
      if (error) throw error;
      return data as Comanda[];
    },
    enabled: !!salonId,
  });

  const createMutation = useMutation({
    mutationFn: async (input: ComandaInput) => {
      if (!salonId) throw new Error("Salão não encontrado");
      const { data, error } = await supabase
        .from("comandas")
        .insert({ ...input, salon_id: salonId })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comandas", salonId] });
      toast({ title: "Comanda criada com sucesso!" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao criar comanda", description: error.message, variant: "destructive" });
    },
  });

  // Find or create a comanda for a client on a specific date (defaults to today)
  const findOrCreateTodayComanda = async (clientId: string, professionalId?: string | null, appointmentId?: string | null, targetDate?: Date) => {
    if (!salonId) throw new Error("Salão não encontrado");

    // Use targetDate or default to today
    const today = targetDate ? new Date(targetDate) : new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Look for an existing open comanda for this client today
    const { data: existingComanda, error: findError } = await supabase
      .from("comandas")
      .select(`
        *,
        client:clients(id, name),
        professional:professionals(id, name)
      `)
      .eq("salon_id", salonId)
      .eq("client_id", clientId)
      .is("closed_at", null)
      .gte("created_at", today.toISOString())
      .lt("created_at", tomorrow.toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findError) throw findError;

    if (existingComanda) {
      return existingComanda as Comanda;
    }

    // No existing comanda, create a new one (use targetDate if provided)
    const insertData: any = {
      salon_id: salonId,
      client_id: clientId,
      professional_id: professionalId || null,
      appointment_id: appointmentId || null,
    };
    if (targetDate) {
      // Set created_at to match the target date (noon to avoid timezone issues)
      const d = new Date(targetDate);
      d.setHours(12, 0, 0, 0);
      insertData.created_at = d.toISOString();
    }
    const { data: newComanda, error: createError } = await supabase
      .from("comandas")
      .insert(insertData)
      .select(`
        *,
        client:clients(id, name),
        professional:professionals(id, name)
      `)
      .single();

    if (createError) throw createError;
    
    queryClient.invalidateQueries({ queryKey: ["comandas", salonId] });
    toast({ title: "Comanda criada com sucesso!" });
    
    return newComanda as Comanda;
  };

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...input }: ComandaInput & { id: string }) => {
      const { data, error } = await supabase
        .from("comandas")
        .update(input)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comandas", salonId] });
      toast({ title: "Comanda atualizada com sucesso!" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao atualizar comanda", description: error.message, variant: "destructive" });
    },
  });

  const triggerNextInQueue = async (professionalId: string | null) => {
    if (!professionalId || !salonId) return;

    try {
      await supabase.functions.invoke("queue-next", {
        body: { salonId, professionalId },
      });
    } catch (err) {
      console.error("Error triggering next in queue:", err);
    }
  };

  const closeComandaMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("comandas")
        .update({ closed_at: new Date().toISOString(), is_paid: true })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["comandas", salonId] });
      toast({ title: "Comanda fechada com sucesso!" });
      triggerNextInQueue(data?.professional_id ?? null);
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao fechar comanda", description: error.message, variant: "destructive" });
    },
  });

  // Reabertura via RPC transacional (falha 17): NÃO apaga pagamentos.
  // Pagamentos manuais viram "void" auditável (estorno registrado em
  // caixa_movements); pagamentos de PROVEDOR ONLINE (Asaas) são preservados.
  const reopenComandaMutation = useMutation({
    mutationFn: async ({ comandaId, reason }: { comandaId: string; caixaId?: string; reason?: string }) => {
      const { data, error } = await supabase.rpc("rpc_reabrir_comanda", {
        p_comanda: comandaId,
        p_reason: reason ?? null,
      });
      if (error) throw error;
      return data as { ok?: boolean; voided_payments?: number; kept_provider_payments?: number };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["comandas", salonId] });
      queryClient.invalidateQueries({ queryKey: ["caixas", salonId] });
      const kept = data?.kept_provider_payments ?? 0;
      toast({
        title: "Comanda reaberta com sucesso!",
        description: kept > 0
          ? `Pagamentos manuais estornados. ${kept} pagamento(s) online preservado(s).`
          : "Pagamentos manuais estornados do caixa (auditado).",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao reabrir comanda", description: error.message, variant: "destructive" });
    },
  });

  return {
    comandas: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    createComanda: createMutation.mutate,
    createComandaAsync: createMutation.mutateAsync,
    updateComanda: updateMutation.mutate,
    closeComanda: closeComandaMutation.mutate,
    reopenComanda: reopenComandaMutation.mutateAsync,
    findOrCreateTodayComanda,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isClosing: closeComandaMutation.isPending,
    isReopening: reopenComandaMutation.isPending,
  };
}

export function useClientComandas(clientId: string | null) {
  const { salonId } = useAuth();

  const query = useQuery({
    queryKey: ["client_comandas", clientId, salonId],
    queryFn: async () => {
      if (!clientId || !salonId) return [];
      const { data, error } = await supabase
        .from("comandas")
        .select(`
          *,
          professional:professionals(id, name),
          items:comanda_items(
            id,
            description,
            item_type,
            quantity,
            unit_price,
            total_price,
            service_id,
            product_id
          ),
          payments(
            id,
            payment_method,
            amount,
            fee_amount,
            net_amount
          )
        `)
        .eq("salon_id", salonId)
        .eq("client_id", clientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!clientId && !!salonId,
  });

  return {
    comandas: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}

export function useComandaItems(comandaId: string | null) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["comanda_items", comandaId],
    queryFn: async () => {
      if (!comandaId) return [];
      const { data, error } = await supabase
        .from("comanda_items")
        .select(`
          *,
          professional:professionals(id, name)
        `)
        .eq("comanda_id", comandaId)
        .order("created_at");
      if (error) throw error;
      return data as ComandaItem[];
    },
    enabled: !!comandaId,
  });

  const addItemMutation = useMutation({
    mutationFn: async (input: ComandaItemInput) => {
      // Insert the item
      const { data, error } = await supabase
        .from("comanda_items")
        .insert(input)
        .select()
        .single();
      if (error) throw error;

      // Update comanda totals
      const { data: allItems } = await supabase
        .from("comanda_items")
        .select("total_price")
        .eq("comanda_id", input.comanda_id);
      
      if (allItems) {
        const newSubtotal = allItems.reduce((acc, item) => acc + Number(item.total_price), 0);
        await supabase
          .from("comandas")
          .update({
            subtotal: newSubtotal,
            total: newSubtotal, // Will subtract discount if exists
          })
          .eq("id", input.comanda_id);
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comanda_items", comandaId] });
      queryClient.invalidateQueries({ queryKey: ["comandas"] });
      toast({ title: "Item adicionado!" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao adicionar item", description: error.message, variant: "destructive" });
    },
  });

  const removeItemMutation = useMutation({
    mutationFn: async ({ itemId, comandaId: cId }: { itemId: string; comandaId: string }) => {
      // Get item to be removed
      const { data: itemToRemove } = await supabase
        .from("comanda_items")
        .select("total_price")
        .eq("id", itemId)
        .single();

      // Delete the item
      const { error } = await supabase.from("comanda_items").delete().eq("id", itemId);
      if (error) throw error;

      // Update comanda totals
      const { data: remainingItems } = await supabase
        .from("comanda_items")
        .select("total_price")
        .eq("comanda_id", cId);
      
      const newSubtotal = remainingItems?.reduce((acc, item) => acc + Number(item.total_price), 0) || 0;
      await supabase
        .from("comandas")
        .update({
          subtotal: newSubtotal,
          total: newSubtotal,
        })
        .eq("id", cId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comanda_items", comandaId] });
      queryClient.invalidateQueries({ queryKey: ["comandas"] });
      toast({ title: "Item removido!" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao remover item", description: error.message, variant: "destructive" });
    },
  });

  return {
    items: query.data ?? [],
    isLoading: query.isLoading,
    addItem: addItemMutation.mutate,
    removeItem: (itemId: string) => removeItemMutation.mutate({ itemId, comandaId: comandaId! }),
    isAdding: addItemMutation.isPending,
    isRemoving: removeItemMutation.isPending,
  };
}
