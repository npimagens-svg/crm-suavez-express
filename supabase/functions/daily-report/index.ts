// Edge Function daily-report — orquestrador.
// Aceita { date } ou { start, end, professional_id? }. Calcula KPIs, detecta
// issues, persiste (quando 1 dia) e devolve markdown + html prontos.
import { createClient } from "supabase";
import { z } from "zod";
import { fetchPagBankTransactional } from "./pagbank.ts";
import { fetchAsaasPayments } from "./asaas.ts";
import {
  calculateBookings,
  calculateByProfessional,
  calculateCashback,
  calculateNewVsReturning,
  calculatePaymentMix,
  calculateQueueUnattended,
  calculateRealCardFee,
  calculateRevenue,
  calculateSevenDayAverage,
  calculateTopServices,
  calculateTowels,
} from "./calculator.ts";
import { runAllDetectors } from "./detector.ts";
import { renderMarkdown } from "./markdown.ts";
import { renderHtml } from "./html.ts";
import type { AsaasPayment, ComandaWithItems, DailyKpis, DailyReportResponse, PagBankTransaction } from "./types.ts";

const InputSchema = z.union([
  z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    professional_id: z.string().uuid().optional(),
  }),
]);

const SALON_ID = Deno.env.get("NPHAIR_EXPRESS_SALON_ID") ?? "9793948a-e208-4054-a4df-4b8f2b3b3965";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("", { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) return json({ error: "Invalid input", issues: parsed.error.issues }, 400);

  const data = parsed.data;
  const isRange = "start" in data;
  const startDate = isRange ? data.start : data.date;
  const endDate = isRange ? data.end : data.date;
  const professionalId = isRange ? data.professional_id : undefined;

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    const result = await generateReport({
      supa,
      salonId: SALON_ID,
      startDate,
      endDate,
      professionalId,
    });
    return json(result, 200);
  } catch (err) {
    console.error("daily-report error:", err);
    return json({ error: String(err), stack: (err as Error).stack }, 500);
  }
});

interface GenerateInput {
  // deno-lint-ignore no-explicit-any
  supa: any;
  salonId: string;
  startDate: string;
  endDate: string;
  professionalId?: string;
}

