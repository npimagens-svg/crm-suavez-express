// Renderiza relatório diário em Markdown formato WhatsApp.
// *bold*, _italic_, emojis. Otimizado pra leitura rápida no celular.
import type { DailyKpis, ClosureIssue } from "./types.ts";

const fmt = (n: number) =>
  `R$ ${n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

const pct = (a: number, b: number) =>
  b === 0 ? "—" : `${(((a - b) / b) * 100).toFixed(0)}%`;

export interface RenderInput {
  date: string;            // YYYY-MM-DD
  kpis: DailyKpis;
  issues: ClosureIssue[];
  pagbankUnavailable?: boolean;
  asaasUnavailable?: boolean;
}

// Linha de breakdown por provider (omite zero). Ex:
//   ↳ PagBank R$ 100 · Asaas R$ 50
function providerLine(by: { pagbank: number; asaas: number; manual: number }): string | null {
  const parts: string[] = [];
  if (by.pagbank > 0) parts.push(`PagBank ${fmt(by.pagbank)}`);
  if (by.asaas   > 0) parts.push(`Asaas online ${fmt(by.asaas)}`);
  if (by.manual  > 0) parts.push(`Manual ${fmt(by.manual)}`);
  return parts.length === 0 ? null : `   ↳ ${parts.join(" · ")}`;
}

export function renderMarkdown(input: RenderInput): string {
  const { date, kpis, issues, pagbankUnavailable, asaasUnavailable } = input;
  const [y, m, d] = date.split("-");
  const ddmm = `${d}/${m}/${y}`;
  const issueCount = issues.length;
  const high = issues.filter((i) => i.severity === "high").length;

  const profs = kpis.by_professional.slice(0, 5)
    .map((p) =>
      `• *${p.name}* — ${fmt(p.revenue)} (${p.count} atend.)${
        p.top_service ? ` · top: _${p.top_service.name}_` : ""
      }`
    )
    .join("\n");

  const top3 = kpis.top_services
    .map((s, i) => `${i + 1}. *${s.name}* — ${s.count}× (${fmt(s.revenue)})`)
    .join("\n");

  const mix = kpis.payment_mix;
  const total = mix.credit.gross + mix.debit.gross + mix.pix.gross + mix.cash.gross;

  // Cada método ganha sua linha principal + breakdown opcional por provedor.
  const mixLines: string[] = [];
  if (total === 0) {
    mixLines.push("—");
  } else {
    const lineFor = (
      label: string,
      icon: string,
      bucket: { gross: number },
      breakdown?: { pagbank: number; asaas: number; manual: number },
    ) => {
      mixLines.push(`${icon} ${label} ${fmt(bucket.gross)} (${((bucket.gross / total) * 100).toFixed(0)}%)`);
      if (breakdown) {
        const b = providerLine(breakdown);
        if (b) mixLines.push(b);
      }
    };
    lineFor("Crédito",  "💳", mix.credit, mix.credit.by_provider);
    lineFor("Débito",   "💳", mix.debit,  mix.debit.by_provider);
    lineFor("PIX",      "📱", mix.pix,    mix.pix.by_provider);
    lineFor("Dinheiro", "💵", mix.cash);
  }
  const mixLine = mixLines.join("\n");

  // Linha "esperado" — sempre mostra PagBank; mostra Asaas se valor > 0
  const expectedParts = [`PagBank: ${fmt(kpis.revenue.expected_from_pagbank)}`];
  if (kpis.revenue.expected_from_asaas > 0) {
    expectedParts.push(`Asaas: ${fmt(kpis.revenue.expected_from_asaas)}`);
  }
  const expectedLine = `🏦 Esperado: ${expectedParts.join(" | ")}`;

  const sections: string[] = [
    `*Fechamento NP Hair Express*`,
    `_${ddmm}_`,
    "",
    `💰 *Faturamento bruto:* *${fmt(kpis.revenue.gross)}*`,
    `   Líquido: ${fmt(kpis.revenue.net)}`,
    expectedLine,
    `📊 *Atendimentos:* ${kpis.bookings.count} · Ticket médio: ${fmt(kpis.bookings.average_ticket)}`,
    `🆕 Novos: ${kpis.new_vs_returning.new_count} (${fmt(kpis.new_vs_returning.new_revenue)}) · Retornos: ${kpis.new_vs_returning.returning_count}`,
    `🔁 vs média 7d: receita ${pct(kpis.revenue.gross, kpis.seven_day_average.revenue)} · atend. ${pct(kpis.bookings.count, kpis.seven_day_average.bookings)}`,
    "",
    `👥 *Por profissional:*`,
    profs || "_(sem dados)_",
    "",
    `🏆 *Top serviços:*`,
    top3 || "_(sem dados)_",
    "",
    `💳 *Mix de pagamento:*`,
    mixLine,
    `   Taxa real cartão: ${fmt(kpis.real_card_fee.total)}`,
    "",
    `🎁 Cashback: creditou ${fmt(kpis.cashback.credited)} · resgatou ${fmt(kpis.cashback.redeemed)}`,
    `🏷️ Toalhas: ${kpis.towels.count} (${fmt(kpis.towels.cost)})`,
  ];

  if (kpis.queue_unattended.count > 0) {
    sections.push(`⏳ Fila não atendida: ${kpis.queue_unattended.count}`);
  }

  if (pagbankUnavailable) {
    sections.push("", `⚠️ _PagBank indisponível — relatório sem cruzamento bancário_`);
  }
  if (asaasUnavailable) {
    sections.push("", `⚠️ _Asaas indisponível — relatório sem cruzamento de pagamentos online_`);
  }

  if (issueCount > 0) {
    sections.push(
      "",
      `*⚠️ ${issueCount} pendência${issueCount > 1 ? "s" : ""} aberta${issueCount > 1 ? "s" : ""}*${
        high > 0 ? ` (${high} 🔴)` : ""
      }`,
    );
    for (const i of issues.slice(0, 5)) {
      const emoji = i.severity === "high" ? "🔴" : i.severity === "medium" ? "🟡" : "🔵";
      sections.push(`${emoji} ${i.description}`);
    }
    if (issueCount > 5) sections.push(`_... e mais ${issueCount - 5}_`);
    sections.push("", `👉 Ver todas: https://suavezexpress.vercel.app/pendencias`);
  }

  return sections.join("\n");
}
