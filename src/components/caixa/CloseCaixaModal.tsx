import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Loader2, Gift, CheckCircle, Printer, FileText, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { Caixa } from "@/hooks/useCaixas";
import { useCaixaMovements } from "@/hooks/useCaixaMovements";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface CloseCaixaModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (closingBalance: number, notes?: string) => void;
  caixa: Caixa | null;
  isLoading?: boolean;
}

export function CloseCaixaModal({ open, onClose, onConfirm, caixa, isLoading }: CloseCaixaModalProps) {
  const [closingBalance, setClosingBalance] = useState("");
  const [notes, setNotes] = useState("");
  const [openComandasCount, setOpenComandasCount] = useState(0);
  const [orphanComandasCount, setOrphanComandasCount] = useState(0);
  const [isLastOpenCaixa, setIsLastOpenCaixa] = useState(false);
  const [checkingComandas, setCheckingComandas] = useState(false);
  const [totalCredits, setTotalCredits] = useState(0);
  const [totalDebts, setTotalDebts] = useState(0);
  const [realTotals, setRealTotals] = useState<{cash:number;pix:number;credit_card:number;debit_card:number;other:number}|null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [closedBalanceValue, setClosedBalanceValue] = useState(0);
  const [closedNotes, setClosedNotes] = useState<string | undefined>();
  const [closedAt, setClosedAt] = useState<Date>(new Date());
  const { salonId } = useAuth();
  const { movements } = useCaixaMovements(open ? caixa?.id : undefined);

  const sangriasCash = movements.filter(m => m.type === "sangria" && m.payment_method === "cash").reduce((s, m) => s + Number(m.amount), 0);
  const suprimentosCash = movements.filter(m => m.type === "suprimento" && m.payment_method === "cash").reduce((s, m) => s + Number(m.amount), 0);
  const totalSangrias = movements.filter(m => m.type === "sangria").reduce((s, m) => s + Number(m.amount), 0);
  const totalSuprimentos = movements.filter(m => m.type === "suprimento").reduce((s, m) => s + Number(m.amount), 0);

  useEffect(() => {
    if (open && caixa?.id && salonId) {
      recalculateAndCheck();
      fetchCreditsAndDebts();
    }
  }, [open, caixa?.id, salonId]);

  // Recalculate caixa totals from actual payments + check open comandas
  const recalculateAndCheck = async () => {
    if (!caixa?.id || !salonId) return;

    setCheckingComandas(true);
    try {
      // 1. Check open comandas vinculadas a este caixa
      const { data: openCmdData } = await supabase
        .from("comandas")
        .select("id", { count: "exact" })
        .eq("salon_id", salonId)
        .eq("caixa_id", caixa.id)
        .is("closed_at", null);

      setOpenComandasCount(openCmdData?.length || 0);

      // 1b. Comandas órfãs do salão (sem caixa vinculado e ainda em aberto).
      // Só bloqueiam o fechamento quando este é o ÚLTIMO caixa aberto do salão
      // — se ainda houver outros caixas, deixa que o próximo a fechar lide.
      const { data: otherOpenCaixas } = await supabase
        .from("caixas")
        .select("id")
        .eq("salon_id", salonId)
        .is("closed_at", null)
        .neq("id", caixa.id);

      const lastOpen = !otherOpenCaixas || otherOpenCaixas.length === 0;
      setIsLastOpenCaixa(lastOpen);

      if (lastOpen) {
        const { data: orphanCmdData } = await supabase
          .from("comandas")
          .select("id", { count: "exact" })
          .eq("salon_id", salonId)
          .is("caixa_id", null)
          .is("closed_at", null);
        setOrphanComandasCount(orphanCmdData?.length || 0);
      } else {
        setOrphanComandasCount(0);
      }

      // 2. Recalculate totals from actual payment records
      const { data: allComandas } = await supabase
        .from("comandas")
        .select("id")
        .eq("caixa_id", caixa.id);

      const comandaIds = (allComandas || []).map(c => c.id);
      const totals = { cash: 0, pix: 0, credit_card: 0, debit_card: 0, other: 0 };

      if (comandaIds.length > 0) {
        const { data: payments } = await supabase
          .from("payments")
          .select("payment_method, amount")
          .in("comanda_id", comandaIds);

        for (const p of (payments || [])) {
          const method = p.payment_method as keyof typeof totals;
          if (method in totals) totals[method] += Number(p.amount);
        }
      }

      // 3. Update caixa if totals don't match
      const needsUpdate =
        Math.abs((caixa.total_cash || 0) - totals.cash) > 0.01 ||
        Math.abs((caixa.total_pix || 0) - totals.pix) > 0.01 ||
        Math.abs((caixa.total_credit_card || 0) - totals.credit_card) > 0.01 ||
        Math.abs((caixa.total_debit_card || 0) - totals.debit_card) > 0.01 ||
        Math.abs((caixa.total_other || 0) - totals.other) > 0.01;

      // Always use recalculated totals for display
      setRealTotals(totals);

      if (needsUpdate) {
        await supabase
          .from("caixas")
          .update({
            total_cash: totals.cash,
            total_pix: totals.pix,
            total_credit_card: totals.credit_card,
            total_debit_card: totals.debit_card,
            total_other: totals.other,
          })
          .eq("id", caixa.id);
      }
    } catch (error) {
      console.error("Error recalculating caixa:", error);
    } finally {
      setCheckingComandas(false);
    }
  };

  const fetchCreditsAndDebts = async () => {
    if (!caixa?.id) return;
    try {
      const { data: comandas } = await supabase
        .from("comandas")
        .select("id")
        .eq("caixa_id", caixa.id);

      const comandaIds = comandas?.map(c => c.id) || [];
      if (comandaIds.length === 0) {
        setTotalCredits(0);
        setTotalDebts(0);
        return;
      }

      const [creditsRes, debtsRes] = await Promise.all([
        supabase
          .from("client_credits")
          .select("credit_amount")
          .in("comanda_id", comandaIds),
        supabase
          .from("client_debts" as any)
          .select("debt_amount")
          .in("comanda_id", comandaIds),
      ]);

      setTotalCredits((creditsRes.data || []).reduce((sum: number, c: any) => sum + Number(c.credit_amount || 0), 0));
      setTotalDebts((debtsRes.data || []).reduce((sum: number, d: any) => sum + Number(d.debt_amount || 0), 0));
    } catch (error) {
      console.error("Error fetching credits/debts:", error);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
  };

  const handleConfirm = () => {
    if (openComandasCount > 0) return;
    if (orphanComandasCount > 0) return;

    const balance = parseFloat(closingBalance.replace(",", ".")) || 0;
    setClosedBalanceValue(balance);
    setClosedNotes(notes || undefined);
    setClosedAt(new Date());
    onConfirm(balance, notes || undefined);
    setShowSuccess(true);
  };

  const handleDismiss = () => {
    setClosingBalance("");
    setNotes("");
    setShowSuccess(false);
    onClose();
  };

  const handlePrintCaixaReport = async () => {
    if (!caixa) return;

    const fmtCurr = (v: number) =>
      new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

    // Fetch comandas with items and payments for full detail
    const { data: comandas } = await supabase
      .from("comandas")
      .select(`
        id, total, closed_at, created_at,
        client:clients(name),
        professional:professionals(name),
        items:comanda_items(description, quantity, unit_price, total_price, item_type, professional:professionals(name)),
        payments(payment_method, amount)
      `)
      .eq("caixa_id", caixa.id)
      .order("closed_at", { ascending: true });

    const PAYMENT_LABELS: Record<string, string> = {
      cash: "Dinheiro", pix: "PIX", credit_card: "Crédito", debit_card: "Débito", other: "Outro",
    };

    const openedAtStr = caixa.opened_at
      ? format(new Date(caixa.opened_at), "dd/MM/yyyy HH:mm", { locale: ptBR })
      : "-";
    const closedAtStr = format(closedAt, "dd/MM/yyyy HH:mm", { locale: ptBR });
    const operatorName = caixa.profile?.full_name || "Operador";
    const pCash = realTotals?.cash ?? (caixa.total_cash || 0);
    const pPix = realTotals?.pix ?? (caixa.total_pix || 0);
    const pCredit = realTotals?.credit_card ?? (caixa.total_credit_card || 0);
    const pDebit = realTotals?.debit_card ?? (caixa.total_debit_card || 0);
    const pOther = realTotals?.other ?? (caixa.total_other || 0);
    const totalReceivedVal = pCash + pPix + pCredit + pDebit + pOther;
    const expectedCashVal = (caixa.opening_balance || 0) + pCash;
    const diffVal = closedBalanceValue - expectedCashVal;

    // Build comanda detail rows
    const comandaBlocks = (comandas || []).map((cmd: any) => {
      const clientName = cmd.client?.name || "Cliente avulso";
      const profName = cmd.professional?.name || "-";
      const items = (cmd.items || []) as any[];
      const payments = (cmd.payments || []) as any[];

      const itemRows = items.map((item: any) => `
        <tr>
          <td style="padding:2px 8px;font-size:12px">${item.description || "-"}</td>
          <td style="padding:2px 8px;font-size:12px;text-align:center">${item.quantity || 1}</td>
          <td style="padding:2px 8px;font-size:12px;text-align:right">${fmtCurr(item.unit_price || 0)}</td>
          <td style="padding:2px 8px;font-size:12px;text-align:right">${fmtCurr(item.total_price || 0)}</td>
          <td style="padding:2px 8px;font-size:12px">${item.professional?.name || profName}</td>
        </tr>
      `).join("");

      const paymentStr = payments.map((p: any) =>
        `${PAYMENT_LABELS[p.payment_method] || p.payment_method}: ${fmtCurr(p.amount)}`
      ).join(" | ");

      const closedStr = cmd.closed_at ? format(new Date(cmd.closed_at), "dd/MM HH:mm") : "-";

      return `
        <div style="margin-bottom:16px;border:1px solid #ddd;border-radius:6px;overflow:hidden">
          <div style="background:#f5f5f5;padding:8px 12px;display:flex;justify-content:space-between;align-items:center">
            <div>
              <strong>#${cmd.comanda_number ? String(cmd.comanda_number).padStart(4, '0') : cmd.id.slice(0, 4).toUpperCase()}</strong> — ${clientName}
              <span style="color:#666;margin-left:8px;font-size:12px">(${profName})</span>
            </div>
            <div style="text-align:right">
              <strong style="color:#7c3aed">${fmtCurr(cmd.total || 0)}</strong>
              <span style="font-size:11px;color:#666;margin-left:8px">${closedStr}</span>
            </div>
          </div>
          <table style="width:100%;border-collapse:collapse">
            <thead>
              <tr style="background:#fafafa;font-size:11px;color:#666">
                <th style="padding:4px 8px;text-align:left">Item</th>
                <th style="padding:4px 8px;text-align:center">Qtd</th>
                <th style="padding:4px 8px;text-align:right">Unit.</th>
                <th style="padding:4px 8px;text-align:right">Total</th>
                <th style="padding:4px 8px;text-align:left">Profissional</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>
          <div style="padding:6px 12px;font-size:11px;color:#555;border-top:1px solid #eee">
            Pagamento: ${paymentStr || "-"}
          </div>
        </div>
      `;
    }).join("");

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>Relatório de Fechamento de Caixa</title>
<style>
  @page { size: A4; margin: 15mm; }
  body { font-family: Arial, sans-serif; font-size: 13px; color: #222; max-width: 750px; margin: 0 auto; padding: 20px; }
  h1 { text-align: center; font-size: 18px; margin-bottom: 4px; }
  .subtitle { text-align: center; color: #666; font-size: 12px; margin-bottom: 20px; }
  .section { margin-bottom: 16px; }
  .section-title { font-weight: bold; font-size: 14px; border-bottom: 2px solid #7c3aed; padding-bottom: 4px; margin-bottom: 10px; color: #333; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 4px 0; }
  .label { color: #555; }
  .value { text-align: right; font-weight: 500; }
  .diff-ok { color: #16a34a; font-weight: 600; }
  .diff-bad { color: #dc2626; font-weight: 600; }
  .divider { border-top: 1px solid #ddd; margin: 8px 0; }
  .footer { text-align: center; margin-top: 24px; font-size: 11px; color: #999; }
  @media print { body { padding: 0; } }
</style></head><body>
  <h1>Relatório de Fechamento de Caixa</h1>
  <div class="subtitle">${operatorName} — Gerado em ${format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR })}</div>

  <div class="section">
    <div class="section-title">Informações Gerais</div>
    <table>
      <tr><td class="label">Operador:</td><td class="value">${operatorName}</td></tr>
      <tr><td class="label">Abertura:</td><td class="value">${openedAtStr}</td></tr>
      <tr><td class="label">Fechamento:</td><td class="value">${closedAtStr}</td></tr>
      <tr><td class="label">Total de comandas:</td><td class="value">${(comandas || []).length}</td></tr>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Movimentação por Forma de Pagamento</div>
    <table>
      <tr><td class="label">Saldo de Abertura:</td><td class="value">${fmtCurr(caixa.opening_balance || 0)}</td></tr>
      <tr><td class="label">Dinheiro:</td><td class="value">${fmtCurr(pCash)}</td></tr>
      <tr><td class="label">PIX:</td><td class="value">${fmtCurr(pPix)}</td></tr>
      <tr><td class="label">Cartão de Crédito:</td><td class="value">${fmtCurr(pCredit)}</td></tr>
      <tr><td class="label">Cartão de Débito:</td><td class="value">${fmtCurr(pDebit)}</td></tr>
      <tr><td class="label">Outros:</td><td class="value">${fmtCurr(pOther)}</td></tr>
    </table>
    <div class="divider"></div>
    <table>
      <tr><td class="label"><strong>Total Recebido:</strong></td><td class="value"><strong style="font-size:15px">${fmtCurr(totalReceivedVal)}</strong></td></tr>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Conferência de Caixa</div>
    <table>
      <tr><td class="label">Dinheiro Esperado em Caixa:</td><td class="value">${fmtCurr(expectedCashVal)}</td></tr>
      <tr><td class="label">Dinheiro Declarado:</td><td class="value">${fmtCurr(closedBalanceValue)}</td></tr>
      <tr><td class="label">Diferença:</td><td class="value ${diffVal >= 0 ? 'diff-ok' : 'diff-bad'}">${diffVal >= 0 ? "+" : ""}${fmtCurr(diffVal)}</td></tr>
    </table>
  </div>

  ${movements.length > 0 ? `
  <div class="section">
    <div class="section-title">Sangrias & Suprimentos (${movements.length})</div>
    <table style="border-collapse:collapse;width:100%">
      <thead><tr style="background:#fafafa;font-size:11px;color:#666">
        <th style="padding:4px 8px;text-align:left">Tipo</th>
        <th style="padding:4px 8px;text-align:left">Motivo</th>
        <th style="padding:4px 8px;text-align:left">Por</th>
        <th style="padding:4px 8px;text-align:left">Forma</th>
        <th style="padding:4px 8px;text-align:left">Hora</th>
        <th style="padding:4px 8px;text-align:right">Valor</th>
      </tr></thead>
      <tbody>
        ${movements.map((m) => {
          const isSangria = m.type === "sangria";
          const methodLbl: Record<string, string> = { cash: "Dinheiro", pix: "PIX", credit_card: "Crédito", debit_card: "Débito", other: "Outro" };
          return `<tr>
            <td style="padding:3px 8px;border-bottom:1px solid #eee;font-size:11px;color:${isSangria ? "#dc2626" : "#16a34a"};font-weight:600">${isSangria ? "Sangria" : "Suprimento"}</td>
            <td style="padding:3px 8px;border-bottom:1px solid #eee;font-size:12px">${m.reason}</td>
            <td style="padding:3px 8px;border-bottom:1px solid #eee;font-size:11px">${m.profile?.full_name || "Operador"}</td>
            <td style="padding:3px 8px;border-bottom:1px solid #eee;font-size:11px">${methodLbl[m.payment_method] || m.payment_method}</td>
            <td style="padding:3px 8px;border-bottom:1px solid #eee;font-size:11px">${format(new Date(m.created_at), "dd/MM HH:mm")}</td>
            <td style="padding:3px 8px;border-bottom:1px solid #eee;font-size:12px;text-align:right;color:${isSangria ? "#dc2626" : "#16a34a"};font-weight:600">${isSangria ? "-" : "+"}${fmtCurr(Number(m.amount))}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  </div>` : ""}

  ${totalCredits > 0 || totalDebts > 0 ? `
  <div class="section">
    <div class="section-title">Créditos e Dívidas</div>
    <table>
      ${totalCredits > 0 ? `<tr><td class="label">Créditos gerados:</td><td class="value diff-ok">${fmtCurr(totalCredits)}</td></tr>` : ""}
      ${totalDebts > 0 ? `<tr><td class="label">Dívidas registradas:</td><td class="value diff-bad">${fmtCurr(totalDebts)}</td></tr>` : ""}
    </table>
  </div>` : ""}

  ${(comandas || []).length > 0 ? `
  <div class="section">
    <div class="section-title">Comandas Detalhadas (${(comandas || []).length})</div>
    ${comandaBlocks}
  </div>` : ""}

  ${closedNotes ? `
  <div class="section">
    <div class="section-title">Observações</div>
    <p>${closedNotes}</p>
  </div>` : ""}

  <div class="footer">Sistema NP — Relatório gerado automaticamente</div>
</body></html>`;

    const printWindow = window.open("", "_blank", "width=900,height=900");
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => printWindow.print(), 300);
    }
  };

  if (!caixa) return null;

  // Use recalculated totals if available, otherwise fallback to caixa fields
  const displayCash = realTotals?.cash ?? (caixa.total_cash || 0);
  const displayPix = realTotals?.pix ?? (caixa.total_pix || 0);
  const displayCredit = realTotals?.credit_card ?? (caixa.total_credit_card || 0);
  const displayDebit = realTotals?.debit_card ?? (caixa.total_debit_card || 0);
  const displayOther = realTotals?.other ?? (caixa.total_other || 0);

  const totalReceived = displayCash + displayPix + displayCredit + displayDebit + displayOther;
  const expectedCash = (caixa.opening_balance || 0) + displayCash;

  const hasOpenComandas = openComandasCount > 0;
  const hasOrphanComandas = orphanComandasCount > 0;
  const blocked = hasOpenComandas || hasOrphanComandas;

  if (showSuccess) {
    return (
      <Dialog open={open} onOpenChange={handleDismiss}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Caixa Fechado</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="flex flex-col items-center gap-3 text-center">
              <CheckCircle className="h-12 w-12 text-green-500" />
              <h3 className="text-lg font-semibold">Caixa fechado com sucesso!</h3>
              <p className="text-sm text-muted-foreground">
                Você pode imprimir ou gerar o PDF do relatório de fechamento.
              </p>
            </div>
            <div className="flex items-center justify-center gap-3">
              <Button variant="outline" className="gap-2" onClick={handlePrintCaixaReport}>
                <Printer className="h-4 w-4" />
                Imprimir Relatório
              </Button>
              <Button variant="outline" className="gap-2" onClick={handlePrintCaixaReport}>
                <FileText className="h-4 w-4" />
                Gerar PDF
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleDismiss}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Fechar Caixa</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Warning for open comandas */}
          {checkingComandas ? (
            <div className="flex items-center justify-center py-2">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              <span className="text-sm text-muted-foreground">Verificando comandas...</span>
            </div>
          ) : (
            <>
              {hasOpenComandas && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    Existem <strong>{openComandasCount} comanda{openComandasCount > 1 ? "s" : ""} aberta{openComandasCount > 1 ? "s" : ""}</strong> vinculada{openComandasCount > 1 ? "s" : ""} a este caixa.
                    Feche todas as comandas antes de fechar o caixa.
                  </AlertDescription>
                </Alert>
              )}
              {hasOrphanComandas && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    Existem <strong>{orphanComandasCount} comanda{orphanComandasCount > 1 ? "s" : ""} em aberto</strong> no salão sem caixa vinculado.
                    Como este é o único caixa aberto, resolva essas pendências antes de fechar.
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}

          {/* Summary */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <h4 className="font-medium text-sm">Resumo do Caixa</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-muted-foreground">Abertura:</span>
                <span className="text-right">{formatCurrency(caixa.opening_balance || 0)}</span>

                <span className="text-muted-foreground">Dinheiro:</span>
                <span className="text-right">{formatCurrency(displayCash)}</span>

                <span className="text-muted-foreground">PIX:</span>
                <span className="text-right">{formatCurrency(displayPix)}</span>

                <span className="text-muted-foreground">Cartão Crédito:</span>
                <span className="text-right">{formatCurrency(displayCredit)}</span>

                <span className="text-muted-foreground">Cartão Débito:</span>
                <span className="text-right">{formatCurrency(displayDebit)}</span>

                <span className="text-muted-foreground">Outros:</span>
                <span className="text-right">{formatCurrency(displayOther)}</span>

                <span className="font-medium border-t pt-2">Total Recebido:</span>
                <span className="text-right font-medium border-t pt-2">{formatCurrency(totalReceived)}</span>

                <span className="font-medium text-primary">Dinheiro Esperado:</span>
                <span className="text-right font-medium text-primary">{formatCurrency(expectedCash)}</span>
              </div>

              {/* Sangrias / Suprimentos info */}
              {(totalSangrias > 0 || totalSuprimentos > 0) && (
                <div className="border-t pt-3 space-y-1.5 text-sm">
                  {sangriasCash > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-red-600">
                        <ArrowDownCircle className="h-3.5 w-3.5" />
                        Sangrias (dinheiro):
                      </span>
                      <span className="text-red-600 font-medium">-{formatCurrency(sangriasCash)}</span>
                    </div>
                  )}
                  {suprimentosCash > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-green-600">
                        <ArrowUpCircle className="h-3.5 w-3.5" />
                        Suprimentos (dinheiro):
                      </span>
                      <span className="text-green-600 font-medium">+{formatCurrency(suprimentosCash)}</span>
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground italic pt-0.5">
                    Já descontado do "Dinheiro" e do "Esperado" acima. Total de {movements.length} movimentação{movements.length > 1 ? "ões" : ""} no caixa.
                  </p>
                </div>
              )}

              {/* Credits and Debts */}
              {(totalCredits > 0 || totalDebts > 0) && (
                <div className="border-t pt-3 space-y-2">
                  {totalCredits > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5 text-green-600">
                        <Gift className="h-3.5 w-3.5" />
                        Créditos gerados para clientes:
                      </span>
                      <span className="text-green-600 font-medium">{formatCurrency(totalCredits)}</span>
                    </div>
                  )}
                  {totalDebts > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5 text-destructive">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Dívidas registradas de clientes:
                      </span>
                      <span className="text-destructive font-medium">{formatCurrency(totalDebts)}</span>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-2">
            <Label htmlFor="closingBalance">Valor em Dinheiro no Caixa (R$)</Label>
            <Input
              id="closingBalance"
              type="text"
              placeholder="0,00"
              value={closingBalance}
              onChange={(e) => setClosingBalance(e.target.value)}
              disabled={blocked}
            />
            <p className="text-xs text-muted-foreground">
              Conte o dinheiro no caixa e informe o valor total
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Observações (opcional)</Label>
            <Textarea
              id="notes"
              placeholder="Observações sobre o fechamento do caixa..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              disabled={blocked}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isLoading || blocked || checkingComandas}
          >
            {isLoading ? "Fechando..." : "Fechar Caixa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
