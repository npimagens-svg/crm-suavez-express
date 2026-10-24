import { describe, it, expect } from "vitest";
import {
  paymentToEntrada,
  transactionToEntrada,
  isManualIncome,
  montarEntradas,
  totaisPorGrupo,
  filtrarEntradas,
  spDate,
  spTime,
  hojeSP,
  ontemDe,
  mesAtualDe,
  mesAnteriorDe,
  origemBadge,
  formaLabel,
  type PaymentRow,
  type TransactionRow,
} from "@/lib/entradas";

const pay = (over: Partial<PaymentRow> = {}): PaymentRow => ({
  id: "p1",
  amount: 100,
  payment_method: "pix",
  payment_provider: "manual",
  voided: false,
  created_at: "2026-10-10T15:00:00Z",
  fee_amount: null,
  net_amount: null,
  comandas: {
    is_paid: true,
    source: "balcao",
    comanda_number: 1343,
    client: { name: "Ana Souza" },
    professional: { name: "Giovanna" },
  },
  ...over,
});

const tx = (over: Partial<TransactionRow> = {}): TransactionRow => ({
  id: "t1",
  transaction_type: "income",
  amount: 77,
  description: "Clube da Escova — mensalidade Maria (pay_abc)",
  category: "Clube da Escova",
  payment_id: null,
  transaction_date: "2026-10-08",
  ...over,
});

