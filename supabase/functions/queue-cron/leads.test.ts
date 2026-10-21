// Testes do aviso automático de lead (puro, nada sai da máquina).
// Rodar: deno test supabase/functions/queue-cron/
import { assertEquals } from "jsr:@std/assert@1";
import { decidirLead, montarAvisoLead, tamanhoFila } from "./leads.ts";

const lead = { phone: "(11) 94313-7280", max_queue_size: 2 };

Deno.test("fila abaixo do pedido → enviar", () => {
  assertEquals(decidirLead(lead, 1, [], []), "enviar");
});

Deno.test("fila igual ao pedido → esperar (pediu MENOS de 2)", () => {
  assertEquals(decidirLead(lead, 2, [], []), "esperar");
});

Deno.test("já está na fila paga com o mesmo telefone (com DDI e sem máscara) → ja_na_fila", () => {
  assertEquals(decidirLead(lead, 0, ["5511943137280"], []), "ja_na_fila");
});

Deno.test("mesmo telefone já avisado hoje → duplicado", () => {
  assertEquals(decidirLead(lead, 0, [], ["11943137280"]), "duplicado");
});

Deno.test("telefone incompleto → telefone_invalido", () => {
  assertEquals(decidirLead({ phone: "9431-7280", max_queue_size: 3 }, 0, [], []), "telefone_invalido");
});

Deno.test("sem max_queue_size usa 3", () => {
  assertEquals(decidirLead({ phone: "11943137280", max_queue_size: null }, 2, [], []), "enviar");
  assertEquals(decidirLead({ phone: "11943137280", max_queue_size: null }, 3, [], []), "esperar");
});

Deno.test("tamanhoFila = comandas + aguardando, como a página", () => {
  assertEquals(tamanhoFila({ comandas: [1, 2], aguardando: [3] }), 3);
  assertEquals(tamanhoFila(null), 0);
});

Deno.test("mensagem: primeiro nome, acento, singular/plural/livre", () => {
  const link = "https://suavezexpress.vercel.app/fila";
  assertEquals(
    montarAvisoLead("Letícia Alencar", 1, link),
    "Oi, Letícia! Você pediu pra gente avisar quando a fila diminuísse: a fila do NP Hair Express está com 1 pessoa agora. Pra garantir sua vez, entra por aqui: https://suavezexpress.vercel.app/fila",
  );
  assertEquals(montarAvisoLead("Julia", 3, link).includes("com 3 pessoas agora"), true);
  assertEquals(montarAvisoLead("", 0, link).startsWith("Oi! Você pediu"), true);
  assertEquals(montarAvisoLead("Julia", 0, link).includes("está livre agora"), true);
});
