import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Printer, FileText, Eye, Pencil, Loader2, Gift, AlertTriangle, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { Caixa } from "@/hooks/useCaixas";
import { useCaixaMovements, CaixaMovementType } from "@/hooks/useCaixaMovements";
import { SangriaSuprimentoModal } from "./SangriaSuprimentoModal";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface CaixaDetailModalProps {
  open: boolean;
  onClose: () => void;
  caixa: Caixa | null;
}

export function CaixaDetailModal({ open, onClose, caixa }: CaixaDetailModalProps) {
  const navigate = useNavigate();
  const [movementModalOpen, setMovementModalOpen] = useState(false);
  const [movementType, setMovementType] = useState<CaixaMovementType>("sangria");
  const { movements } = useCaixaMovements(open ? caixa?.id : undefined);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
  };

  const openMovementModal = (type: CaixaMovementType) => {
    setMovementType(type);
    setMovementModalOpen(true);
  };

  const totalSangrias = movements.filter(m => m.type === "sangria").reduce((s, m) => s + Number(m.amount), 0);
  const totalSuprimentos = movements.filter(m => m.type === "suprimento").reduce((s, m) => s + Number(m.amount), 0);
  const sangriasCash = movements.filter(m => m.type === "sangria" && m.payment_method === "cash").reduce((s, m) => s + Number(m.amount), 0);
  const suprimentosCash = movements.filter(m => m.type === "suprimento" && m.payment_method === "cash").reduce((s, m) => s + Number(m.amount), 0);

  // Fetch linked comandas
  const { data: linkedComandas, isLoading } = useQuery({
    queryKey: ["caixa-detail-comandas", caixa?.id],
    queryFn: async () => {
      if (!caixa?.id) return [];
      const { data, error } = await supabase
        .from("comandas")
        .select("id, total, closed_at, created_at, client:clients(name), professional:professionals(name), payments(payment_method, amount)")
        .eq("caixa_id", caixa.id)
        .order("closed_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: open && !!caixa?.id,
  });

  // Fetch credits and debts
  const { data: extras } = useQuery({
    queryKey: ["caixa-detail-extras", caixa?.id],
    queryFn: async () => {
      if (!caixa?.id) return { totalCredits: 0, totalDebts: 0 };
      const { data: comandas } = await supabase
        .from("comandas")
        .select("id")
        .eq("caixa_id", caixa.id);
      const ids = comandas?.map(c => c.id) || [];
      if (ids.length === 0) return { totalCredits: 0, totalDebts: 0 };

      const [cr, dr] = await Promise.all([
        supabase.from("client_credits").select("credit_amount").in("comanda_id", ids),
        supabase.from("client_debts" as any).select("debt_amount").in("comanda_id", ids),
      ]);
      return {
        totalCredits: (cr.data || []).reduce((s: number, c: any) => s + Number(c.credit_amount || 0), 0),
        totalDebts: (dr.data || []).reduce((s: number, d: any) => s + Number(d.debt_amount || 0), 0),
      };
    },
    enabled: open && !!caixa?.id,
  });

  if (!caixa) return null;

  const totalReceived =
    (caixa.total_cash || 0) +
    (caixa.total_pix || 0) +
    (caixa.total_credit_card || 0) +
    (caixa.total_debit_card || 0) +
    (caixa.total_other || 0);

  const expectedCash = (caixa.opening_balance || 0) + (caixa.total_cash || 0);
  const cashDiff = caixa.closing_balance !== null ? (caixa.closing_balance - expectedCash) : null;
  const displayName = caixa.profile?.full_name || "Operador";

  const handlePrintReport = () => {
    const comandaRows = (linkedComandas || []).map((cmd: any) => {
      const methods = (cmd.payments || []).map((p: any) => {
        const labels: Record<string, string> = { cash: "Dinheiro", pix: "PIX", credit_card: "Crédito", debit_card: "Débito", other: "Outro" };
        return `${labels[p.payment_method] || p.payment_method}: R$ ${Number(p.amount).toFixed(2)}`;
      }).join(", ");
      return `<tr>
        <td style="padding:4px 8px;border-bottom:1px solid #eee">#${cmd.comanda_number ? String(cmd.comanda_number).padStart(4, '0') : cmd.id.slice(0, 4).toUpperCase()}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #eee">${(cmd.client as any)?.name || "Avulso"}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #eee">${(cmd.professional as any)?.name || "-"}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">R$ ${(cmd.total || 0).toFixed(2)}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #eee;font-size:11px">${methods}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #eee;font-size:11px">${cmd.closed_at ? format(new Date(cmd.closed_at), "dd/MM HH:mm") : "-"}</td>
      </tr>`;
    }).join("");

    const diffHtml = cashDiff !== null
      ? `<tr><td style="padding:6px 0;font-weight:600;color:${cashDiff >= 0 ? '#16a34a' : '#dc2626'}">Diferença:</td><td style="text-align:right;font-weight:600;color:${cashDiff >= 0 ? '#16a34a' : '#dc2626'}">R$ ${cashDiff.toFixed(2)}</td></tr>`
      : "";

    const creditsHtml = (extras?.totalCredits || 0) > 0
      ? `<tr><td style="padding:6px 0;color:#16a34a">Créditos gerados:</td><td style="text-align:right;color:#16a34a">R$ ${extras!.totalCredits.toFixed(2)}</td></tr>`
      : "";
    const debtsHtml = (extras?.totalDebts || 0) > 0
      ? `<tr><td style="padding:6px 0;color:#dc2626">Dívidas registradas:</td><td style="text-align:right;color:#dc2626">R$ ${extras!.totalDebts.toFixed(2)}</td></tr>`
      : "";

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Relatório de Caixa</title>
      <style>body{font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:20px}
      h1{font-size:18px;text-align:center;margin-bottom:4px}
      h2{font-size:14px;text-align:center;color:#666;margin-top:0}
      table{width:100%;border-collapse:collapse}
      .section{margin:16px 0;padding:12px;background:#f9f9f9;border-radius:8px}
      .section h3{margin:0 0 8px;font-size:14px}
      @media print{body{padding:10px}.section{background:#fff;border:1px solid #ddd}}</style>
    </head><body>
      <h1>Relatório de Fechamento de Caixa</h1>
      <h2>${displayName} — ${format(new Date(caixa.opened_at), "dd/MM/yyyy", { locale: ptBR })}</h2>
      <div class="section">
        <h3>Período</h3>
        <table>
          <tr><td style="padding:4px 0">Abertura:</td><td style="text-align:right">${format(new Date(caixa.opened_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</td></tr>
          ${caixa.closed_at ? `<tr><td style="padding:4px 0">Fechamento:</td><td style="text-align:right">${format(new Date(caixa.closed_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</td></tr>` : ""}
        </table>
      </div>
      <div class="section">
        <h3>Movimentação</h3>
        <table>
          <tr><td style="padding:4px 0">Abertura (troco):</td><td style="text-align:right">R$ ${(caixa.opening_balance || 0).toFixed(2)}</td></tr>
          <tr><td style="padding:4px 0">Dinheiro:</td><td style="text-align:right">R$ ${(caixa.total_cash || 0).toFixed(2)}</td></tr>
          <tr><td style="padding:4px 0">PIX:</td><td style="text-align:right">R$ ${(caixa.total_pix || 0).toFixed(2)}</td></tr>
          <tr><td style="padding:4px 0">Cartão Crédito:</td><td style="text-align:right">R$ ${(caixa.total_credit_card || 0).toFixed(2)}</td></tr>
          <tr><td style="padding:4px 0">Cartão Débito:</td><td style="text-align:right">R$ ${(caixa.total_debit_card || 0).toFixed(2)}</td></tr>
          <tr><td style="padding:4px 0">Outros:</td><td style="text-align:right">R$ ${(caixa.total_other || 0).toFixed(2)}</td></tr>
          <tr style="border-top:2px solid #333"><td style="padding:8px 0;font-weight:700;font-size:15px">Total Recebido:</td><td style="text-align:right;font-weight:700;font-size:15px">R$ ${totalReceived.toFixed(2)}</td></tr>
        </table>
      </div>
      <div class="section">
        <h3>Conferência de Caixa</h3>
        <table>
          <tr><td style="padding:4px 0">Dinheiro esperado:</td><td style="text-align:right">R$ ${expectedCash.toFixed(2)}</td></tr>
          ${caixa.closing_balance !== null ? `<tr><td style="padding:4px 0">Valor declarado:</td><td style="text-align:right">R$ ${caixa.closing_balance.toFixed(2)}</td></tr>` : ""}
          ${diffHtml}
          ${creditsHtml}
          ${debtsHtml}
        </table>
      </div>
      ${movements.length > 0 ? `
      <div class="section">
        <h3>Sangrias & Suprimentos (${movements.length})</h3>
        <table>
          <thead><tr style="background:#eee;font-size:12px">
            <th style="padding:6px 8px;text-align:left">Tipo</th>
            <th style="padding:6px 8px;text-align:left">Motivo</th>
            <th style="padding:6px 8px;text-align:left">Por</th>
            <th style="padding:6px 8px;text-align:left">Forma</th>
            <th style="padding:6px 8px;text-align:left">Hora</th>
            <th style="padding:6px 8px;text-align:right">Valor</th>
          </tr></thead>
          <tbody>
            ${movements.map((m) => {
              const isSangria = m.type === "sangria";
              const methodLabel: Record<string, string> = { cash: "Dinheiro", pix: "PIX", credit_card: "Crédito", debit_card: "Débito", other: "Outro" };
              return `<tr>
                <td style="padding:4px 8px;border-bottom:1px solid #eee;color:${isSangria ? "#dc2626" : "#16a34a"};font-weight:600">${isSangria ? "Sangria" : "Suprimento"}</td>
                <td style="padding:4px 8px;border-bottom:1px solid #eee">${m.reason}</td>
                <td style="padding:4px 8px;border-bottom:1px solid #eee;font-size:11px">${m.profile?.full_name || "Operador"}</td>
                <td style="padding:4px 8px;border-bottom:1px solid #eee;font-size:11px">${methodLabel[m.payment_method] || m.payment_method}</td>
                <td style="padding:4px 8px;border-bottom:1px solid #eee;font-size:11px">${format(new Date(m.created_at), "dd/MM HH:mm")}</td>
                <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;color:${isSangria ? "#dc2626" : "#16a34a"};font-weight:600">${isSangria ? "-" : "+"}R$ ${Number(m.amount).toFixed(2)}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
        <table style="margin-top:8px">
          ${totalSangrias > 0 ? `<tr><td style="padding:4px 0;color:#dc2626">Total sangrias:</td><td style="text-align:right;color:#dc2626;font-weight:600">- R$ ${totalSangrias.toFixed(2)}</td></tr>` : ""}
          ${totalSuprimentos > 0 ? `<tr><td style="padding:4px 0;color:#16a34a">Total suprimentos:</td><td style="text-align:right;color:#16a34a;font-weight:600">+ R$ ${totalSuprimentos.toFixed(2)}</td></tr>` : ""}
        </table>
      </div>` : ""}
      ${(linkedComandas || []).length > 0 ? `
      <div class="section">
        <h3>Comandas (${(linkedComandas || []).length})</h3>
        <table>
          <thead><tr style="background:#eee;font-size:12px">
            <th style="padding:6px 8px;text-align:left">Nº</th>
            <th style="padding:6px 8px;text-align:left">Cliente</th>
            <th style="padding:6px 8px;text-align:left">Profissional</th>
            <th style="padding:6px 8px;text-align:right">Total</th>
            <th style="padding:6px 8px;text-align:left">Pagamento</th>
            <th style="padding:6px 8px;text-align:left">Fechada</th>
          </tr></thead>
          <tbody>${comandaRows}</tbody>
        </table>
      </div>` : ""}
      ${caixa.notes ? `<div class="section"><h3>Observações</h3><p style="margin:0;font-size:13px">${caixa.notes}</p></div>` : ""}
    </body></html>`;

    const w = window.open("", "_blank", "width=900,height=700");
    if (w) {
      w.document.write(html);
      w.document.close();
      w.focus();
      setTimeout(() => w.print(), 400);
    }
  };

  const PAYMENT_LABELS: Record<string, string> = {
    cash: "Dinheiro", pix: "PIX", credit_card: "Crédito", debit_card: "Débito", other: "Outro",
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[95vw] lg:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle>Detalhes do Caixa — {displayName}</DialogTitle>
            <div className="flex gap-2 flex-wrap">
              {!caixa.closed_at && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                    onClick={() => openMovementModal("sangria")}
                  >
                    <ArrowDownCircle className="h-4 w-4" />
                    Sangria
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-green-600 border-green-200 hover:bg-green-50 hover:text-green-700"
                    onClick={() => openMovementModal("suprimento")}
                  >
                    <ArrowUpCircle className="h-4 w-4" />
                    Suprimento
                  </Button>
                </>
              )}
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handlePrintReport}>
                <Printer className="h-4 w-4" />
                Imprimir
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handlePrintReport}>
                <FileText className="h-4 w-4" />
                PDF
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4">
          {/* Period */}
          <div className="text-sm text-muted-foreground flex flex-wrap gap-4">
            <span>Aberto: {format(new Date(caixa.opened_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>
            {caixa.closed_at && <span>Fechado: {format(new Date(caixa.closed_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>}
          </div>

          {/* Totals */}
          <Card>
            <CardContent className="p-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Abertura:</span><span>{formatCurrency(caixa.opening_balance || 0)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Dinheiro:</span><span>{formatCurrency(caixa.total_cash || 0)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">PIX:</span><span>{formatCurrency(caixa.total_pix || 0)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Crédito:</span><span>{formatCurrency(caixa.total_credit_card || 0)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Débito:</span><span>{formatCurrency(caixa.total_debit_card || 0)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Outros:</span><span>{formatCurrency(caixa.total_other || 0)}</span></div>
              </div>
              <div className="border-t mt-3 pt-3 flex justify-between font-semibold">
                <span>Total Recebido:</span>
                <span className="text-primary">{formatCurrency(totalReceived)}</span>
              </div>
              {caixa.closing_balance !== null && (
                <div className="border-t mt-3 pt-3 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Dinheiro esperado:</span>
                    <span>{formatCurrency(expectedCash)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Valor declarado:</span>
                    <span>{formatCurrency(caixa.closing_balance)}</span>
                  </div>
                  {cashDiff !== null && (
                    <div className="flex justify-between font-medium">
                      <span>Diferença:</span>
                      <span className={cashDiff >= 0 ? "text-green-600" : "text-destructive"}>
                        {cashDiff >= 0 ? "+" : ""}{formatCurrency(cashDiff)}
                      </span>
                    </div>
                  )}
                </div>
              )}
              {/* Credits / Debts */}
              {((extras?.totalCredits || 0) > 0 || (extras?.totalDebts || 0) > 0) && (
                <div className="border-t mt-3 pt-3 space-y-1 text-sm">
                  {(extras?.totalCredits || 0) > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-green-600"><Gift className="h-3.5 w-3.5" />Créditos gerados:</span>
                      <span className="text-green-600 font-medium">{formatCurrency(extras!.totalCredits)}</span>
                    </div>
                  )}
                  {(extras?.totalDebts || 0) > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-destructive"><AlertTriangle className="h-3.5 w-3.5" />Dívidas registradas:</span>
                      <span className="text-destructive font-medium">{formatCurrency(extras!.totalDebts)}</span>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Comandas */}
          <div>
            <h3 className="text-sm font-semibold mb-2">
              Comandas ({isLoading ? "..." : (linkedComandas || []).length})
            </h3>
            {isLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !linkedComandas || linkedComandas.length === 0 ? (
              <p className="text-sm text-muted-foreground italic py-4">Nenhuma comanda vinculada a este caixa.</p>
            ) : (
              <div className="space-y-2">
                {linkedComandas.map((cmd: any) => {
                  const methods = (cmd.payments || []).reduce((acc: Record<string, number>, p: any) => {
                    const name = PAYMENT_LABELS[p.payment_method] || p.payment_method;
                    acc[name] = (acc[name] || 0) + Number(p.amount);
                    return acc;
                  }, {});

                  return (
                    <Card key={cmd.id} className="bg-muted/30">
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-medium text-sm">
                              #{cmd.comanda_number ? String(cmd.comanda_number).padStart(4, '0') : cmd.id.slice(0, 4).toUpperCase()} — {(cmd.client as any)?.name || "Cliente avulso"}
                            </span>
                            {(cmd.professional as any)?.name && (
                              <span className="text-xs text-muted-foreground ml-2">
                                ({(cmd.professional as any).name})
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-primary text-sm">{formatCurrency(cmd.total || 0)}</span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title="Ver comanda"
                              onClick={() => { onClose(); navigate(`/comandas?comanda=${cmd.id}`); }}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title="Editar comanda"
                              onClick={() => { onClose(); navigate(`/comandas?comanda=${cmd.id}&edit=true`); }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {Object.entries(methods).map(([method, amount]) => (
                            <Badge key={method} variant="outline" className="text-[10px] px-1.5 py-0">
                              {method}: {formatCurrency(amount as number)}
                            </Badge>
                          ))}
                          {cmd.closed_at && (
                            <span className="text-[10px] text-muted-foreground ml-auto">
                              {format(new Date(cmd.closed_at), "dd/MM 'às' HH:mm", { locale: ptBR })}
                            </span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          {/* Sangrias / Suprimentos */}
          {movements.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                Sangrias & Suprimentos ({movements.length})
                {totalSangrias > 0 && (
                  <Badge variant="outline" className="text-red-600 border-red-200">
                    -{formatCurrency(totalSangrias)}
                  </Badge>
                )}
                {totalSuprimentos > 0 && (
                  <Badge variant="outline" className="text-green-600 border-green-200">
                    +{formatCurrency(totalSuprimentos)}
                  </Badge>
                )}
              </h3>
              <div className="space-y-2">
                {movements.map((m) => {
                  const isSangria = m.type === "sangria";
                  const Icon = isSangria ? ArrowDownCircle : ArrowUpCircle;
                  const color = isSangria ? "text-red-600" : "text-green-600";
                  const methodLabel: Record<string, string> = {
                    cash: "Dinheiro", pix: "PIX", credit_card: "Crédito", debit_card: "Débito", other: "Outro",
                  };
                  return (
                    <Card key={m.id} className="bg-muted/30">
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2 flex-1 min-w-0">
                            <Icon className={`h-4 w-4 mt-0.5 ${color} flex-shrink-0`} />
                            <div className="min-w-0">
                              <div className="text-sm font-medium truncate">{m.reason}</div>
                              <div className="text-[11px] text-muted-foreground flex flex-wrap gap-2">
                                <span>{m.profile?.full_name || "Operador"}</span>
                                <span>•</span>
                                <span>{format(new Date(m.created_at), "dd/MM 'às' HH:mm", { locale: ptBR })}</span>
                                <span>•</span>
                                <span>{methodLabel[m.payment_method] || m.payment_method}</span>
                              </div>
                            </div>
                          </div>
                          <span className={`font-semibold text-sm ${color} flex-shrink-0`}>
                            {isSangria ? "-" : "+"}{formatCurrency(Number(m.amount))}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* Notes */}
          {caixa.notes && (
            <Card>
              <CardContent className="p-3">
                <h3 className="text-sm font-semibold mb-1">Observações</h3>
                <p className="text-sm text-muted-foreground">{caixa.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>

      {caixa.id && (
        <SangriaSuprimentoModal
          open={movementModalOpen}
          onClose={() => setMovementModalOpen(false)}
          caixaId={caixa.id}
          defaultType={movementType}
        />
      )}
    </Dialog>
  );
}
