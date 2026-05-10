// @ts-nocheck
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/dynamicSupabaseClient";

/**
 * useDailyReports — lista fechamentos diários persistidos em `daily_reports`.
 *
 * @param salonId salon atual (vem de useAuth().salonId)
 * @param opts.from filtro inicial (YYYY-MM-DD)
 * @param opts.to   filtro final  (YYYY-MM-DD)
 */
export function useDailyReports(
  salonId: string | null,
  opts?: { from?: string; to?: string }
) {
  return useQuery({
    queryKey: ["daily-reports", salonId, opts?.from, opts?.to],
    queryFn: async () => {
      if (!salonId) return [];
      let q = supabase
        .from("daily_reports")
        .select("id, report_date, kpis, generated_at")
        .eq("salon_id", salonId)
        .order("report_date", { ascending: false });
      if (opts?.from) q = q.gte("report_date", opts.from);
      if (opts?.to) q = q.lte("report_date", opts.to);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!salonId,
  });
}

export interface GenerateReportInput {
  date?: string;
  start?: string;
  end?: string;
  professional_id?: string;
}

/**
 * useGenerateReport — invoca a Edge Function `daily-report` (ad-hoc ou range).
 * Invalida queries de `daily-reports` e `closure-issues` no sucesso.
 */
export function useGenerateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: GenerateReportInput) => {
      const { data, error } = await supabase.functions.invoke("daily-report", {
        body: input,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["daily-reports"] });
      qc.invalidateQueries({ queryKey: ["closure-issues"] });
    },
  });
}
