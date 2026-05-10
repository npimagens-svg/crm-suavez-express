import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

interface DailyReportRowProps {
  reportDate: string;
  kpis: any;
  issuesCount?: number;
  onClick: () => void;
}

const fmt = (n: number) =>
  `R$ ${Number(n ?? 0)
    .toFixed(2)
    .replace(".", ",")}`;

export function DailyReportRow({
  reportDate,
  kpis,
  issuesCount,
  onClick,
}: DailyReportRowProps) {
  const date = parseISO(reportDate);
  const weekday = format(date, "EEE", { locale: ptBR });
  const day = format(date, "dd/MM");
  const hasIssues = (issuesCount ?? 0) > 0;

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between px-4 py-3 rounded border bg-white hover:bg-slate-50 transition text-left"
    >
      <div className="flex items-center gap-3">
        {hasIssues ? (
          <AlertTriangle className="text-amber-500 shrink-0" size={18} />
        ) : (
          <CheckCircle2 className="text-emerald-600 shrink-0" size={18} />
        )}
        <div>
          <div className="font-medium">
            {day} <span className="text-slate-500 font-normal">{weekday}</span>
          </div>
          <div className="text-sm text-slate-500">
            {kpis?.bookings?.count ?? 0} atend · ticket{" "}
            {fmt(kpis?.bookings?.average_ticket ?? 0)}
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="font-semibold">{fmt(kpis?.revenue?.gross ?? 0)}</div>
        {hasIssues && (
          <div className="text-xs text-amber-700">
            {issuesCount} alerta{(issuesCount ?? 0) > 1 ? "s" : ""}
          </div>
        )}
      </div>
    </button>
  );
}
