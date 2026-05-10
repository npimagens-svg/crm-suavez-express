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

// Labels humanos pra campos técnicos vindos do detector
const FIELD_LABELS: Record<string, string> = {
  method: "Método",
  system_total: "Sistema diz",
  pagbank_total: "PagBank registrou",
  expected_pagbank: "Esperado PagBank",
  asaas_subtracted: "Asaas online descontado",
  diff: "Diferença",
  total: "Total",
  subtotal: "Subtotal",
  discount: "Desconto",
  expected_total: "Total esperado",
  items_sum: "Soma dos itens",
  has_payment: "Tem pagamento?",
  has_comanda: "Comanda correspondente?",
  brand: "Bandeira",
  brand_label: "Bandeira",
  amount: "Valor",
  liquido: "Valor líquido",
  method_code: "Código método",
  hours_open: "Horas em aberto",
  quantity: "Quantidade",
  service: "Serviço",
  client_id: "Cliente",
  balance: "Saldo",
  asaas_id: "ID Asaas",
  status: "Status",
  billing_type: "Tipo cobrança",
  value: "Valor",
  date_created: "Criada em",
  description: "Descrição",
  candidate_comandas: "Comandas candidatas",
  queue_link: "Veio da fila online?",
};

const METHOD_LABELS: Record<string, string> = {
  credit: "Crédito",
  debit: "Débito",
  credit_card: "Crédito",
  debit_card: "Débito",
  pix: "PIX",
  cash: "Dinheiro",
};

function fmtBRL(n: number): string {
  return `R$ ${Number(n).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

function fmtValue(key: string, value: any): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (Array.isArray(value)) return value.join(", ") || "—";
  if (typeof value === "object") return JSON.stringify(value);

  // Métodos
  if (key === "method") return METHOD_LABELS[String(value).toLowerCase()] ?? String(value);

  // Valores monetários
  const moneyKeys = [
    "system_total", "pagbank_total", "expected_pagbank", "asaas_subtracted",
    "diff", "total", "subtotal", "discount", "expected_total", "items_sum",
    "amount", "liquido", "value", "balance",
  ];
  if (moneyKeys.includes(key) && typeof value === "number") {
    const sign = key === "diff" && value > 0 ? "+" : "";
    return `${sign}${fmtBRL(value)}`;
  }

  return String(value);
}

function FieldList({ obj }: { obj: Record<string, any> }) {
  if (!obj || typeof obj !== "object") return null;
  const entries = Object.entries(obj).filter(([, v]) => v !== null && v !== undefined);
  if (entries.length === 0) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs ml-2">
      {entries.map(([k, v]) => (
        <>
          <dt key={`k-${k}`} className="font-medium opacity-70">
            {FIELD_LABELS[k] ?? k}:
          </dt>
          <dd key={`v-${k}`} className="font-mono">
            {fmtValue(k, v)}
          </dd>
        </>
      ))}
    </dl>
  );
}

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
              <summary className="cursor-pointer font-medium">Detalhes</summary>
              <div className="mt-2 space-y-3">
                {issue.expected_value && (
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide opacity-70 mb-1">
                      Esperado
                    </div>
                    <FieldList obj={issue.expected_value} />
                  </div>
                )}
                {issue.actual_value && (
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide opacity-70 mb-1">
                      Recebido
                    </div>
                    <FieldList obj={issue.actual_value} />
                  </div>
                )}
              </div>
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
