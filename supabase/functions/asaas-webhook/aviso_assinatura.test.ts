import { assert, assertEquals } from "jsr:@std/assert@1";
import { montarAvisoNovaAssinatura } from "./aviso_assinatura.ts";

const def = { rotulo: "4 escovas por mês · cabelo longo", valor: "R$ 247/mês" };

Deno.test("aviso: assunto com nome e valor, dados no corpo e hora de São Paulo", () => {
  const a = montarAvisoNovaAssinatura(
    { nome: "Maria Teste", celular: "5511912345678", email: "maria@exemplo.com" },
    def,
    new Date("2026-10-22T20:34:57Z"),
  );
  assertEquals(a.subject, "Nova assinatura aprovada: Maria Teste · R$ 247/mês");
  assert(a.html.includes("(11) 91234-5678"));
  assert(a.html.includes("maria@exemplo.com"));
  assert(a.html.includes("22/10/2026, 17:34") || a.html.includes("22/10/2026 17:34"));
  assert(a.html.includes("4 escovas por mês · cabelo longo"));
});

Deno.test("aviso: nome digitado no site não injeta HTML", () => {
  const a = montarAvisoNovaAssinatura({ nome: "<b>x</b>" }, def, new Date());
  assert(!a.html.includes("<b>x</b>"));
  assert(a.html.includes("&lt;b&gt;x&lt;/b&gt;"));
  assert(a.html.includes(">-<"));
});

Deno.test("aviso: WhatsApp tem os dados e o presente só quando veio do carrinho", () => {
  const sem = montarAvisoNovaAssinatura({ nome: "Ana Souza", celular: "11987654321" }, def, new Date());
  assert(sem.whatsapp.startsWith("*NOVA ASSINATURA APROVADA*"));
  assert(sem.whatsapp.includes("Plano: 4 escovas por mês · cabelo longo"));
  assert(sem.whatsapp.includes("WhatsApp: (11) 98765-4321"));
  assert(!sem.whatsapp.includes("hidratação") && !sem.html.includes("hidratação"));
  const com = montarAvisoNovaAssinatura({ nome: "Ana Souza" }, def, new Date(), true);
  assert(com.whatsapp.includes("ganhou 1 hidratação"));
  assert(com.html.includes("1 hidratação na 1ª visita"));
});
