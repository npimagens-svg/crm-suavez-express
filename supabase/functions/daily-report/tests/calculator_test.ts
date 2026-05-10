import { assertEquals } from "std/assert/mod.ts";
import {
  calculateRevenue,
  calculateBookings,
  calculateByProfessional,
  calculateTopServices,
  calculatePaymentMix,
  calculateRealCardFee,
} from "../calculator.ts";
import normalDay from "./fixtures/normal_day.json" with { type: "json" };
import pagbankFixture from "./fixtures/pagbank_response.json" with { type: "json" };

Deno.test("calculateRevenue: soma bruto de comandas pagas", () => {
  const result = calculateRevenue(normalDay.comandas, []);
  assertEquals(result.gross, 47 + 80 + 47 + 120 + 250); // 544
});

Deno.test("calculateRevenue: ignora comandas não pagas", () => {
  const comandas = [
    { ...normalDay.comandas[0], is_paid: false }
  ];
  const result = calculateRevenue(comandas, []);
  assertEquals(result.gross, 0);
});

Deno.test("calculateRevenue: net subtrai taxas dos payments", () => {
  const comandas = [{
    ...normalDay.comandas[1],
    payments: [{ ...normalDay.comandas[1].payments[0], fee_amount: 2.64, net_amount: 77.36 }]
  }];
  const result = calculateRevenue(comandas, []);
  assertEquals(result.gross, 80);
  assertEquals(result.net, 77.36);
});

Deno.test("calculateRevenue: expected_from_pagbank soma valor_total_transacao", () => {
  const pagbank = [
    { meio_pagamento: 8, valor_total_transacao: 64, valor_liquido_transacao: 63.37, taxa_intermediacao: 0.63, arranjo_ur: "DEBIT_MASTERCARD", data_prevista_pagamento: "", quantidade_parcelas: 0 },
    { meio_pagamento: 3, valor_total_transacao: 240, valor_liquido_transacao: 232.13, taxa_intermediacao: 7.87, arranjo_ur: "CREDIT_VISA", data_prevista_pagamento: "", quantidade_parcelas: 3 }
  ];
  const result = calculateRevenue([], pagbank);
  assertEquals(result.expected_from_pagbank, 304);
});

Deno.test("calculateBookings: conta apenas comandas pagas", () => {
  const result = calculateBookings(normalDay.comandas);
  assertEquals(result.count, 5);
});

Deno.test("calculateBookings: ticket médio = bruto/count", () => {
  const result = calculateBookings(normalDay.comandas);
  assertEquals(result.average_ticket, 544 / 5); // 108.8
});

Deno.test("calculateBookings: dia vazio retorna count=0 e ticket=0", () => {
  const result = calculateBookings([]);
  assertEquals(result.count, 0);
  assertEquals(result.average_ticket, 0);
});

const PROFS = [
  { id: "p_marcilene", name: "Marcilene Zanette" },
  { id: "p_wanessa",   name: "Wanessa Ribeiro" },
  { id: "p_julia",     name: "Julia Dalla" }
];

Deno.test("calculateByProfessional: agrega revenue por profissional", () => {
  const result = calculateByProfessional(normalDay.comandas, PROFS);
  const wanessa = result.find(p => p.id === "p_wanessa");
  // c2 (80) + c5 (250) = 330
  assertEquals(wanessa?.revenue, 330);
});

Deno.test("calculateByProfessional: top_service é o mais frequente", () => {
  const result = calculateByProfessional(normalDay.comandas, PROFS);
  const marcilene = result.find(p => p.id === "p_marcilene");
  assertEquals(marcilene?.top_service?.name, "Manicure"); // 2 manicures
});

Deno.test("calculateByProfessional: ordena por revenue desc", () => {
  const result = calculateByProfessional(normalDay.comandas, PROFS);
  // wanessa 330, julia 120, marcilene 94
  assertEquals(result[0].id, "p_wanessa");
  assertEquals(result[1].id, "p_julia");
  assertEquals(result[2].id, "p_marcilene");
});

Deno.test("calculateTopServices: agrega count + revenue por serviço", () => {
  const result = calculateTopServices(normalDay.comandas);
  const escova = result.find(s => s.name === "Escova");
  // c2 (1×80) + c4 (1×80) + c5 NÃO (progressiva). Total: 2 escovas, 160 reais
  assertEquals(escova?.count, 2);
  assertEquals(escova?.revenue, 160);
});

Deno.test("calculateTopServices: retorna top 3 ordenado por count", () => {
  const result = calculateTopServices(normalDay.comandas);
  assertEquals(result.length <= 3, true);
  for (let i = 1; i < result.length; i++) {
    assertEquals(result[i - 1].count >= result[i].count, true);
  }
});

Deno.test("calculatePaymentMix: agrega por método", () => {
  const result = calculatePaymentMix(normalDay.comandas);
  // pix: c1 47 + c5b 100 = 147 (count 2)
  // credit: c2 80 + c5a 150 = 230 (count 2)
  // debit: c3 47 (count 1)
  // cash: c4 120 (count 1)
  assertEquals(result.pix.gross, 147);
  assertEquals(result.pix.count, 2);
  assertEquals(result.credit.gross, 230);
  assertEquals(result.debit.gross, 47);
  assertEquals(result.cash.gross, 120);
});

Deno.test("calculateRealCardFee: total = soma de taxa_intermediacao", () => {
  const result = calculateRealCardFee(pagbankFixture.detalhes);
  assertEquals(result.total, 0.63 + 7.87); // 8.50
});

Deno.test("calculateRealCardFee: by_brand agrupa por arranjo_ur", () => {
  const result = calculateRealCardFee(pagbankFixture.detalhes);
  assertEquals(result.by_brand["DEBIT_MASTERCARD"], 0.63);
  assertEquals(result.by_brand["CREDIT_VISA"], 7.87);
});
