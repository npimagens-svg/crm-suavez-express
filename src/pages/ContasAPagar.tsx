import { useMemo, useState } from "react";
import { AppLayoutNew } from "@/components/layout/AppLayoutNew";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Plus, Loader2, MoreVertical, CheckCircle2, Pencil, XCircle, Trash2, Search, AlertTriangle, Clock, Receipt, Download, FileText, FileSpreadsheet, X } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { useAccountsPayable, AccountPayable, PayableInput, MarkAsPaidInput } from "@/hooks/useAccountsPayable";
import { PayableModal } from "@/components/payable/PayableModal";
import { MarkAsPaidModal } from "@/components/payable/MarkAsPaidModal";

function brl(v: number | string | null | undefined) {
  const n = Number(v ?? 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(s: string | null | undefined) {
  if (!s) return "—";
  // datas ISO sem hora — interpretar como meio-dia pra não deslocar fuso
  return new Date(s + (s.length === 10 ? "T12:00:00" : "")).toLocaleDateString("pt-BR");
}

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "pending", label: "A vencer" },
  { value: "overdue", label: "Vencidas" },
  { value: "paid", label: "Pagas" },
  { value: "cancelled", label: "Canceladas" },
];

const STATUS_LABEL: Record<AccountPayable["status"], string> = {
  pending: "PENDENTE",
  overdue: "VENCIDA",
  paid: "PAGA",
  cancelled: "CANCELADA",
};

function StatusBadge({ status }: { status: AccountPayable["status"] }) {
  const cfg: Record<AccountPayable["status"], string> = {
    pending: "bg-amber-100 text-amber-700 hover:bg-amber-100",
    overdue: "bg-red-100 text-red-700 hover:bg-red-100",
    paid: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100",
    cancelled: "bg-zinc-100 text-zinc-600 hover:bg-zinc-100",
  };
  return <Badge variant="outline" className={cfg[status]}>{STATUS_LABEL[status]}</Badge>;
}