async function generateReport(input: GenerateInput): Promise<DailyReportResponse> {
  const { supa, salonId, startDate, endDate, professionalId } = input;

  // 1) Comandas + items + payments do período
  const startTz = `${startDate}T00:00:00-03:00`;
  const endTz = `${endDate}T23:59:59-03:00`;

  let comQuery = supa
    .from("comandas")
    .select(`
      id, salon_id, client_id, professional_id, comanda_number,
      total, subtotal, discount, is_paid,
      created_at, closed_at,
      items:comanda_items(service_id, quantity, unit_price, total_price, services(name)),
      payments(id, amount, payment_method, payment_provider, fee_amount, net_amount, installments)
    `)
    .eq("salon_id", salonId)
    .gte("created_at", startTz)
    .lte("created_at", endTz);

  if (professionalId) comQuery = comQuery.eq("professional_id", professionalId);

  const { data: rawComandas, error: cErr } = await comQuery;
  if (cErr) throw cErr;

  // deno-lint-ignore no-explicit-any
  const comandas: ComandaWithItems[] = (rawComandas ?? []).map((c: any) => ({
    id: c.id,
    salon_id: c.salon_id,
    client_id: c.client_id,
    professional_id: c.professional_id,
    comanda_number: c.comanda_number,
    total: Number(c.total),
    subtotal: c.subtotal != null ? Number(c.subtotal) : null,
    discount: c.discount != null ? Number(c.discount) : null,
    is_paid: c.is_paid,
    created_at: c.created_at,
    closed_at: c.closed_at,
    // deno-lint-ignore no-explicit-any
    items: (c.items ?? []).map((i: any) => ({
      service_id: i.service_id,
      service_name: i.services?.name ?? "(sem nome)",
      quantity: Number(i.quantity),
      unit_price: Number(i.unit_price),
      total_price: Number(i.total_price),
    })),
    // deno-lint-ignore no-explicit-any
    payments: (c.payments ?? []).map((p: any) => ({
      id: p.id,
      amount: Number(p.amount),
      payment_method: normalizePaymentMethod(p.payment_method),
      payment_provider: normalizePaymentProvider(p.payment_provider),
      fee_amount: Number(p.fee_amount ?? 0),
      net_amount: Number(p.net_amount ?? 0),
      installments: Number(p.installments ?? 0),
    })),
  }));

  // 2) Professionals do salon
  const { data: professionals } = await supa
    .from("professionals")
    .select("id, name")
    .eq("salon_id", salonId);

  // 3) customer_credits do período
  const { data: credits } = await supa
    .from("customer_credits")
    .select("client_id, amount, type, balance")
    .eq("salon_id", salonId)
    .gte("created_at", startTz)
    .lte("created_at", endTz);

  // 4) queue_entries do período
  const { data: queueEntries } = await supa
    .from("queue_entries")
    .select("id, status, client_name")
    .eq("salon_id", salonId)
    .gte("created_at", startTz)
    .lte("created_at", endTz);

  // 5) PagBank EDI — 1 chamada por dia no range
  const pagbankUser = Deno.env.get("PAGBANK_USER")!;
  const pagbankToken = Deno.env.get("PAGBANK_TOKEN")!;
  const allTx: PagBankTransaction[] = [];
  let pagbankUnavailable = false;
  for (const day of daysBetween(startDate, endDate)) {
    const r = await fetchPagBankTransactional(day, { user: pagbankUser, token: pagbankToken });
    if (r.unavailable) pagbankUnavailable = true;
    allTx.push(...r.transactions);
  }

  // 5b) Asaas — 1 chamada cobrindo o range inteiro (filtra por dateCreated)
  // API key vem de queue_settings (1 por salão).
  const { data: qs } = await supa
    .from("queue_settings")
    .select("asaas_api_key")
    .eq("salon_id", salonId)
    .maybeSingle();
  const asaasApiKey: string = qs?.asaas_api_key ?? "";

  const allAsaas: AsaasPayment[] = [];
  let asaasUnavailable = false;
  if (asaasApiKey) {
    const r = await fetchAsaasPayments(startDate, endDate, asaasApiKey);
    if (r.unavailable) asaasUnavailable = true;
    allAsaas.push(...r.payments);
  } else {
    // Sem API key configurada = nada pra cruzar. Não marca unavailable
    // porque "não configurado" é estado válido (salão pode não usar Asaas).
    console.log("Asaas API key não configurada — pulando integração");
  }

  // 6) Histórico (30 dias antes) — pra new_vs_returning + 7d_avg
  const histStart = subDaysISO(startDate, 30);
  const { data: history } = await supa
    .from("comandas")
    .select("client_id, closed_at, total, is_paid")
    .eq("salon_id", salonId)
    .gte("closed_at", `${histStart}T00:00:00-03:00`)
    .lt("closed_at", `${startDate}T00:00:00-03:00`)
    .eq("is_paid", true);

  const sevenDayHistory = aggregateByDay(history ?? []);

  // 7) KPIs
  const kpis: DailyKpis = {
    revenue: calculateRevenue(comandas, allTx, allAsaas),
    bookings: calculateBookings(comandas),
    by_professional: calculateByProfessional(comandas, professionals ?? []),
    top_services: calculateTopServices(comandas),
    payment_mix: calculatePaymentMix(comandas),
    real_card_fee: calculateRealCardFee(allTx),
    new_vs_returning: calculateNewVsReturning(comandas, history ?? []),
    cashback: calculateCashback(
      // deno-lint-ignore no-explicit-any
      ((credits ?? []) as any[])
        .filter((c) => c.type === "earned" || c.type === "redeemed")
        .map((c) => ({ amount: Number(c.amount), type: c.type as "earned" | "redeemed" })),
    ),
    towels: calculateTowels(comandas),
    queue_unattended: calculateQueueUnattended(queueEntries ?? []),
    seven_day_average: calculateSevenDayAverage(sevenDayHistory),
  };

  // 8) Issues
  // Pra detectCashbackOverdraft: agrupa balance por client_id (último valor por client).
  // deno-lint-ignore no-explicit-any
  const balancesByClient = new Map<string, number>();
  // deno-lint-ignore no-explicit-any
  for (const c of (credits ?? []) as any[]) {
    if (c.client_id && typeof c.balance === "number") {
      balancesByClient.set(c.client_id, Number(c.balance));
    }
  }
  const balances = [...balancesByClient.entries()].map(([client_id, balance]) => ({
    client_id,
    balance,
  }));

  // Mapeia client_id → name pra mostrar candidatos amigáveis em Asaas pending.
  const clientIds = [...new Set(
    comandas.map(c => c.client_id).filter((x): x is string => !!x)
  )];
  const clientNameById: Record<string, string> = {};
  if (clientIds.length > 0) {
    const { data: clientRows } = await supa
      .from("clients")
      .select("id, name")
      .in("id", clientIds);
    // deno-lint-ignore no-explicit-any
    for (const cr of (clientRows ?? []) as any[]) {
      clientNameById[cr.id] = cr.name;
    }
  }

  // Linka Asaas PENDING/OVERDUE com queue_entries (payment_id = asaas.id)
  // Cenário golpe: cliente clicou na fila online, gerou Asaas, foi atendida
  // presencial mas cobrança continua pending → potencial fuga de pagamento.
  const pendingAsaasIds = allAsaas
    .filter(a => a.status === "PENDING" || a.status === "OVERDUE")
    .map(a => a.id);
  const queueEntriesByPaymentId: Record<string, {
    customer_name: string;
    status: string;
    payment_id: string;
    created_at: string;
  }> = {};
  if (pendingAsaasIds.length > 0) {
    const { data: queueRows } = await supa
      .from("queue_entries")
      .select("customer_name, status, payment_id, created_at")
      .eq("salon_id", salonId)
      .in("payment_id", pendingAsaasIds);
    // deno-lint-ignore no-explicit-any
    for (const q of (queueRows ?? []) as any[]) {
      if (q.payment_id) {
        queueEntriesByPaymentId[q.payment_id] = {
          customer_name: q.customer_name ?? "",
          status: q.status ?? "",
          payment_id: q.payment_id,
          created_at: q.created_at,
        };
      }
    }
  }

  const issues = runAllDetectors({
    comandas,
    pagbank: allTx,
    credits: balances,
    asaas: allAsaas,
    clientNameById,
    queueEntriesByPaymentId,
  });

  // 9) Persistir daily_reports + closure_issues (idempotente, somente 1 dia)
  if (startDate === endDate) {
    await supa.from("daily_reports").upsert({
      salon_id: salonId,
      report_date: startDate,
      kpis,
      pagbank_raw: { transactions: allTx, unavailable: pagbankUnavailable },
      asaas_raw: { payments: allAsaas, unavailable: asaasUnavailable },
      generated_at: new Date().toISOString(),
      generated_by: "cron",
    }, { onConflict: "salon_id,report_date" });

    // Idempotência: remove issues 'open' do mesmo dia antes de re-inserir.
    // Preserva issues in_correction/resolved/marked_resolved/ignored/auto_resolved
    // pra não atropelar trabalho humano em curso.
    await supa
      .from("closure_issues")
      .delete()
      .eq("salon_id", salonId)
      .eq("detected_date", startDate)
      .eq("status", "open");

    if (issues.length > 0) {
      await supa.from("closure_issues").insert(
        issues.map((issue) => ({
          salon_id: salonId,
          comanda_id: issue.comanda_id ?? null,
          professional_id: issue.professional_id ?? null,
          detected_date: startDate,
          issue_type: issue.type,
          severity: issue.severity,
          description: issue.description,
          expected_value: issue.expected_value ?? null,
          actual_value: issue.actual_value ?? null,
        }))
      );
    }
  }

  // 10) Comparações
  const yesterday = sevenDayHistory.find((h) => h.date === subDaysISO(startDate, 1));
  const sameWeekday = sevenDayHistory.filter((h) => sameDayOfWeek(h.date, startDate)).slice(0, 1)[0];

  const comparisons = {
    vs_yesterday: pctDiff(kpis.revenue.gross, yesterday?.revenue, kpis.bookings.count, yesterday?.bookings),
    vs_7d_avg: pctDiff(
      kpis.revenue.gross,
      kpis.seven_day_average.revenue,
      kpis.bookings.count,
      kpis.seven_day_average.bookings,
    ),
    vs_same_weekday: pctDiff(
      kpis.revenue.gross,
      sameWeekday?.revenue,
      kpis.bookings.count,
      sameWeekday?.bookings,
    ),
  };

  return {
    period: { start: startDate, end: endDate, days: daysBetween(startDate, endDate).length },
    kpis,
    issues,
    comparisons,
    markdown: renderMarkdown({ date: startDate, kpis, issues, pagbankUnavailable, asaasUnavailable }),
    html: renderHtml({ date: startDate, kpis, issues, pagbankUnavailable, asaasUnavailable }),
    pagbank_unavailable: pagbankUnavailable,
    asaas_unavailable: asaasUnavailable,
  };
}

