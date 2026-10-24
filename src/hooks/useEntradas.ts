// @ts-nocheck
// types.ts do Supabase está defasado (payments sem voided/payment_provider, comandas sem source/comanda_number);
// os tipos de domínio ficam em src/lib/entradas.ts.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  CATEGORIA_CLUBE,
  limitesPeriodo,
  montarEntradas,
  type Entrada,
  type PaymentRow,
  type TransactionRow,
} from "@/lib/entradas";

export interface EntradaInput {
  transaction_date: string;
  amount: number;
  description: string;
  category: string;
}

const PAGE = 1000; // limite de linhas por resposta do PostgREST

async function buscarPayments(salonId: string, from: string, to: string): Promise<PaymentRow[]> {
  const { inicio, fim } = limitesPeriodo(from, to);
  const linhas: PaymentRow[] = [];
  for (let i = 0; ; i += PAGE) {
    const { data, error } = await supabase
      .from("payments")
      .select(
        "id, amount, payment_method, payment_provider, voided, created_at, fee_amount, net_amount, pagbank_nsu, " +
          "comandas!inner(is_paid, source, comanda_number, client:clients(name), professional:professionals(name))"
      )
      .eq("salon_id", salonId)
      .eq("voided", false)
      .eq("comandas.is_paid", true)
      .gte("created_at", inicio)
      .lte("created_at", fim)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(i, i + PAGE - 1);
    if (error) throw error;
    linhas.push(...((data ?? []) as PaymentRow[]));
    if (!data || data.length < PAGE) break;
  }
  return linhas;
}

async function buscarTransacoes(salonId: string, from: string, to: string): Promise<TransactionRow[]> {
  const linhas: TransactionRow[] = [];
  for (let i = 0; ; i += PAGE) {
    const { data, error } = await supabase
      .from("financial_transactions")
      .select("id, salon_id, transaction_type, amount, description, category, payment_id, transaction_date, created_at")
      .eq("salon_id", salonId)
      .eq("transaction_type", "income")
      .is("payment_id", null)
      .gte("transaction_date", from)
      .lte("transaction_date", to)
      .order("transaction_date", { ascending: false })
      .order("id", { ascending: true })
      .range(i, i + PAGE - 1);
    if (error) throw error;
    linhas.push(...((data ?? []) as TransactionRow[]));
    if (!data || data.length < PAGE) break;
  }
  return linhas;
}

export function useEntradas({ from, to }: { from: string; to: string }) {
  const { salonId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const queryKey = ["entradas", salonId, from, to];

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<Entrada[]> => {
      if (!salonId) return [];
      const [payments, transacoes] = await Promise.all([
        buscarPayments(salonId, from, to),
        buscarTransacoes(salonId, from, to),
      ]);
      return montarEntradas(payments, transacoes);
    },
    enabled: !!salonId && !!from && !!to,
  });

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["entradas", salonId] });
    queryClient.invalidateQueries({ queryKey: ["financial_transactions"] });
  };

  const createMutation = useMutation({
    mutationFn: async (input: EntradaInput) => {
      if (!salonId) throw new Error("salão não identificado");
      if (input.category === CATEGORIA_CLUBE) throw new Error("Categoria reservada ao Clube da Escova");
      const { data, error } = await supabase
        .from("financial_transactions")
        .insert({ ...input, transaction_type: "income", salon_id: salonId })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidar();
      toast({ title: "Entrada lançada" });
    },
    onError: (err: Error) => toast({ title: "Erro ao lançar entrada", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...patch }: EntradaInput & { id: string }) => {
      if (patch.category === CATEGORIA_CLUBE) throw new Error("Categoria reservada ao Clube da Escova");
      // Só mexe em lançamento manual: income, fora do Clube e sem payment ligado
      const { data, error } = await supabase
        .from("financial_transactions")
        .update(patch)
        .eq("id", id)
        .eq("salon_id", salonId)
        .eq("transaction_type", "income")
        .or(`category.is.null,category.neq."${CATEGORIA_CLUBE}"`)
        .is("payment_id", null)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidar();
      toast({ title: "Entrada atualizada" });
    },
    onError: (err: Error) => toast({ title: "Erro ao atualizar", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("financial_transactions")
        .delete()
        .eq("id", id)
        .eq("salon_id", salonId)
        .eq("transaction_type", "income")
        .or(`category.is.null,category.neq."${CATEGORIA_CLUBE}"`)
        .is("payment_id", null);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidar();
      toast({ title: "Entrada excluída" });
    },
    onError: (err: Error) => toast({ title: "Erro ao excluir", description: err.message, variant: "destructive" }),
  });

  return {
    entradas: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error as Error | null,
    createEntrada: createMutation.mutate,
    updateEntrada: updateMutation.mutate,
    deleteEntrada: deleteMutation.mutate,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
  };
}
