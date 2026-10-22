// 22/10/2026 (pedido do Cleiton): e-mail de aviso pra ele a cada assinatura NOVA aprovada.
// Puro (sem rede) pra poder testar; quem envia é o index.ts.

export const AVISO_ASSINATURA_PARA = ["npimagens@gmail.com"];

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );

function telefoneBR(v: unknown): string {
  const d = String(v ?? "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d || "-";
}

export function montarAvisoNovaAssinatura(
  reg: { nome?: string | null; celular?: string | null; email?: string | null },
  def: { rotulo: string; valor: string },
  quando: Date,
  hidratacao = false,
): { subject: string; html: string; whatsapp: string } {
  const nome = reg.nome || "Assinante";
  const hora = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(quando);
  const linha = (rotulo: string, valor: string) =>
    `<tr><td style="padding:6px 0;color:#888888;font-size:14px;width:110px;">${rotulo}</td>` +
    `<td style="padding:6px 0;color:#111111;font-size:15px;font-weight:bold;">${valor}</td></tr>`;

  const whatsapp = [
    "*NOVA ASSINATURA APROVADA* 🧡",
    "",
    `Nome: ${nome}`,
    `Plano: ${def.rotulo}`,
    `Valor: ${def.valor}`,
    `WhatsApp: ${telefoneBR(reg.celular)}`,
    `Aprovada em: ${hora}`,
    ...(hidratacao ? ["", "🎁 Veio da mensagem do carrinho: ganhou 1 hidratação na 1ª visita."] : []),
  ].join("\n");

  return {
    whatsapp,
    subject: `Nova assinatura aprovada: ${nome} · ${def.valor}`,
    html: `<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:0;background:#f5f2ec;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f2ec;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;">
  <tr><td style="background:#111111;padding:24px 32px;">
    <div style="font-size:20px;font-weight:bold;color:#ffffff;">NP HAIR <span style="color:#F7A100;">EXPRESS</span></div>
    <div style="color:#F7A100;font-size:12px;letter-spacing:2px;margin-top:4px;">NOVA ASSINATURA APROVADA</div>
  </td></tr>
  <tr><td style="padding:28px 32px 8px;">
    <h1 style="margin:0;font-size:22px;color:#111111;">${esc(nome)}</h1>
    <p style="margin:8px 0 0;font-size:15px;color:#444444;">O cartão foi aprovado e ela já está ativa no sistema.</p>
  </td></tr>
  <tr><td style="padding:16px 32px;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      ${linha("Plano", esc(def.rotulo))}
      ${linha("Valor", esc(def.valor))}
      ${linha("WhatsApp", esc(telefoneBR(reg.celular)))}
      ${linha("E-mail", esc(reg.email || "-"))}
      ${linha("Aprovada em", esc(hora))}
      ${hidratacao ? linha("Presente", "1 hidratação na 1ª visita (veio da mensagem do carrinho)") : ""}
    </table>
  </td></tr>
  <tr><td style="padding:12px 32px 32px;">
    <a href="https://suavezexpress.vercel.app/clube-admin" style="display:inline-block;background:#F7A100;color:#111111;font-weight:bold;font-size:15px;text-decoration:none;padding:13px 28px;border-radius:99px;">Ver no sistema</a>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`,
  };
}
