import { useMemo, useState } from "react";
import { display } from "@/components/financeiro/glass";
import { useSalonPermissions } from "@/hooks/useSalonPermissions";
import { Navigate } from "react-router-dom";
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
import {
  Plus, Loader2, MoreVertical, Pencil, Trash2, Search, Download, FileText, FileSpreadsheet, X,
  Wallet, Banknote, CreditCard, QrCode, AlertTriangle,
} from "lucide-react";
import { useEntradas, type EntradaInput } from "@/hooks/useEntradas";
import { EntradaModal } from "@/components/entradas/EntradaModal";
import {
  brl,
  formatDate,
  formatDiaMes,
  formaLabel,
  origemBadge,
  hojeSP,
  ontemDe,
  mesAtualDe,
  mesAnteriorDe,
  totaisPorGrupo,
  filtrarEntradas,
  somaValores,
  ORIGEM_LABEL,
  type Entrada,
  type FiltroOrigem,
  type FiltroForma,
} from "@/lib/entradas";

const ORIGEM_OPTIONS: { value: FiltroOrigem; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "balcao", label: "Comanda no balcão" },
  { value: "fila_online", label: "Fila online" },
  { value: "clube", label: "Clube da Escova" },
  { value: "manual", label: "Lançamento manual" },
];

const FORMA_OPTIONS: { value: FiltroForma; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "cash", label: "Dinheiro" },
  { value: "pix", label: "Pix" },
  { value: "debit_card", label: "Débito" },
  { value: "credit", label: "Crédito" },
  { value: "other", label: "Outro" },
];

function OrigemBadge({ e }: { e: Entrada }) {
  const cfg: Record<Entrada["origem"], string> = {
    balcao: "bg-[var(--np-surface-inset)] text-foreground hover:bg-[var(--np-surface-glass-hover)]",
    fila_online: "bg-[var(--np-accent-soft)] text-[color:var(--np-accent-text)] hover:bg-[var(--np-accent-soft)]",
    clube: "bg-[var(--np-positive-soft)] text-[color:var(--np-positive-text)] hover:bg-[var(--np-positive-soft)]",
    manual: "bg-[var(--np-surface-inset)] text-muted-foreground hover:bg-[var(--np-surface-glass-hover)]",
  };
  return <Badge variant="outline" className={`whitespace-nowrap ${cfg[e.origem]}`}>{origemBadge(e)}</Badge>;
}

