// @ts-nocheck
import { useState } from "react";
import { BarChart3 } from "lucide-react";
import { AppLayoutNew } from "@/components/layout/AppLayoutNew";
import { useAuth } from "@/contexts/AuthContext";
import { useDailyReports } from "@/hooks/useDailyReports";
import { DailyReportRow } from "@/components/fechamentos/DailyReportRow";
import { DailyReportDetailModal } from "@/components/fechamentos/DailyReportDetailModal";
import { MonthlyReportButton } from "@/components/fechamentos/MonthlyReportButton";
import { ExtratoTab } from "@/components/fechamentos/ExtratoTab";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

interface SelectedReport {
  date: string;
  kpis: any;
}

export default function Fechamentos() {
  const { salonId } = useAuth();
  const { data: reports, isLoading, error } = useDailyReports(salonId);
  const [selected, setSelected] = useState<SelectedReport | null>(null);

  return (
    <AppLayoutNew>
      <div className="container max-w-5xl mx-auto p-4 md:p-6 space-y-6">
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-3">
            <BarChart3 className="h-8 w-8 text-primary shrink-0 mt-1" />
            <div>
              <h1 className="text-2xl font-bold">Fechamentos</h1>
              <p className="text-slate-500 text-sm">
                Relatórios diários consolidados (PagBank + comandas + pendências)
              </p>
            </div>
          </div>
          <MonthlyReportButton salonId={salonId} />
        </header>

        <Tabs defaultValue="diarios" className="space-y-4">
          <TabsList className="grid grid-cols-2 w-full sm:w-[420px]">
            <TabsTrigger value="diarios">Relatórios diários</TabsTrigger>
            <TabsTrigger value="extrato">Extrato bancário</TabsTrigger>
          </TabsList>

          <TabsContent value="diarios" className="space-y-2">
            {isLoading && (
              <div className="p-6 text-center text-slate-500 border rounded">
                Carregando…
              </div>
            )}

            {error && (
              <div className="p-4 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded">
                Erro ao carregar fechamentos:{" "}
                {String((error as any)?.message ?? error)}
              </div>
            )}

            {!isLoading && !error && (reports?.length ?? 0) === 0 && (
              <div className="p-6 text-center text-slate-500 border rounded">
                Nenhum fechamento gerado ainda. Use "Gerar Mensal" ou aguarde o
                cron das 7h.
              </div>
            )}

            <div className="space-y-2">
              {reports?.map((r: any) => (
                <DailyReportRow
                  key={r.id}
                  reportDate={r.report_date}
                  kpis={r.kpis}
                  issuesCount={(r.kpis as any)?._issues_count}
                  onClick={() =>
                    setSelected({ date: r.report_date, kpis: r.kpis })
                  }
                />
              ))}
            </div>
          </TabsContent>

          <TabsContent value="extrato">
            <ExtratoTab />
          </TabsContent>
        </Tabs>

        {selected && (
          <DailyReportDetailModal
            open
            onClose={() => setSelected(null)}
            reportDate={selected.date}
            kpis={selected.kpis}
          />
        )}
      </div>
    </AppLayoutNew>
  );
}
