/*
 * Entradas: tudo que entrou de dinheiro no salão num período.
 * Funções puras (sem Supabase) para a tela /financeiro/entradas e para os testes.
 *
 * Fontes:
 *  - payments de comandas pagas (balcão, fila presencial, agendamento e fila online), sem os anulados;
 *  - financial_transactions income da categoria "Clube da Escova" (gravadas pelo asaas-webhook, só leitura);
 *  - financial_transactions income lançadas à mão (categoria diferente do Clube e sem payment_id).
 * Os critérios de payments são os mesmos da tela "Por gateway" (voided=false, created_at em -03:00).
 */

export const TZ_SP = "America/Sao_Paulo";
export const CATEGORIA_CLUBE = "Clube da Escova";

export const CATEGORIAS_MANUAIS = [
  "Aporte do sócio",
  "Transferência do Studio",
  "Venda avulsa",
  "Reembolso",
  "Outros",
] as const;

export type OrigemEntrada = "balcao" | "fila_online" | "clube" | "manual";
export type FormaEntrada = "cash" | "pix" | "credit_card" | "debit_card" | "installment" | "other";

export interface Entrada {
  id: string;
  origem: OrigemEntrada;
  /** Momento ISO usado para ordenar. */
  quando: string;
  /** Data no fuso de São Paulo (YYYY-MM-DD). */
  dataSP: string;
  /** Hora no fuso de São Paulo (HH:MM); null nas linhas de financial_transactions (só têm data). */
  horaSP: string | null;
  descricao: string;
  forma: FormaEntrada | null;
  onde: string;
  valor: number;
  comandaNumber?: number | null;
  profissional?: string | null;
  categoria?: string | null;
  taxa?: number | null;
  liquido?: number | null;
  editavel: boolean;
}

/** Linha de payments como vem da query (com o join de comandas). */
export interface PaymentRow {
  id: string;
  amount: number | string | null;
  payment_method: string | null;
  payment_provider: string | null;
  voided: boolean | null;
  created_at: string;
  fee_amount?: number | string | null;
  net_amount?: number | string | null;
  pagbank_nsu?: string | null;
  comandas?: {
    is_paid?: boolean | null;
    source?: string | null;
    comanda_number?: number | null;
    client?: { name: string | null } | null;
    professional?: { name: string | null } | null;
  } | null;
}

/** Linha de financial_transactions (colunas reais da tabela). */
export interface TransactionRow {
  id: string;
  salon_id?: string;
  transaction_type: string;
  amount: number | string | null;
  description: string | null;
  category: string | null;
  payment_id: string | null;
  transaction_date: string;
  created_at?: string | null;
}

// ---------- formatação ----------