export default function ContasAPagar() {
  const {
    payables,
    isLoading,
    createPayable,
    updatePayable,
    markAsPaid,
    cancelPayable,
    deletePayable,
    isCreating,
    isUpdating,
    isMarkingPaid,
  } = useAccountsPayable();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AccountPayable | null>(null);
  const [paying, setPaying] = useState<AccountPayable | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  // Stats sempre do panorama completo (não afetados pelos filtros da lista)
  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const overdue = payables.filter((p) => p.status === "overdue");
    const pending = payables.filter((p) => p.status === "pending");
    const todayDue = pending.filter((p) => p.due_date === today);
    const paid30d = payables.filter(
      (p) => p.status === "paid" && p.paid_at && new Date(p.paid_at) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    );
    const sum = (arr: AccountPayable[], k: "valor_original" | "valor_pago" = "valor_original") =>
      arr.reduce((s, p) => s + Number(p[k]), 0);
    return {
      overdue: { total: sum(overdue), count: overdue.length },
      pending: { total: sum(pending), count: pending.length },
      todayDue: { total: sum(todayDue), count: todayDue.length },
      paid30d: { total: sum(paid30d, "valor_pago") },
    };
  }, [payables]);

  // Lista filtrada (status + período por vencimento + busca)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return payables.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (dateFrom && p.due_date < dateFrom) return false;
      if (dateTo && p.due_date > dateTo) return false;
      if (q) {
        const hit =
          p.description.toLowerCase().includes(q) ||
          (p.nf_numero ?? "").includes(q) ||
          (p.supplier?.name ?? "").toLowerCase().includes(q) ||
          (p.supplier?.trade_name ?? "").toLowerCase().includes(q) ||
          (p.category ?? "").toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [payables, search, statusFilter, dateFrom, dateTo]);

  const filteredTotal = useMemo(
    () => filtered.reduce((s, p) => s + Number(p.valor_original), 0),
    [filtered]
  );

  const hasPeriod = !!(dateFrom || dateTo);
  const hasFilters = statusFilter !== "all" || hasPeriod || !!search.trim();

  const presetThisMonth = () => {
    const d = new Date();
    setDateFrom(iso(new Date(d.getFullYear(), d.getMonth(), 1)));
    setDateTo(iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)));
  };
  const presetNext30 = () => {
    const t = new Date();
    const e = new Date();
    e.setDate(e.getDate() + 30);
    setDateFrom(iso(t));
    setDateTo(iso(e));
  };
  const clearAll = () => {
    setStatusFilter("all");
    setDateFrom("");
    setDateTo("");
    setSearch("");
  };

  const reportSubtitle = () => {
    const st = STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label ?? "Todas";
    const per = hasPeriod
      ? `Vencimento de ${dateFrom ? formatDate(dateFrom) : "início"} até ${dateTo ? formatDate(dateTo) : "fim"}`
      : "Todo o período";
    return `Status: ${st}  ·  ${per}`;
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Relatório de Contas a Pagar", 14, 15);
    doc.setFontSize(9);
    doc.text(reportSubtitle(), 14, 22);
    doc.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, 14, 27);

    autoTable(doc, {
      startY: 32,
      head: [["Descrição", "Fornecedor", "NF", "Emissão", "Vencimento", "Valor", "Status", "Pago em"]],
      body: filtered.map((p) => [
        p.description,
        p.supplier?.trade_name || p.supplier?.name || "—",
        p.nf_numero || "—",
        formatDate(p.emissao),
        formatDate(p.due_date),
        brl(p.valor_original),
        STATUS_LABEL[p.status],
        p.paid_at ? formatDate(p.paid_at) : "—",
      ]),
      foot: [["", "", "", "", "TOTAL", brl(filteredTotal), `${filtered.length} conta(s)`, ""]],
      styles: { fontSize: 7.5 },
      headStyles: { fillColor: [234, 88, 12] },
      footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: "bold" },
    });
    doc.save(`Contas_a_Pagar_${iso(new Date())}.pdf`);
  };

  const handleExportXLS = () => {
    const data = filtered.map((p) => ({
      "Descrição": p.description,
      "Fornecedor": p.supplier?.trade_name || p.supplier?.name || "",
      "NF": p.nf_numero || "",
      "Parcela": p.total_parcelas > 1 ? `${p.parcela}/${p.total_parcelas}` : "",
      "Categoria": p.category || "",
      "Emissão": formatDate(p.emissao),
      "Vencimento": formatDate(p.due_date),
      "Valor (R$)": Number(p.valor_original),
      "Status": STATUS_LABEL[p.status],
      "Pago em": p.paid_at ? formatDate(p.paid_at) : "",
      "Valor pago (R$)": p.status === "paid" ? Number(p.valor_pago) : "",
    }));
    data.push({
      "Descrição": "TOTAL", "Fornecedor": "", "NF": "", "Parcela": "", "Categoria": "",
      "Emissão": "", "Vencimento": "", "Valor (R$)": Number(filteredTotal.toFixed(2)),
      "Status": `${filtered.length} conta(s)`, "Pago em": "", "Valor pago (R$)": "",
    } as any);
    const ws = XLSX.utils.json_to_sheet(data);
    ws["!cols"] = [{ wch: 40 }, { wch: 24 }, { wch: 10 }, { wch: 8 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Contas a Pagar");
    XLSX.writeFile(wb, `Contas_a_Pagar_${iso(new Date())}.xlsx`);
  };

  const handleSave = (data: PayableInput | (PayableInput & { id: string })) => {
    if ("id" in data) {
      updatePayable(data, { onSuccess: () => setEditing(null) });
    } else {
      createPayable(data, { onSuccess: () => setCreateOpen(false) });
    }
  };

  const handleMarkPaid = (data: MarkAsPaidInput) => {
    markAsPaid(data, { onSuccess: () => setPaying(null) });
  };

  return (
    <AppLayoutNew>
      <div className="space-y-4 md:space-y-6">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Contas a Pagar</h1>
            <p className="text-muted-foreground text-sm">Boletos, faturas e pagamentos a fornecedores.</p>
          </div>
          <div className="flex gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={filtered.length === 0}>
                  <Download className="h-4 w-4 mr-2" /> Exportar
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleExportPDF}>
                  <FileText className="h-4 w-4 mr-2 text-red-600" /> PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportXLS}>
                  <FileSpreadsheet className="h-4 w-4 mr-2 text-emerald-600" /> Excel (XLSX)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" /> Nova conta
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <Card className="border-red-200 bg-red-50/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wider font-semibold text-red-700">VENCIDAS</p>
                  <p className="text-xl md:text-2xl font-bold text-red-800 mt-1">{brl(stats.overdue.total)}</p>
                  <p className="text-xs text-red-600 mt-1">{stats.overdue.count} {stats.overdue.count === 1 ? "conta" : "contas"}</p>
                </div>
                <AlertTriangle className="h-9 w-9 text-red-400" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-amber-200 bg-amber-50/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wider font-semibold text-amber-700">VENCEM HOJE</p>
                  <p className="text-xl md:text-2xl font-bold text-amber-800 mt-1">{brl(stats.todayDue.total)}</p>
                  <p className="text-xs text-amber-600 mt-1">{stats.todayDue.count} {stats.todayDue.count === 1 ? "conta" : "contas"}</p>
                </div>
                <Clock className="h-9 w-9 text-amber-400" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">A VENCER</p>
                  <p className="text-xl md:text-2xl font-bold mt-1">{brl(stats.pending.total)}</p>
                  <p className="text-xs text-muted-foreground mt-1">{stats.pending.count} {stats.pending.count === 1 ? "conta" : "contas"}</p>
                </div>
                <Receipt className="h-9 w-9 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">PAGAS NOS ÚLTIMOS 30D</p>
                  <p className="text-xl md:text-2xl font-bold mt-1">{brl(stats.paid30d.total)}</p>
                </div>
                <CheckCircle2 className="h-9 w-9 text-emerald-400" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Barra de filtros */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-col lg:flex-row gap-3 lg:items-end">
              <div className="flex-1 min-w-[200px]">
                <Label className="text-xs text-muted-foreground">Buscar</Label>
                <div className="relative mt-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Descrição, NF, fornecedor..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              <div className="w-full lg:w-44">
                <Label className="text-xs text-muted-foreground">Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-full sm:w-40">
                <Label className="text-xs text-muted-foreground">Vencimento de</Label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="mt-1" />
              </div>
              <div className="w-full sm:w-40">
                <Label className="text-xs text-muted-foreground">até</Label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="mt-1" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Atalhos:</span>
              <Button variant="secondary" size="sm" onClick={presetThisMonth}>Mês atual</Button>
              <Button variant="secondary" size="sm" onClick={presetNext30}>Próx. 30 dias</Button>
              {hasFilters && (
                <Button variant="ghost" size="sm" onClick={clearAll}>
                  <X className="h-3.5 w-3.5 mr-1" /> Limpar filtros
                </Button>
              )}
              <div className="ml-auto text-sm">
                <span className="text-muted-foreground">{filtered.length} conta(s) · Total </span>
                <span className="font-bold">{brl(filteredTotal)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <PayablesTable
          items={filtered}
          total={filteredTotal}
          onPay={setPaying}
          onEdit={setEditing}
          onCancel={cancelPayable}
          onDelete={deletePayable}
          isLoading={isLoading}
        />
      </div>

      <PayableModal
        open={createOpen || !!editing}
        onClose={() => { setCreateOpen(false); setEditing(null); }}
        onSave={handleSave}
        payable={editing}
        isLoading={isCreating || isUpdating}
      />

      <MarkAsPaidModal
        open={!!paying}
        onClose={() => setPaying(null)}
        onSubmit={handleMarkPaid}
        payable={paying}
        isLoading={isMarkingPaid}
      />
    </AppLayoutNew>
  );
}

