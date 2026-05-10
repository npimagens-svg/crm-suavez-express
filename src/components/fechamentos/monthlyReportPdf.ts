import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export interface MonthlyPdfInput {
  salon: string;
  period: { start: string; end: string };
  professional: string | null;
  kpis: any;
  issues: any[];
}

const fmt = (n: number) =>
  `R$ ${Number(n ?? 0)
    .toFixed(2)
    .replace(".", ",")}`;

const fmtDate = (iso: string) => iso.split("-").reverse().join("/");

/**
 * Gera o PDF mensal de fechamento e dispara `doc.save(filename)` no browser.
 *
 * Seções: Resumo · Por profissional · Top serviços · Pendências
 */
export function generateMonthlyPdf(input: MonthlyPdfInput): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 40;
  let y = margin;

  // Header
  doc.setFontSize(18);
  doc.text(`Fechamento — ${input.salon}`, margin, y);
  y += 24;

  doc.setFontSize(11);
  doc.text(
    `Período: ${fmtDate(input.period.start)} a ${fmtDate(input.period.end)}`,
    margin,
    y
  );
  y += 16;

  if (input.professional) {
    doc.text(`Profissional: ${input.professional}`, margin, y);
    y += 16;
  }
  y += 8;

  const kpis = input.kpis ?? {};

  // --- Resumo
  doc.setFontSize(13);
  doc.text("Resumo", margin, y);
  y += 14;
  autoTable(doc, {
    startY: y,
    body: [
      ["Receita bruta", fmt(kpis?.revenue?.gross ?? 0)],
      ["Receita líquida", fmt(kpis?.revenue?.net ?? 0)],
      ["PagBank esperado", fmt(kpis?.revenue?.expected_from_pagbank ?? 0)],
      ["Atendimentos", String(kpis?.bookings?.count ?? 0)],
      ["Ticket médio", fmt(kpis?.bookings?.average_ticket ?? 0)],
      [
        "Toalhas",
        `${kpis?.towels?.count ?? 0} (${fmt(kpis?.towels?.cost ?? 0)})`,
      ],
      ["Taxa real cartão", fmt(kpis?.real_card_fee?.total ?? 0)],
    ],
    theme: "plain",
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 180 } },
    margin: { left: margin, right: margin },
  });
  y = (doc as any).lastAutoTable.finalY + 16;

  // --- Por profissional
  const byProf = Array.isArray(kpis?.by_professional)
    ? kpis.by_professional
    : [];
  if (byProf.length > 0) {
    doc.setFontSize(13);
    doc.text("Por profissional", margin, y);
    y += 8;
    autoTable(doc, {
      startY: y,
      head: [["Nome", "Receita", "Atend.", "Top serviço"]],
      body: byProf.map((p: any) => [
        p?.name ?? "—",
        fmt(p?.revenue ?? 0),
        String(p?.count ?? 0),
        p?.top_service?.name ?? "—",
      ]),
      margin: { left: margin, right: margin },
    });
    y = (doc as any).lastAutoTable.finalY + 16;
  }

  // --- Top serviços
  const topServ = Array.isArray(kpis?.top_services) ? kpis.top_services : [];
  if (topServ.length > 0) {
    doc.setFontSize(13);
    doc.text("Top serviços", margin, y);
    y += 8;
    autoTable(doc, {
      startY: y,
      head: [["Serviço", "Qtd", "Receita"]],
      body: topServ.map((s: any) => [
        s?.name ?? "—",
        String(s?.count ?? 0),
        fmt(s?.revenue ?? 0),
      ]),
      margin: { left: margin, right: margin },
    });
    y = (doc as any).lastAutoTable.finalY + 16;
  }

  // --- Pendências
  const issues = Array.isArray(input.issues) ? input.issues : [];
  if (issues.length > 0) {
    doc.setFontSize(13);
    doc.text(`Pendências (${issues.length})`, margin, y);
    y += 8;
    autoTable(doc, {
      startY: y,
      head: [["Severidade", "Tipo", "Descrição"]],
      body: issues.map((i: any) => [
        String(i?.severity ?? "—"),
        String(i?.type ?? "—"),
        String(i?.description ?? "—"),
      ]),
      margin: { left: margin, right: margin },
    });
  }

  const profSuffix = input.professional
    ? "_" + input.professional.replace(/\s+/g, "_")
    : "";
  const filename = `fechamento_${input.period.start}_${input.period.end}${profSuffix}.pdf`;
  doc.save(filename);
}
