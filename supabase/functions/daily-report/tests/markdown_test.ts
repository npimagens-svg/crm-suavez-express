// Tests para markdown.ts (renderMarkdown — formato WhatsApp)
import { assert, assertStringIncludes } from "std/assert/mod.ts";
import { renderMarkdown } from "../markdown.ts";
import type { DailyKpis, ClosureIssue } from "../types.ts";

const KPIS: DailyKpis = {
  revenue: { gross: 1840, net: 1810, expected_from_pagbank: 1820, expected_from_asaas: 0 },
  bookings: { count: 23, average_ticket: 80 },
  by_professional: [
    { id: "p1", name: "Wanessa Ribeiro", revenue: 420, count: 5, top_service: { name: "Escova", count: 3 } },
    { id: "p2", name: "Marcilene Zanette", revenue: 380, count: 8, top_service: { name: "Manicure", count: 7 } },
  ],
  top_services: [
    { id: "s1", name: "Manicure", count: 9, revenue: 423 },
    { id: "s2", name: "Escova", count: 5, revenue: 400 },
    { id: "s3", name: "Hidratação", count: 3, revenue: 120 },
  ],
  payment_mix: {
    credit: { count: 8, gross: 720, net: 696, by_provider: { pagbank: 720, asaas: 0, manual: 0 } },
    debit:  { count: 5, gross: 320, net: 317, by_provider: { pagbank: 320, asaas: 0, manual: 0 } },
    pix:    { count: 7, gross: 580, net: 580, by_provider: { pagbank: 0, asaas: 200, manual: 380 } },
    cash:   { count: 3, gross: 220, net: 220 },
  },
  real_card_fee: { total: 27, by_brand: { CREDIT_VISA: 24, DEBIT_MASTERCARD: 3 } },
  new_vs_returning: { new_count: 8, returning_count: 15, new_revenue: 640 },
  cashback: { credited: 128.8, redeemed: 50, balance_change: 78.8 },
  towels: { count: 23, cost: 36.80 },
  queue_unattended: { count: 2, list: [{ id: "q1", client: "Maria" }, { id: "q2", client: "Joana" }] },
  seven_day_average: { revenue: 1500, bookings: 18, ticket: 83.33 },
};

const ISSUES: ClosureIssue[] = [
  { type: "payment_method_mismatch", severity: "high", description: "Comanda #75: cash vs debit", comanda_id: "c75" },
];

Deno.test("renderMarkdown: contém header, KPIs principais e link de pendências", () => {
  const md = renderMarkdown({ date: "2026-05-09", kpis: KPIS, issues: ISSUES });
  assertStringIncludes(md, "*Fechamento NP Hair Express*");
  assertStringIncludes(md, "09/05");
  assertStringIncludes(md, "*R$ 1.840,00*");
  assertStringIncludes(md, "Wanessa Ribeiro");
  assertStringIncludes(md, "Manicure");
  assertStringIncludes(md, "Escova");
  assertStringIncludes(md, "1 pendência");
  assertStringIncludes(md, "/pendencias");
});

Deno.test("renderMarkdown: dia sem pendências NÃO mostra link", () => {
  const md = renderMarkdown({ date: "2026-05-09", kpis: KPIS, issues: [] });
  assert(!md.includes("/pendencias"));
});

Deno.test("renderMarkdown: PagBank indisponível mostra aviso", () => {
  const md = renderMarkdown({ date: "2026-05-09", kpis: KPIS, issues: [], pagbankUnavailable: true });
  assertStringIncludes(md, "PagBank indisponível");
});