interface PayablesTableProps {
  items: AccountPayable[];
  total: number;
  onPay: (p: AccountPayable) => void;
  onEdit: (p: AccountPayable) => void;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
  isLoading: boolean;
}

function PayablesTable({ items, total, onPay, onEdit, onCancel, onDelete, isLoading }: PayablesTableProps) {
  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">
          <Loader2 className="h-6 w-6 mx-auto animate-spin" />
          <p className="mt-2 text-sm">Carregando...</p>
        </CardContent>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          <Receipt className="h-12 w-12 mx-auto opacity-30" />
          <p className="mt-3">Nenhuma conta nesse filtro.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Descrição</TableHead>
              <TableHead className="hidden md:table-cell">Fornecedor</TableHead>
              <TableHead className="hidden lg:table-cell">Emissão</TableHead>
              <TableHead className="hidden sm:table-cell">Vencimento</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((p) => (
              <TableRow key={p.id} className={p.status === "overdue" ? "bg-red-50/30" : ""}>
                <TableCell>
                  <div className="font-medium text-sm">{p.description}</div>
                  {(p.nf_numero || p.total_parcelas > 1 || p.category) && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {p.nf_numero && <>NF {p.nf_numero}</>}
                      {p.parcela && p.total_parcelas > 1 && <> · Parcela {p.parcela}/{p.total_parcelas}</>}
                      {p.category && <> · {p.category}</>}
                    </div>
                  )}
                  {/* datas no mobile (colunas escondidas) */}
                  <div className="text-xs text-muted-foreground mt-0.5 sm:hidden">
                    Venc. {formatDate(p.due_date)}{p.paid_at && <> · Pago {formatDate(p.paid_at)}</>}
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                  {p.supplier?.trade_name || p.supplier?.name || "—"}
                </TableCell>
                <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                  {formatDate(p.emissao)}
                </TableCell>
                <TableCell className="hidden sm:table-cell text-sm">
                  {formatDate(p.due_date)}
                  {p.status === "paid" && p.paid_at && (
                    <div className="text-xs text-emerald-600">Pago {formatDate(p.paid_at)}</div>
                  )}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {brl(p.valor_original)}
                </TableCell>
                <TableCell>
                  <StatusBadge status={p.status} />
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {(p.status === "pending" || p.status === "overdue") && (
                        <DropdownMenuItem onClick={() => onPay(p)}>
                          <CheckCircle2 className="h-4 w-4 mr-2 text-emerald-600" />
                          Marcar como paga
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => onEdit(p)}>
                        <Pencil className="h-4 w-4 mr-2" /> Editar
                      </DropdownMenuItem>
                      {p.status !== "cancelled" && p.status !== "paid" && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                              <XCircle className="h-4 w-4 mr-2" /> Cancelar
                            </DropdownMenuItem>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Cancelar conta?</AlertDialogTitle>
                              <AlertDialogDescription>
                                A conta vai ser marcada como cancelada (mas mantida no histórico).
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Voltar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => onCancel(p.id)}>Confirmar</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive">
                            <Trash2 className="h-4 w-4 mr-2" /> Excluir
                          </DropdownMenuItem>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Excluir conta?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Essa ação NÃO pode ser desfeita. A conta vai sair do histórico.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Voltar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => onDelete(p.id)} className="bg-destructive">Excluir</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3} className="hidden sm:table-cell font-semibold">Total ({items.length})</TableCell>
              <TableCell className="sm:hidden font-semibold">Total ({items.length})</TableCell>
              <TableCell className="hidden sm:table-cell" />
              <TableCell className="text-right font-bold tabular-nums">{brl(total)}</TableCell>
              <TableCell colSpan={2} />
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
}
