// Aviso automático do lead "me avisa quando a fila diminuir" (pura e testável; testes em ./leads.test.ts).
// A ligação com banco e WhatsApp fica em ./index.ts (passo 3).
//
// Regra (Cleiton 20/10/2026): avisar HOJE, uma vez, quem olhou a fila e achou grande.
// - telefone com menos de 10 dígitos          → "telefone_invalido" (não envia, sai da lista)
// - já tem entrada ativa na fila (mesmo fone)  → "ja_na_fila" (o aviso "faltam X min" cuida dela)
// - mesmo telefone já avisado hoje             → "duplicado"
// - fila (mesmo número da página pública) ainda >= o que ela pediu → "esperar"
// - senão                                       → "enviar"
import { mesmoTelefone } from "./reconcilia.ts";

export type DecisaoLead = "enviar" | "esperar" | "ja_na_fila" | "duplicado" | "telefone_invalido";

export function decidirLead(
  lead: { phone: string | null | undefined; max_queue_size: number | null | undefined },
  filaAgora: number,
  telefonesNaFila: (string | null | undefined)[],
  telefonesAvisadosHoje: (string | null | undefined)[],
): DecisaoLead {
  const digitos = String(lead.phone ?? "").replace(/\D/g, "");
  if (digitos.length < 10) return "telefone_invalido";
  if (telefonesNaFila.some((t) => mesmoTelefone(t, lead.phone))) return "ja_na_fila";
  if (telefonesAvisadosHoje.some((t) => mesmoTelefone(t, lead.phone))) return "duplicado";
  const limite = Number(lead.max_queue_size ?? 3);
  if (filaAgora >= limite) return "esperar";
  return "enviar";
}

// Mesmo número que a cliente vê na página (FilaAgora: comandas abertas + pagas sem comanda).
export function tamanhoFila(painel: { comandas?: unknown[] | null; aguardando?: unknown[] | null } | null | undefined): number {
  return (painel?.comandas?.length ?? 0) + (painel?.aguardando?.length ?? 0);
}

export function montarAvisoLead(nome: string | null | undefined, filaAgora: number, link: string): string {
  const primeiro = String(nome ?? "").trim().split(/\s+/)[0];
  const oi = primeiro ? `Oi, ${primeiro}!` : "Oi!";
  const estado = filaAgora <= 0
    ? "a fila do NP Hair Express está livre agora"
    : `a fila do NP Hair Express está com ${filaAgora} ${filaAgora === 1 ? "pessoa" : "pessoas"} agora`;
  return `${oi} Você pediu pra gente avisar quando a fila diminuísse: ${estado}. Pra garantir sua vez, entra por aqui: ${link}`;
}
