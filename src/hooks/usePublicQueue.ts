import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/dynamicSupabaseClient";
import type { QueueStats } from "@/types/queue";
import type { Painel } from "@/lib/filaPrevisao";

// Hook público da fila — SEM acesso direto a tabelas (falhas 1/2 corrigidas).
// Tudo vem da RPC fila_public_bootstrap: salão, config não sensível, serviços
// habilitados e stats agregadas (zero PII, zero segredo, zero select("*")).

export interface PublicService {
  id: string;
  name: string;
  price: number;
  duration_minutes: number | null;
  category: string | null;
  description: string | null;
}

export interface FilaAbertura {
  aberta: boolean;
  motivo: "pausada" | "fechado_hoje" | "ainda_nao_abriu" | "ja_fechou" | null;
  abre: string | null;
  fecha: string | null;
  proxima_abertura: string | null;
}

interface PublicBootstrap {
  salon_id: string | null;
  settings: {
    inflation_factor: number;
    credit_validity_days: number;
    notify_options: number[];
  } | null;
  fila: FilaAbertura | null;
  services: PublicService[];
  stats: {
    total_in_queue: number;
    estimated_minutes: number;
    active_professionals: number;
  } | null;
}

export function usePublicQueue() {
  const bootstrapQuery = useQuery({
    queryKey: ["fila_public_bootstrap"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fila_public_bootstrap");
      if (error) throw error;
      return data as unknown as PublicBootstrap;
    },
    refetchInterval: 15000,
  });

  // Tudo que está no salão agora (comandas abertas + online sem comanda), anônimo.
  const painelQuery = useQuery({
    queryKey: ["fila_public_painel"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fila_public_painel");
      if (error) throw error;
      return data as unknown as Painel;
    },
    refetchInterval: 15000,
  });

  const boot = bootstrapQuery.data;
  const salonId = boot?.salon_id ?? null;

  const stats: QueueStats = {
    totalInQueue: boot?.stats?.total_in_queue ?? 0,
    inflatedCount: 0,
    estimatedMinutes: boot?.stats?.estimated_minutes ?? 0,
    activeProfessionals: boot?.stats?.active_professionals ?? 1,
  };

  const settings = boot?.settings ?? {
    inflation_factor: 1.7,
    credit_validity_days: 30,
    notify_options: [20, 40, 60, 90],
  };

  const addLead = async (input: { name: string; phone: string; max_queue_size: number }) => {
    if (!salonId) throw new Error("Salon not found");
    const { error } = await supabase
      .from("queue_leads")
      .insert({ salon_id: salonId, ...input });
    if (error) throw error;
  };

  // Sem resposta do servidor a fila NÃO é bloqueada — a trava existe pra impedir
  // venda com a casa fechada, não pra derrubar a venda quando a RPC falha.
  const fila: FilaAbertura = boot?.fila ?? {
    aberta: true, motivo: null, abre: null, fecha: null, proxima_abertura: null,
  };

  return {
    salonId,
    settings,
    fila,
    stats,
    services: boot?.services ?? [],
    painel: painelQuery.data ?? null,
    isLoading: bootstrapQuery.isLoading,
    addLead,
  };
}
