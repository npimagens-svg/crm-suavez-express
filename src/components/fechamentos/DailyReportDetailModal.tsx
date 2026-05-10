import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useGenerateReport } from "@/hooks/useDailyReports";

interface DailyReportDetailModalProps {
  open: boolean;
  onClose: () => void;
  reportDate: string;
  kpis: any;
  html?: string;
}

const N8N_WEBHOOK_URL = "https://agentes.72-60-6-168.sslip.io/webhook/fechamento";

export function DailyReportDetailModal({
  open,
  onClose,
  reportDate,
  kpis,
  html: htmlProp,
}: DailyReportDetailModalProps) {
  const regenerate = useGenerateReport();
  const [generatedHtml, setGeneratedHtml] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  const html = generatedHtml ?? htmlProp;

  const handleResend = async () => {
    if (
      !confirm(
        "Reenviar este relatório no WhatsApp pra Vanessa e Cleiton?"
      )
    )
      return;

    try {
      setResending(true);
      // 1) regenera relatório (recalcula KPIs e devolve html atualizado)
      const fresh = await regenerate.mutateAsync({ date: reportDate });
      if (fresh?.html) setGeneratedHtml(fresh.html);

      // 2) dispara webhook N8N pra reenviar via Evolution
      await fetch(N8N_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: reportDate, source: "manual_resend" }),
      });

      alert("Relatório regenerado e reenviado.");
    } catch (err) {
      console.error("[DailyReportDetailModal] resend failed:", err);
      alert(
        "Falha ao reenviar. Veja o console pra detalhes."
      );
    } finally {
      setResending(false);
    }
  };

  const formattedDate = reportDate.split("-").reverse().join("/");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Fechamento de {formattedDate}</DialogTitle>
        </DialogHeader>

        {html ? (
          <div
            className="prose max-w-none text-sm"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <pre className="text-xs bg-slate-50 p-3 rounded overflow-x-auto">
            {JSON.stringify(kpis, null, 2)}
          </pre>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button
            onClick={handleResend}
            disabled={resending || regenerate.isPending}
          >
            {resending || regenerate.isPending
              ? "Enviando..."
              : "Reenviar WhatsApp"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
