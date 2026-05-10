import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
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
  const [loadingHtml, setLoadingHtml] = useState(false);
  const [resending, setResending] = useState(false);

  // Carrega HTML formatado ao abrir o modal (chamando Edge Function fresca).
  // Relatórios persistidos no banco antes só tinham KPIs sem o HTML — então
  // sem isso a UI cai no fallback JSON cru.
  useEffect(() => {
    if (!open || htmlProp) return;
    let cancelled = false;
    setLoadingHtml(true);
    regenerate
      .mutateAsync({ date: reportDate })
      .then((r) => {
        if (!cancelled && r?.html) setGeneratedHtml(r.html);
      })
      .catch((err) => {
        console.error("[DailyReportDetailModal] load html failed:", err);
      })
      .finally(() => {
        if (!cancelled) setLoadingHtml(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reportDate]);

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

        {loadingHtml ? (
          <div className="flex items-center justify-center py-12 text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Gerando relatório formatado...
          </div>
        ) : html ? (
          <div
            className="daily-report-content text-sm"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <div className="text-sm text-slate-500 py-6 text-center">
            Não foi possível gerar o relatório formatado.
          </div>
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
