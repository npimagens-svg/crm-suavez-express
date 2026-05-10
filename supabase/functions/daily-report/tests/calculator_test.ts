import { assertEquals } from "std/assert/mod.ts";
import { calculateRevenue } from "../calculator.ts";
import normalDay from "./fixtures/normal_day.json" with { type: "json" };

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
