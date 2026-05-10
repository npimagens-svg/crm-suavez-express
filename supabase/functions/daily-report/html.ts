// Renderiza relatório diário em HTML pra modal /fechamentos.
// Espelha as mesmas seções do markdown, mas com tags HTML (sem CSS inline pesado —
// classes prontas pro CSS do front).
import type { DailyKpis, ClosureIssue } from "./types.ts";

const fmt = (n: number) =>
  `R$ ${n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

export interface HtmlInput {
  date: string;
  kpis: DailyKpis;
  issues: ClosureIssue[];
  pagbankUnavailable?: boolean;
  asaasUnavailable?: boolean;
}

function providerSubline(by: { pagbank: number; asaas: number; manual: number }): string {
  const parts: string[] = [];
  if (by.pagbank > 0) parts.push(`PagBank ${fmt(by.pagbank)}`);
  if (by.asaas   > 0) parts.push(`Asaas online ${fmt(by.asaas)}`);
  if (by.manual  > 0) parts.push(`Manual ${fmt(by.manual)}`);
  return parts.length === 0
    ? ""
    : `<span class="provider-breakdown"> · ${parts.join(" · ")}</span>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderHtml(input: HtmlInput): string {
  const { date, kpis, issues, pagbankUnavailable, asaasUnavailable } = input;
  const [y, m, d] = date.split("-");
  const ddmm = `${d}/${m}/${y}`;

  const profsRows = kpis.by_professional
    .map((p) =>
      `<tr><td>${escapeHtml(p.name)}</td><td>${fmt(p.revenue)}</td><td>${p.count}</td><td>${
        p.top_service ? escapeHtml(p.top_service.name) : "—"
      }</td></tr>`
    )
    .join("");

  const topRows = kpis.top_services
    .map((s) => `<tr><td>${escapeHtml(s.name)}</td><td>${s.count}</td><td>${fmt(s.revenue)}</td></tr>`)
    .join("");

  const issueRows = issues
    .map((i) => `<li class="sev-${i.severity}">${escapeHtml(i.description)}</li>`)
    .join("");

  return `
<div class="daily-report">
  <h2>Fechamento NP Hair Express — ${ddmm}</h2>

  <section class="summary">
    <div><strong>Faturamento bruto:</strong> ${fmt(kpis.revenue.gross)}</div>
    <div><strong>Líquido:</strong> ${fmt(kpis.revenue.net)}</div>
    <div><strong>Esperado:</strong> PagBank ${fmt(kpis.revenue.expected_from_pagbank)}${
      kpis.revenue.expected_from_asaas > 0
        ? ` · Asaas ${fmt(kpis.revenue.expected_from_asaas)}`
        : ""
    }</div>
    <div><strong>Atendimentos:</strong> ${kpis.bookings.count} · Ticket médio ${fmt(kpis.bookings.average_ticket)}</div>
    <div><strong>Novos:</strong> ${kpis.new_vs_returning.new_count} (${fmt(kpis.new_vs_returning.new_revenue)}) · <strong>Retornos:</strong> ${kpis.new_vs_returning.returning_count}</div>
  </section>

  <h3>Por profissional</h3>
  <table><thead><tr><th>Nome</th><th>Receita</th><th>Atend.</th><th>Top serviço</th></tr></thead>
    <tbody>${profsRows}</tbody>
  </table>

  <h3>Top serviços</h3>
  <table><thead><tr><th>Serviço</th><th>Qtd</th><th>Receita</th></tr></thead>
    <tbody>${topRows}</tbody>
  </table>

  <h3>Mix de pagamento</h3>
  <ul>
    <li>Crédito: ${fmt(kpis.payment_mix.credit.gross)} (${kpis.payment_mix.credit.count})${providerSubline(kpis.payment_mix.credit.by_provider)}</li>
    <li>Débito: ${fmt(kpis.payment_mix.debit.gross)} (${kpis.payment_mix.debit.count})${providerSubline(kpis.payment_mix.debit.by_provider)}</li>
    <li>PIX: ${fmt(kpis.payment_mix.pix.gross)} (${kpis.payment_mix.pix.count})${providerSubline(kpis.payment_mix.pix.by_provider)}</li>
    <li>Dinheiro: ${fmt(kpis.payment_mix.cash.gross)} (${kpis.payment_mix.cash.count})</li>
  </ul>
  <p>Taxa real de cartão: ${fmt(kpis.real_card_fee.total)}</p>

  <h3>Cashback &amp; toalhas</h3>
  <ul>
    <li>Cashback creditado: ${fmt(kpis.cashback.credited)} · resgatado: ${fmt(kpis.cashback.redeemed)}</li>
    <li>Toalhas: ${kpis.towels.count} (${fmt(kpis.towels.cost)})</li>
    ${kpis.queue_unattended.count > 0 ? `<li>Fila não atendida: ${kpis.queue_unattended.count}</li>` : ""}
  </ul>

  ${pagbankUnavailable ? '<p class="warn">⚠️ PagBank indisponível — sem cruzamento bancário</p>' : ""}
  ${asaasUnavailable ? '<p class="warn">⚠️ Asaas indisponível — sem cruzamento de pagamentos online</p>' : ""}

  ${
    issues.length > 0
      ? `
    <h3>Pendências (${issues.length})</h3>
    <ul class="issues">${issueRows}</ul>
  `
      : ""
  }
</div>
  `.trim();
}