describe("fuso de São Paulo", () => {
  it("01:30 UTC do dia 6 ainda é dia 5 em SP", () => {
    expect(spDate("2026-10-06T01:30:00Z")).toBe("2026-10-05");
    expect(spTime("2026-10-06T01:30:00Z")).toBe("22:30");
  });
  it("paymentToEntrada usa data e hora de SP", () => {
    const e = paymentToEntrada(pay({ created_at: "2026-10-06T01:30:00Z" }))!;
    expect(e.dataSP).toBe("2026-10-05");
    expect(e.horaSP).toBe("22:30");
  });
  it("presets derivados da data de hoje em SP", () => {
    expect(hojeSP(new Date("2026-11-01T02:00:00Z"))).toBe("2026-10-31");
    expect(ontemDe("2026-03-01")).toBe("2026-02-28");
    expect(mesAtualDe("2026-10-23")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(mesAnteriorDe("2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });
});

describe("paymentToEntrada", () => {
  it("comanda do balcão", () => {
    const e = paymentToEntrada(pay())!;
    expect(e.origem).toBe("balcao");
    expect(e.descricao).toBe("Ana Souza");
    expect(e.profissional).toBe("Giovanna");
    expect(e.onde).toBe("Pix na chave");
    expect(e.editavel).toBe(false);
    expect(origemBadge(e)).toBe("Comanda 1343");
  });
  it("fila online via Asaas", () => {
    const e = paymentToEntrada(pay({ payment_provider: "asaas", comandas: { is_paid: true, source: "fila_online", comanda_number: 9 } }))!;
    expect(e.origem).toBe("fila_online");
    expect(e.onde).toBe("Asaas (online)");
    expect(origemBadge(e)).toBe("Fila online");
  });
  it("fila presencial, agendamento e source nulo contam como balcão", () => {
    for (const source of ["fila_presencial", "agendamento", null]) {
      expect(paymentToEntrada(pay({ comandas: { is_paid: true, source } }))!.origem).toBe("balcao");
    }
  });
  it("anulado e comanda não paga ficam de fora", () => {
    expect(paymentToEntrada(pay({ voided: true }))).toBeNull();
    expect(paymentToEntrada(pay({ comandas: { is_paid: false, source: "balcao" } }))).toBeNull();
  });
  it("onde entrou por gateway e forma", () => {
    expect(paymentToEntrada(pay({ payment_provider: "pagbank", payment_method: "debit_card" }))!.onde).toBe("Maquininha PagBank");
    expect(paymentToEntrada(pay({ payment_method: "cash" }))!.onde).toBe("Caixa");
  });
  it("parcelado aparece como Crédito parc.", () => {
    const e = paymentToEntrada(pay({ payment_method: "installment" }))!;
    expect(e.forma).toBe("installment");
    expect(formaLabel(e.forma)).toBe("Crédito parc.");
  });
});

describe("classificação de financial_transactions", () => {
  it("Clube só pela categoria, não editável", () => {
    const e = transactionToEntrada(tx())!;
    expect(e.origem).toBe("clube");
    expect(e.onde).toBe("Asaas (Clube)");
    expect(e.editavel).toBe(false);
    expect(isManualIncome(tx())).toBe(false);
  });
  it("descrição parecida com o Clube mas outra categoria é manual", () => {
    const t = tx({ category: "Venda avulsa", description: "Clube da Escova — pacote unha" });
    expect(isManualIncome(t)).toBe(true);
    const e = transactionToEntrada(t)!;
    expect(e.origem).toBe("manual");
    expect(e.onde).toBe("Venda avulsa");
    expect(e.editavel).toBe(true);
    expect(e.horaSP).toBeNull();
  });
  it("income com payment_id e expense ficam de fora", () => {
    expect(transactionToEntrada(tx({ category: "Serviços", payment_id: "x" }))).toBeNull();
    expect(isManualIncome(tx({ category: "Serviços", payment_id: "x" }))).toBe(false);
    expect(transactionToEntrada(tx({ transaction_type: "expense" }))).toBeNull();
  });
});

describe("totais e filtros", () => {
  const entradas = montarEntradas(
    [
      pay({ id: "a", amount: 50, payment_method: "cash" }),
      pay({ id: "b", amount: 120, payment_method: "credit_card", payment_provider: "pagbank" }),
      pay({ id: "c", amount: 80, payment_method: "debit_card", payment_provider: "pagbank" }),
      pay({ id: "d", amount: 300, payment_method: "installment", payment_provider: "pagbank" }),
      pay({ id: "e", amount: 40, payment_method: "pix" }),
      pay({ id: "f", amount: 60, payment_method: "credit_card", payment_provider: "asaas",
        comandas: { is_paid: true, source: "fila_online", comanda_number: 77, client: { name: "Bia" } } }),
      pay({ id: "g", amount: 999, voided: true }),
    ],
    [
      tx({ id: "h", amount: 77 }),
      tx({ id: "i", amount: 500, category: "Aporte do sócio", description: "Aporte" }),
      tx({ id: "j", amount: 10, category: "Serviços", payment_id: "dup" }),
    ],
  );

  it("descarta anulado e duplicata", () => {
    expect(entradas).toHaveLength(8);
  });
  it("totais por grupo", () => {
    const t = totaisPorGrupo(entradas);
    expect(t.total).toBe(1227);
    expect(t.especie).toBe(50);
    expect(t.cartao).toBe(500);
    expect(t.pixOnline).toBe(40 + 60 + 77);
    expect(t.counts).toEqual({ total: 8, especie: 1, cartao: 3, pixOnline: 3 });
  });
  it("filtro por origem", () => {
    expect(filtrarEntradas(entradas, { origem: "manual" }).map((e) => e.valor)).toEqual([500]);
    expect(filtrarEntradas(entradas, { origem: "fila_online" })).toHaveLength(1);
    expect(filtrarEntradas(entradas, { origem: "clube" })).toHaveLength(1);
  });
  it("filtro por forma: crédito inclui parcelado; outro inclui sem forma", () => {
    expect(filtrarEntradas(entradas, { forma: "credit" })).toHaveLength(3);
    expect(filtrarEntradas(entradas, { forma: "other" })).toHaveLength(2);
    expect(filtrarEntradas(entradas, { forma: "cash" })).toHaveLength(1);
  });
  it("busca por cliente, descrição e número da comanda", () => {
    expect(filtrarEntradas(entradas, { q: "bia" })).toHaveLength(1);
    expect(filtrarEntradas(entradas, { q: "aporte" })).toHaveLength(1);
    expect(filtrarEntradas(entradas, { q: "77" }).some((e) => e.comandaNumber === 77)).toBe(true);
  });
});