export default function Entradas() {
  const { pode, isLoading: loadingPermissions } = useSalonPermissions();
  const hoje = hojeSP();
  const [dateFrom, setDateFrom] = useState<string>(() => mesAtualDe(hojeSP()).from);
  const [dateTo, setDateTo] = useState<string>(() => mesAtualDe(hojeSP()).to);
  const [search, setSearch] = useState("");
  const [origemFilter, setOrigemFilter] = useState<FiltroOrigem>("all");
  const [formaFilter, setFormaFilter] = useState<FiltroForma>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Entrada | null>(null);

  // Período sempre ativo: se o usuário apagar uma das datas, a query não roda até preencher
  const periodoValido = !!dateFrom && !!dateTo && dateFrom <= dateTo;
  const {
    entradas,
    isLoading,
    isError,
    error,
    createEntrada,
    updateEntrada,
    deleteEntrada,
    isCreating,
    isUpdating,
  } = useEntradas({ from: periodoValido ? dateFrom : "", to: periodoValido ? dateTo : "" });

  const podeLancar = pode("despesas.lancar");

  // Cards: sempre do período inteiro, antes dos outros filtros
  const totais = useMemo(() => totaisPorGrupo(entradas), [entradas]);

  const filtered = useMemo(
    () => filtrarEntradas(entradas, { q: search, origem: origemFilter, forma: formaFilter }),
    [entradas, search, origemFilter, formaFilter]
  );
  const filteredTotal = useMemo(() => somaValores(filtered), [filtered]);

  const mesAtual = mesAtualDe(hoje);
  const ehMesAtual = dateFrom === mesAtual.from && dateTo === mesAtual.to;
  const hasFilters = origemFilter !== "all" || formaFilter !== "all" || !!search.trim() || !ehMesAtual;

  const setPeriodo = (from: string, to: string) => {
    setDateFrom(from);
    setDateTo(to);
  };
  const presetHoje = () => setPeriodo(hoje, hoje);
  const presetOntem = () => {
    const o = ontemDe(hoje);
    setPeriodo(o, o);
  };
  const presetMesAtual = () => setPeriodo(mesAtual.from, mesAtual.to);
  const presetMesAnterior = () => {
    const m = mesAnteriorDe(hoje);
    setPeriodo(m.from, m.to);
  };
  const clearAll = () => {
    setOrigemFilter("all");
    setFormaFilter("all");
    setSearch("");
    presetMesAtual();
  };

  const reportSubtitle = () => {
    const origem = ORIGEM_OPTIONS.find((o) => o.value === origemFilter)?.label ?? "Todas";
    const forma = FORMA_OPTIONS.find((o) => o.value === formaFilter)?.label ?? "Todas";
    return `Período ${formatDiaMes(dateFrom)} a ${formatDiaMes(dateTo)}  ·  Origem: ${origem}  ·  Forma: ${forma}  ·  exclui pagamentos anulados`;
  };

  const linhaData = (e: Entrada) => (e.horaSP ? `${formatDate(e.dataSP)} ${e.horaSP}` : formatDate(e.dataSP));

  const handleExportPDF = async () => {
    // jspdf/autotable só baixam quando o usuário exporta (ficam fora do bundle inicial)
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Relatório de Entradas", 14, 15);
    doc.setFontSize(9);
    doc.text(reportSubtitle(), 14, 22);
    doc.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, 14, 27);

    autoTable(doc, {
      startY: 32,
      head: [["Data", "Origem", "Descrição", "Forma", "Onde entrou", "Valor"]],
      body: filtered.map((e) => [
        linhaData(e),
        origemBadge(e),
        e.descricao,
        formaLabel(e.forma),
        e.onde,
        brl(e.valor),
      ]),
      foot: [["", "", "", `${filtered.length} entrada(s)`, "TOTAL", brl(filteredTotal)]],
      styles: { fontSize: 7.5 },
      headStyles: { fillColor: [234, 88, 12] },
      footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: "bold" },
    });
    doc.save(`Entradas_${dateFrom}_a_${dateTo}.pdf`);
  };

  const handleExportXLS = async () => {
    const XLSX = await import("xlsx");
    const data: Record<string, string | number>[] = filtered.map((e) => ({
      "Data": formatDate(e.dataSP),
      "Hora": e.horaSP ?? "",
      "Origem": ORIGEM_LABEL[e.origem],
      "Comanda": e.comandaNumber ?? "",
      "Descrição": e.descricao,
      "Profissional": e.profissional ?? "",
      "Forma": e.forma ? formaLabel(e.forma) : "",
      "Onde entrou": e.onde,
      "Valor (R$)": e.valor,
      "Taxa (R$)": e.taxa ?? "",
      "Líquido (R$)": e.liquido ?? "",
    }));
    data.push({
      "Data": "TOTAL", "Hora": "", "Origem": "", "Comanda": "", "Descrição": `${filtered.length} entrada(s)`,
      "Profissional": "", "Forma": "", "Onde entrou": "", "Valor (R$)": filteredTotal, "Taxa (R$)": "", "Líquido (R$)": "",
    });
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.sheet_add_aoa(ws, [[reportSubtitle()]], { origin: -1 });
    ws["!cols"] = [{ wch: 12 }, { wch: 7 }, { wch: 18 }, { wch: 9 }, { wch: 40 }, { wch: 18 }, { wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 10 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Entradas");
    XLSX.writeFile(wb, `Entradas_${dateFrom}_a_${dateTo}.xlsx`);
  };

  const handleSave = (data: EntradaInput | (EntradaInput & { id: string })) => {
    if ("id" in data) {
      updateEntrada(data, { onSuccess: () => setEditing(null) });
    } else {
      createEntrada(data, { onSuccess: () => setCreateOpen(false) });
    }
  };

  // Mesma regra do Financeiro: rota só para quem tem financeiro.ver
  if (!loadingPermissions && !pode("financeiro.ver")) {
    return <Navigate to="/" replace />;
  }

  return (
    <AppLayoutNew>
      <div className="space-y-4 md:space-y-6">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div>
            <h1 className={`${display} text-2xl md:text-3xl font-bold tracking-tight text-foreground`}>Entradas</h1>
            <p className="text-muted-foreground text-sm">Tudo que entrou no salão: comandas, fila online, Clube e lançamentos.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-11 flex-1 sm:flex-none" disabled={filtered.length === 0}>
                  <Download className="h-4 w-4 mr-2" /> Exportar
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleExportPDF}>
                  <FileText className="h-4 w-4 mr-2 text-[color:var(--np-danger-text)]" /> PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportXLS}>
                  <FileSpreadsheet className="h-4 w-4 mr-2 text-[color:var(--np-positive-text)]" /> Excel (XLSX)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {podeLancar && (
              <Button className="h-11 flex-1 sm:flex-none" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-2" /> Nova entrada
              </Button>
            )}
          </div>
        </div>

        {/* Cards do período */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <StatCard
            titulo="TOTAL DO PERÍODO"
            valor={totais.total}
            count={totais.counts.total}
            icon={<Wallet className="h-9 w-9 text-[color:var(--np-positive-text)]" />}
            destaque
          />
          <StatCard
            titulo="EM ESPÉCIE"
            valor={totais.especie}
            count={totais.counts.especie}
            icon={<Banknote className="h-9 w-9 text-muted-foreground" />}
          />
          <StatCard
            titulo="CARTÃO"
            valor={totais.cartao}
            count={totais.counts.cartao}
            icon={<CreditCard className="h-9 w-9 text-muted-foreground" />}
          />
          <StatCard
            titulo="PIX E ONLINE"
            valor={totais.pixOnline}
            count={totais.counts.pixOnline}
            nota="Clube sem estornos"
            icon={<QrCode className="h-9 w-9 text-muted-foreground" />}
          />
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
                    placeholder="Cliente, descrição, nº da comanda..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              <div className="w-full lg:w-48">
                <Label className="text-xs text-muted-foreground">Origem</Label>
                <Select value={origemFilter} onValueChange={(v) => setOrigemFilter(v as FiltroOrigem)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ORIGEM_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-full lg:w-36">
                <Label className="text-xs text-muted-foreground">Forma</Label>
                <Select value={formaFilter} onValueChange={(v) => setFormaFilter(v as FiltroForma)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FORMA_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-full sm:w-40">
                <Label className="text-xs text-muted-foreground">Período de</Label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="mt-1" />
              </div>
              <div className="w-full sm:w-40">
                <Label className="text-xs text-muted-foreground">até</Label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="mt-1" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Atalhos:</span>
              <Button variant="secondary" size="sm" className="h-10" onClick={presetHoje}>Hoje</Button>
              <Button variant="secondary" size="sm" className="h-10" onClick={presetOntem}>Ontem</Button>
              <Button variant="secondary" size="sm" className="h-10" onClick={presetMesAtual}>Mês atual</Button>
              <Button variant="secondary" size="sm" className="h-10" onClick={presetMesAnterior}>Mês anterior</Button>
              {hasFilters && (
                <Button variant="ghost" size="sm" onClick={clearAll}>
                  <X className="h-3.5 w-3.5 mr-1" /> Limpar filtros
                </Button>
              )}
              <div className="ml-auto text-sm">
                <span className="text-muted-foreground">{filtered.length} entrada(s) · Total </span>
                <span className="font-bold tabular-nums">{brl(filteredTotal)}</span>
              </div>
            </div>
            {!periodoValido && (
              <p className="text-xs text-[color:var(--np-danger-text)]">Escolha as duas datas do período (a inicial não pode passar da final).</p>
            )}
          </CardContent>
        </Card>

        {isError ? (
          <Card className="border-[color:var(--np-danger-border)] bg-[var(--np-danger-soft)]">
            <CardContent className="p-6 text-center text-[color:var(--np-danger-text)]">
              <AlertTriangle className="h-6 w-6 mx-auto" />
              <p className="mt-2 text-sm">Não foi possível carregar as entradas. {error?.message}</p>
            </CardContent>
          </Card>
        ) : (
          <EntradasTable
            items={filtered}
            total={filteredTotal}
            podeLancar={podeLancar}
            onEdit={setEditing}
            onDelete={deleteEntrada}
            isLoading={isLoading && periodoValido}
          />
        )}
      </div>

      <EntradaModal
        open={createOpen || !!editing}
        onClose={() => { setCreateOpen(false); setEditing(null); }}
        onSave={handleSave}
        entrada={editing}
        isLoading={isCreating || isUpdating}
      />
    </AppLayoutNew>
  );
}

interface StatCardProps {
  titulo: string;
  valor: number;
  count: number;
  icon: React.ReactNode;
  nota?: string;
  destaque?: boolean;
}

function StatCard({ titulo, valor, count, icon, nota, destaque }: StatCardProps) {
  const tom = destaque ? "text-[color:var(--np-positive-text)]" : "text-muted-foreground";
  return (
    <Card className={destaque ? "border-[color:var(--np-positive-border)] bg-[var(--np-positive-soft)]" : undefined}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className={`text-xs uppercase tracking-wider font-semibold ${tom}`}>{titulo}</p>
            <p className={`[font-family:var(--np-font-display)] tabular-nums text-xl md:text-2xl font-bold mt-1 ${destaque ? tom : ""}`}>{brl(valor)}</p>
            <p className={`text-xs mt-1 ${tom}`}>
              {count} {count === 1 ? "entrada" : "entradas"}
              {nota && <> · {nota}</>}
            </p>
          </div>
          {icon}
        </div>
      </CardContent>
    </Card>
  );
}

interface EntradasTableProps {
  items: Entrada[];
  total: number;
  podeLancar: boolean;
  onEdit: (e: Entrada) => void;
  onDelete: (id: string) => void;
  isLoading: boolean;
}

function EntradasTable({ items, total, podeLancar, onEdit, onDelete, isLoading }: EntradasTableProps) {
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
          <Wallet className="h-12 w-12 mx-auto opacity-40" />
          <p className={`${display} mt-3 font-semibold text-foreground`}>Nenhuma entrada nesse filtro.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <Table className="[&_tr]:border-border">
          <TableHeader className="[&_th]:text-[11px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead className="hidden sm:table-cell">Forma</TableHead>
              <TableHead className="hidden md:table-cell">Onde entrou</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="text-sm whitespace-nowrap">
                  <div className="tabular-nums">{formatDiaMes(e.dataSP)}</div>
                  {e.horaSP && <div className="text-xs text-muted-foreground tabular-nums">{e.horaSP}</div>}
                </TableCell>
                <TableCell>
                  <OrigemBadge e={e} />
                </TableCell>
                <TableCell>
                  <div className="font-medium text-sm">{e.descricao}</div>
                  {e.profissional && (
                    <div className="text-xs text-muted-foreground mt-0.5">{e.profissional}</div>
                  )}
                  {/* forma e onde no mobile (colunas escondidas) */}
                  <div className="text-xs text-muted-foreground mt-0.5 md:hidden">
                    <span className="sm:hidden">{e.forma && <>{formaLabel(e.forma)} · </>}</span>
                    {e.onde}
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell text-sm">{formaLabel(e.forma)}</TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{e.onde}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums whitespace-nowrap">{brl(e.valor)}</TableCell>
                <TableCell>
                  {e.editavel && podeLancar && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Ações da entrada">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onEdit(e)}>
                          <Pencil className="h-4 w-4 mr-2" /> Editar
                        </DropdownMenuItem>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <DropdownMenuItem onSelect={(ev) => ev.preventDefault()} className="text-destructive">
                              <Trash2 className="h-4 w-4 mr-2" /> Excluir
                            </DropdownMenuItem>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Excluir entrada?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Essa ação não pode ser desfeita. O lançamento de {brl(e.valor)} sai do histórico.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Voltar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => onDelete(e.id.replace(/^tx-/, ""))} className="bg-destructive">
                                Excluir
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3} className="font-semibold">Total ({items.length})</TableCell>
              <TableCell className="hidden sm:table-cell" />
              <TableCell className="hidden md:table-cell" />
              <TableCell className="[font-family:var(--np-font-display)] text-right font-bold tabular-nums whitespace-nowrap">{brl(total)}</TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
}
