// @ts-nocheck
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/dynamicSupabaseClient";

export interface PagBankTransaction {
  meio_pagamento: number;
  arranjo_ur: string;
  valor_total_transacao: number;
  valor_liquido_transacao: number;
  taxa_intermediacao: number;
  data_prevista_pagamento: string;
  quantidade_parcelas: number;
}

export interface AsaasPayment {
  id: string;
  status: string;
  billingType: string;
  value: number;
  netValue: number;
  customer?: string;
  dateCreated: string;
  confirmedDate?: string;
  paymentDate?: string;
  description?: string;
}

export interface ExtratoData {
  pagbank: PagBankTransaction[];
  asaas: AsaasPayment[];
}

/**
 * useExtrato — chama a Edge Function `daily-report` em range mode e devolve
 * as transações brutas de PagBank + Asaas. Usado pela aba Extrato bancário
 * em /fechamentos.
 */
export function useExtrato(salonId: string | null, from: string, to: string) {
  return useQuery<ExtratoData>({
    queryKey: ["extrato", salonId, from, to],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("daily-report", {
        body: { start: from, end: to },
      });
      if (error) throw error;
      return (data?.transactions ?? { pagbank: [], asaas: [] }) as ExtratoData;
    },
    enabled: !!salonId && !!from && !!to,
    staleTime: 60_000,
  });
}