export function brl(v: number | string | null | undefined) {
  const n = Number(v ?? 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** YYYY-MM-DD -> dd/mm/aaaa (meio-dia para não deslocar fuso). */
export function formatDate(s: string | null | undefined) {
  if (!s) return "—";
  return new Date(s.slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR");
}

/** YYYY-MM-DD -> dd/mm */
export function formatDiaMes(s: string | null | undefined) {
  if (!s) return "—";
  return `${s.slice(8, 10)}/${s.slice(5, 7)}`;
}

/** Data (YYYY-MM-DD) de um timestamp no fuso de São Paulo. */
export function spDate(isoTs: string) {
  return new Date(isoTs).toLocaleDateString("sv-SE", { timeZone: TZ_SP });
}

/** Hora (HH:MM) de um timestamp no fuso de São Paulo. */
export function spTime(isoTs: string) {
  return new Date(isoTs).toLocaleTimeString("pt-BR", {
    timeZone: TZ_SP,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

// ---------- períodos (sempre derivados da data de hoje em SP) ----------

export function hojeSP(agora: Date = new Date()) {
  return agora.toLocaleDateString("sv-SE", { timeZone: TZ_SP });
}

function ymd(y: number, m0: number, d: number) {
  // Date.UTC normaliza mês/dia fora da faixa (ex.: dia 0 = último dia do mês anterior)
  return new Date(Date.UTC(y, m0, d)).toISOString().slice(0, 10);
}

function partes(hoje: string) {
  return { y: Number(hoje.slice(0, 4)), m0: Number(hoje.slice(5, 7)) - 1, d: Number(hoje.slice(8, 10)) };
}

export function ontemDe(hoje: string) {
  const { y, m0, d } = partes(hoje);
  return ymd(y, m0, d - 1);
}

export function mesAtualDe(hoje: string) {
  const { y, m0 } = partes(hoje);
  return { from: ymd(y, m0, 1), to: ymd(y, m0 + 1, 0) };
}

export function mesAnteriorDe(hoje: string) {
  const { y, m0 } = partes(hoje);
  return { from: ymd(y, m0 - 1, 1), to: ymd(y, m0, 0) };
}

/** Limites do período para a query de payments (created_at em -03:00). */
export function limitesPeriodo(from: string, to: string) {
  return { inicio: `${from}T00:00:00-03:00`, fim: `${to}T23:59:59.999-03:00` };
}

// ---------- rótulos ----------

export const ORIGEM_LABEL: Record<OrigemEntrada, string> = {
  balcao: "Comanda no balcão",
  fila_online: "Fila online",
  clube: "Clube da Escova",
  manual: "Lançamento manual",
};

export const FORMA_LABEL: Record<FormaEntrada, string> = {
  cash: "Dinheiro",
  pix: "Pix",
  debit_card: "Débito",
  credit_card: "Crédito",
  installment: "Crédito parc.",
  other: "Outro",
};

export function formaLabel(f: FormaEntrada | null) {
  return f ? FORMA_LABEL[f] : "—";
}

/** Texto curto do badge de origem na tabela. */
export function origemBadge(e: Entrada) {
  if (e.origem === "balcao") return e.comandaNumber != null ? `Comanda ${e.comandaNumber}` : "Comanda";
  if (e.origem === "fila_online") return "Fila online";
  if (e.origem === "clube") return "Clube";
  return "Manual";
}

const FORMAS: FormaEntrada[] = ["cash", "pix", "credit_card", "debit_card", "installment", "other"];

function normalizaForma(m: string | null | undefined): FormaEntrada | null {
  if (!m) return null;
  return (FORMAS as string[]).includes(m) ? (m as FormaEntrada) : "other";
}

function ondeDoPagamento(provider: string | null, forma: FormaEntrada | null) {
  if (provider === "pagbank") return "Maquininha PagBank";
  if (provider === "asaas") return "Asaas (online)";
  if (forma === "cash") return "Caixa";
  if (forma === "pix") return "Pix na chave";
  if (forma === "credit_card" || forma === "debit_card" || forma === "installment") return "Maquininha (manual)";
  return "Outro";
}

function num(v: number | string | null | undefined) {
  return v == null || v === "" ? null : Number(v);
}

// ---------- mapeamento ----------

/** payment -> Entrada. Devolve null para anulado ou comanda não paga. */
export function paymentToEntrada(p: PaymentRow): Entrada | null {
  if (p.voided === true) return null;
  if (p.comandas && p.comandas.is_paid === false) return null;
  const forma = normalizaForma(p.payment_method);
  const origem: OrigemEntrada = p.comandas?.source === "fila_online" ? "fila_online" : "balcao";
  const cliente = (p.comandas?.client?.name ?? "").trim();
  return {
    id: `pay-${p.id}`,
    origem,
    quando: p.created_at,
    dataSP: spDate(p.created_at),
    horaSP: spTime(p.created_at),
    descricao: cliente || "Cliente não identificada",
    forma,
    onde: ondeDoPagamento(p.payment_provider, forma),
    valor: Number(p.amount ?? 0),
    comandaNumber: p.comandas?.comanda_number ?? null,
    profissional: (p.comandas?.professional?.name ?? "").trim() || null,
    taxa: num(p.fee_amount),
    liquido: num(p.net_amount),
    editavel: false,
  };
}

/** Income lançada à mão: não é do Clube e não está ligada a um payment. */
export function isManualIncome(t: Pick<TransactionRow, "transaction_type" | "category" | "payment_id">) {
  return t.transaction_type === "income" && t.category !== CATEGORIA_CLUBE && t.payment_id == null;
}

/**
 * financial_transaction -> Entrada. Só income; Clube só pela categoria.
 * Income com payment_id é ignorada (duplicaria a linha de payments).
 */
export function transactionToEntrada(t: TransactionRow): Entrada | null {
  if (t.transaction_type !== "income") return null;
  if (t.payment_id != null) return null;
  const clube = t.category === CATEGORIA_CLUBE;
  const data = t.transaction_date.slice(0, 10);
  return {
    id: `tx-${t.id}`,
    origem: clube ? "clube" : "manual",
    quando: `${data}T00:00:00-03:00`,
    dataSP: data,
    horaSP: null,
    descricao: (t.description ?? "").trim() || (clube ? "Mensalidade do Clube" : "Entrada"),
    forma: null,
    onde: clube ? "Asaas (Clube)" : t.category || "Outros",
    valor: Number(t.amount ?? 0),
    categoria: t.category,
    editavel: !clube,
  };
}

/** Junta as duas fontes, descarta o que não entra e ordena do mais recente para o mais antigo. */
export function montarEntradas(payments: PaymentRow[], transacoes: TransactionRow[]): Entrada[] {
  const lista: Entrada[] = [];
  for (const p of payments) {
    const e = paymentToEntrada(p);
    if (e) lista.push(e);
  }
  for (const t of transacoes) {
    const e = transactionToEntrada(t);
    if (e) lista.push(e);
  }
  const chave = (e: Entrada) => `${e.dataSP} ${e.horaSP ?? "00:00"}`;
  return lista.sort((a, b) => chave(b).localeCompare(chave(a)));
}

// ---------- totais e filtros ----------

export type GrupoCard = "especie" | "cartao" | "pixOnline" | null;

/** Em qual card a entrada soma (além do total). Fila online e Clube vão para "Pix e online". */
export function grupoDaEntrada(e: Entrada): GrupoCard {
  if (e.origem === "clube" || e.origem === "fila_online") return "pixOnline";
  if (e.forma === "cash") return "especie";
  if (e.forma === "credit_card" || e.forma === "debit_card" || e.forma === "installment") return "cartao";
  if (e.forma === "pix") return "pixOnline";
  return null;
}

export interface TotaisEntradas {
  total: number;
  especie: number;
  cartao: number;
  pixOnline: number;
  counts: { total: number; especie: number; cartao: number; pixOnline: number };
}

const arred = (n: number) => Math.round(n * 100) / 100;

export function totaisPorGrupo(entradas: Entrada[]): TotaisEntradas {
  const t: TotaisEntradas = {
    total: 0,
    especie: 0,
    cartao: 0,
    pixOnline: 0,
    counts: { total: 0, especie: 0, cartao: 0, pixOnline: 0 },
  };
  for (const e of entradas) {
    t.total += e.valor;
    t.counts.total += 1;
    const g = grupoDaEntrada(e);
    if (g) {
      t[g] += e.valor;
      t.counts[g] += 1;
    }
  }
  t.total = arred(t.total);
  t.especie = arred(t.especie);
  t.cartao = arred(t.cartao);
  t.pixOnline = arred(t.pixOnline);
  return t;
}

export type FiltroOrigem = "all" | OrigemEntrada;
/** "credit" junta crédito à vista e parcelado; "other" inclui entradas sem forma (Clube e manual). */
export type FiltroForma = "all" | "cash" | "pix" | "debit_card" | "credit" | "other";

export interface FiltrosEntradas {
  q?: string;
  origem?: FiltroOrigem;
  forma?: FiltroForma;
}

function bateForma(e: Entrada, f: FiltroForma) {
  if (f === "all") return true;
  if (f === "credit") return e.forma === "credit_card" || e.forma === "installment";
  if (f === "other") return e.forma === "other" || e.forma === null;
  return e.forma === f;
}

export function filtrarEntradas(entradas: Entrada[], { q = "", origem = "all", forma = "all" }: FiltrosEntradas) {
  const termo = q.trim().toLowerCase();
  return entradas.filter((e) => {
    if (origem !== "all" && e.origem !== origem) return false;
    if (!bateForma(e, forma)) return false;
    if (termo) {
      const hit =
        e.descricao.toLowerCase().includes(termo) ||
        (e.profissional ?? "").toLowerCase().includes(termo) ||
        (e.categoria ?? "").toLowerCase().includes(termo) ||
        (e.comandaNumber != null && String(e.comandaNumber).includes(termo));
      if (!hit) return false;
    }
    return true;
  });
}

export function somaValores(entradas: Entrada[]) {
  return arred(entradas.reduce((s, e) => s + e.valor, 0));
}
