// @ts-nocheck
import { useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useGenerateReport } from "@/hooks/useDailyReports";
import { useProfessionals } from "@/hooks/useProfessionals";
import { generateMonthlyPdf } from "./monthlyReportPdf";

interface MonthlyReportButtonProps {
  salonId: string | null;
  salonName?: string;
}

const MONTHS_PT = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export function MonthlyReportButton({
  salonId,
  salonName = "NP Hair Express",
}: MonthlyReportButtonProps) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [profId, setProfId] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);

  const { data: professionalsList } = useProfessionals();
  const professionals = Array.isArray(professionalsList) ? professionalsList : [];
  const generate = useGenerateReport();

  const handleGenerate = async () => {
    setError(null);
    try {
      const mm = String(month).padStart(2, "0");
      const start = `${year}-${mm}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const end = `${year}-${mm}-${String(lastDay).padStart(2, "0")}`;

      const result = await generate.mutateAsync({
        start,
        end,
        professional_id: profId === "all" ? undefined : profId,
      });

      const professionalName =
        profId === "all"
          ? null
          : professionals.find((p: any) => p.id === profId)?.name ?? "";

      generateMonthlyPdf({
        salon: salonName,
        period: { start, end },
        professional: professionalName,
        kpis: result?.kpis ?? {},
        issues: result?.issues ?? [],
      });

      setOpen(false);
    } catch (err: any) {
      console.error("[MonthlyReportButton] generate failed:", err);
      setError(err?.message ?? "Falha ao gerar relatório.");
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={!salonId}>
        <FileText className="h-4 w-4 mr-2" />
        Gerar Mensal
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Fechamento Mensal</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">Mês</label>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="border rounded p-2 w-full bg-white"
              >
                {MONTHS_PT.map((label, idx) => (
                  <option key={idx + 1} value={idx + 1}>
                    {String(idx + 1).padStart(2, "0")} — {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Ano</label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                min={2020}
                max={2099}
                className="border rounded p-2 w-full"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Profissional
              </label>
              <select
                value={profId}
                onChange={(e) => setProfId(e.target.value)}
                className="border rounded p-2 w-full bg-white"
              >
                <option value="all">Todos</option>
                {professionals.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {error && (
              <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
                {error}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleGenerate}
              disabled={generate.isPending || !salonId}
            >
              {generate.isPending ? "Gerando..." : "Gerar PDF"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