// helpers ---------------------------------------------------------------------

// Banco usa "credit_card"/"debit_card", calculator+detector esperam "credit"/"debit".
// Normaliza no momento da carga pra ter UMA fonte da verdade pros nomes.
function normalizePaymentMethod(raw: unknown): string {
  const v = String(raw ?? "").toLowerCase().trim();
  if (v === "credit_card" || v === "credito" || v === "crédito") return "credit";
  if (v === "debit_card"  || v === "debito"  || v === "débito")  return "debit";
  return v; // pix, cash já estão corretos
}

// payment_provider pode vir null em payments antigos. Default 'manual'.
function normalizePaymentProvider(raw: unknown): "pagbank" | "asaas" | "manual" {
  const v = String(raw ?? "").toLowerCase().trim();
  if (v === "pagbank" || v === "asaas" || v === "manual") return v;
  return "manual";
}

function daysBetween(a: string, b: string): string[] {
  const out: string[] = [];
  const start = new Date(a + "T00:00:00Z");
  const end = new Date(b + "T00:00:00Z");
  for (const d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function subDaysISO(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function sameDayOfWeek(a: string, b: string): boolean {
  return new Date(a + "T00:00:00Z").getUTCDay() === new Date(b + "T00:00:00Z").getUTCDay();
}

function aggregateByDay(
  history: Array<{ closed_at: string | null; total: number | string; is_paid: boolean }>,
) {
  const map = new Map<string, { revenue: number; bookings: number }>();
  for (const c of history.filter((x) => x.is_paid && x.closed_at)) {
    const day = c.closed_at!.slice(0, 10);
    const agg = map.get(day) ?? { revenue: 0, bookings: 0 };
    agg.revenue += Number(c.total);
    agg.bookings += 1;
    map.set(day, agg);
  }
  return [...map.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

function pctDiff(
  currentR: number,
  prevR: number | undefined,
  currentB: number,
  prevB: number | undefined,
) {
  return {
    revenue_pct: prevR && prevR > 0 ? Math.round(((currentR - prevR) / prevR) * 100) : 0,
    bookings_pct: prevB && prevB > 0 ? Math.round(((currentB - prevB) / prevB) * 100) : 0,
  };
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}
