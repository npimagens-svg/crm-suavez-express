// @ts-nocheck
import { Button } from "@/components/ui/button";
import { useResolveIssue } from "@/hooks/useClosureIssues";

const SEVERITY_COLOR: Record<string, string> = {
  high: "bg-rose-100 text-rose-900 border-rose-200",
  medium: "bg-amber-100 text-amber-900 border-amber-200",
  low: "bg-sky-100 text-sky-900 border-sky-200",
};

const SEVERITY_EMOJI: Record<string, string> = {
  high: "🔴",
  medium: "🟡",
  low: "🔵",
};

interface Props {
  issue: any;
  onRequestCorrection: () => void;
}

export function IssueCard({ issue, onRequestCorrection }: Props) {
  const resolve = useResolveIssue();
  const profName = issue.professionals?.name ?? "—";
  const comandaNum = issue.comandas?.comanda_number ?? null;
  const clientName = issue.comandas?.clients?.name ?? null;
  const severity = (issue.severity ?? "low") as keyof typeof SEVERITY_COLOR;

  return (
    <div
      className={`p-4 rounded border ${
        SEVERITY_COLOR[severity] ?? SEVERITY_COLOR.low
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="text-xl" aria-hidden="true">
          {SEVERITY_EMOJI[severity] ?? SEVERITY_EMOJI.low}
        </span>
        <div className="flex-1">
          <div className="text-sm text-slate-600">
            {issue.detected_date}
            {comandaNum != null && ` · Comanda #${comandaNum}`}
            {clientName && ` · ${clientName}`}
          </div>
          <div className="font-medium mt-1">{issue.description}</div>
          {(issue.expected_value != null || issue.actual_value != null) && (
            <details className="text-xs mt-2 opacity-80">
              <summary className="cursor-pointer">Detalhes</summary>
              <pre className="mt-1 whitespace-pre-wrap break-all">
                {JSON.stringify(
                  {
                    esperado: issue.expected_value,
                    atual: issue.actual_value,
                  },
                  null,
                  2
                )}
              </pre>
            </details>
          )}
          <div className="text-sm mt-2">
            Profissional: <strong>{profName}</strong>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        <Button
          size="sm"
          onClick={onRequestCorrection}
          disabled={resolve.isPending}
        >
          💬 Solicitar correção
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={resolve.isPending}
          onClick={() =>
            resolve.mutate({ id: issue.id, action: "marked_resolved" })
          }
        >
          ✅ Marcar resolvido
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={resolve.isPending}
          onClick={() => {
            const reason = window.prompt("Motivo (opcional):") ?? "";
            resolve.mutate({ id: issue.id, action: "ignored", reason });
          }}
        >
          🚫 Ignorar
        </Button>
      </div>
    </div>
  );
}
