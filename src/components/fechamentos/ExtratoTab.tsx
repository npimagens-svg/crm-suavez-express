// @ts-nocheck
import { useMemo, useState } from "react";
import { format, parseISO, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Wallet, Landmark, Inbox, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useExtrato } from "@/hooks/useExtrato";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const BRL = (n: number) =>
  `R$ ${Number(n ?? 0)
    .toFixed(2)
    .replace(".", ",")}`;

// PagBank ----------------------------------------------------------------------

// meio_pagamento: 3=Crédito, 8=Débito Maestro, 11=PIX, 15=Débito prepaid
function pbTipo(t: any): string {
  const arranjo = String(t?.arranjo_ur ?? "").toUpperCase();
  if (arranjo.includes("PIX")) return "PIX";
  if (arranjo.startsWith("CREDIT") || String(t?.meio_pagamento) === "3") return "Crédito";
  if (arranjo.startsWith("DEBIT") || ["8", "15"].includes(String(t?.meio_pagamento))) return "Débito";
  return arranjo || "—";
}

function pbDataHora(t: any): { data: string; hora: string } {
  // Edge devolve campos crus do EDI: data_venda_ajuste + hora_venda_ajuste (datetime da venda).
  // data_prevista_pagamento serve só como fallback (não tem hora).
  const data =
    t?.data_venda_ajuste ||
    t?.data_inicial_transacao ||
    t?.data_prevista_pagamento ||
    "";
  const horaRaw = t?.hora_venda_ajuste || t?.hora_inicial_transacao || "";
  const hora = String(horaRaw).slice(0, 8); // HH:MM:SS
  let dataFmt = "—";
  if (data) {
    try {
      dataFmt = format(parseISO(data), "dd/MM/yyyy");
    } catch {
      dataFmt = String(data);
    }
  }
  return { data: dataFmt, hora: hora || "—" };
}

function pbBandeiraLabel(arranjo: string): string {
  const a = String(arranjo ?? "").toUpperCase();
  if (a.includes("PIX")) return "PIX";
  return a.replace("CREDIT_", "").replace("DEBIT_", "");
}

// Asaas ------------------------------------------------------------------------

function asaasTipo(p: any): string {
  const t = String(p?.billingType ?? "").toUpperCase();
  if (t === "PIX") return "PIX";
  if (t === "CREDIT_CARD") return "Cartão crédito";
  if (t === "DEBIT_CARD") return "Cartão débito";
  if (t === "BOLETO") return "Boleto";
  return t || "—";
}

function asaasCliente(p: any): string {
  // Asaas description costuma ser "NP Hair Express - SERVIÇO" (sem nome).
  // Usa description se houver, senão fallback pra customer_id.
  if (p?.description) return String(p.description);
  if (p?.customer) return String(p.customer);
  return "—";
}

function asaasDataHora(p: any): { data: string; hora: string } {
  // Pra exibir "quando foi pago" usamos paymentDate/confirmedDate (se houver),
  // senão dateCreated. Asaas só dá data (sem hora), então hora fica "—".
  const data = p?.paymentDate || p?.confirmedDate || p?.dateCreated || "";
  let dataFmt = "—";
  if (data) {
    try {
      dataFmt = format(parseISO(data), "dd/MM/yyyy");
    } catch {
      dataFmt = String(data);
    }
  }
  return { data: dataFmt, hora: "—" };
}

function asaasStatusBadge(status: string) {
  const s = String(status ?? "").toUpperCase();
  if (s === "RECEIVED" || s === "CONFIRMED" || s === "RECEIVED_IN_CASH") {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-200 hover:bg-emerald-100">
        Pago
      </Badge>
    );
  }
  if (s === "PENDING") {
    return (
      <Badge className="bg-amber-100 text-amber-800 border border-amber-200 hover:bg-amber-100">
        Pendente
      </Badge>
    );
  }
  if (s === "OVERDUE") {
    return (
      <Badge className="bg-rose-100 text-rose-800 border border-rose-200 hover:bg-rose-100">
        Vencido
      </Badge>
    );
  }
  if (s === "REFUNDED") {
    return (
      <Badge className="bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-100">
        Estornado
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-slate-600">
      {s || "—"}
    </Badge>
  );
}

// Componente -------------------------------------------------------------------

export function ExtratoTab() {
  const { salonId } = useAuth();

  const today = format(new Date(), "yyyy-MM-dd");
  const firstDay = format(startOfMonth(new Date()), "yyyy-MM-dd");

  const [from, setFrom] = useState(firstDay);
  const [to, setTo] = useState(today);
  const [provider, setProvider] = useState<"pagbank" | "asaas">("pagbank");

  const { data, isLoading, error, refetch, isFetching } = useExtrato(salonId, from, to);

  const pagbank = data?.pagbank ?? [];
  const asaas = data?.asaas ?? [];

  // Resumos -------------------------------------------------------------------
  const pagbankResumo = useMemo(() => {
    const bruto = pagbank.reduce((s, t: any) => s + Number(t.valor_total_transacao ?? 0), 0);
    const taxa = pagbank.reduce((s, t: any) => s + Number(t.taxa_intermediacao ?? 0), 0);
    const liquido = pagbank.reduce((s, t: any) => s + Number(t.valor_liquido_transacao ?? 0), 0);
    return { count: pagbank.length, bruto, taxa, liquido };
  }, [pagbank]);

  const asaasResumo = useMemo(() => {
    let received = 0;
    let receivedCount = 0;
    let pending = 0;
    let pendingCount = 0;
    let overdue = 0;
    let overdueCount = 0;
    for (const p of asaas as any[]) {
      const s = String(p.status ?? "").toUpperCase();
      const v = Number(p.value ?? 0);
      if (s === "RECEIVED" || s === "CONFIRMED" || s === "RECEIVED_IN_CASH") {
        received += v;
        receivedCount += 1;
      } else if (s === "PENDING") {
        pending += v;
        pendingCount += 1;
      } else if (s === "OVERDUE") {
        overdue += v;
        overdueCount += 1;
      }
    }
    return {
      count: asaas.length,
      received,
      receivedCount,
      pending,
      pendingCount,
      overdue,
      overdueCount,
    };
  }, [asaas]);

  // Ordenação por data desc -- mostra recente primeiro
  const pagbankSorted = useMemo(() => {
    return [...pagbank].sort((a: any, b: any) => {
      const ka = `${a.data_venda_ajuste ?? a.data_inicial_transacao ?? ""} ${a.hora_venda_ajuste ?? a.hora_inicial_transacao ?? ""}`;
      const kb = `${b.data_venda_ajuste ?? b.data_inicial_transacao ?? ""} ${b.hora_venda_ajuste ?? b.hora_inicial_transacao ?? ""}`;
      return kb.localeCompare(ka);
    });
  }, [pagbank]);

  const asaasSorted = useMemo(() => {
    return [...asaas].sort((a: any, b: any) => {
      const ka = a.paymentDate || a.confirmedDate || a.dateCreated || "";
      const kb = b.paymentDate || b.confirmedDate || b.dateCreated || "";
      return String(kb).localeCompare(String(ka));
    });
  }, [asaas]);

  // --------------------------------------------------------------------------

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 p-4 border rounded-lg bg-white">
        <div className="flex-1">
          <label className="text-xs font-medium text-slate-600 mb-1 block">De</label>
          <Input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="flex-1">
          <label className="text-xs font-medium text-slate-600 mb-1 block">Até</label>
          <Input
            type="date"
            value={to}
            min={from}
            max={today}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-md border bg-slate-50 hover:bg-slate-100 text-sm font-medium disabled:opacity-50"
        >
          <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
          Atualizar
        </button>
      </div>

      {/* Provider toggle */}
      <Tabs value={provider} onValueChange={(v) => setProvider(v as any)}>
        <TabsList className="grid grid-cols-2 w-full sm:w-80">
          <TabsTrigger value="pagbank" className="gap-2">
            <Landmark size={16} /> PagBank
          </TabsTrigger>
          <TabsTrigger value="asaas" className="gap-2">
            <Wallet size={16} /> Asaas
          </TabsTrigger>
        </TabsList>

        {/* Error / loading */}
        {error && (
          <div className="mt-4 p-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded">
            Erro ao carregar extrato: {String((error as any)?.message ?? error)}
          </div>
        )}
        {isLoading && (
          <div className="mt-4 p-6 text-center text-slate-500 border rounded">
            Carregando transações…
          </div>
        )}

        {/* PagBank -------------------------------------------------------- */}
        <TabsContent value="pagbank" className="space-y-4">
          {!isLoading && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-slate-500">Transações</div>
                    <div className="text-2xl font-semibold">{pagbankResumo.count}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-slate-500">Bruto</div>
                    <div className="text-2xl font-semibold">{BRL(pagbankResumo.bruto)}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-slate-500">Taxa total</div>
                    <div className="text-2xl font-semibold text-rose-700">
                      {BRL(pagbankResumo.taxa)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-slate-500">Líquido</div>
                    <div className="text-2xl font-semibold text-emerald-700">
                      {BRL(pagbankResumo.liquido)}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {pagbankSorted.length === 0 ? (
                <div className="p-8 text-center text-slate-500 border rounded-lg flex flex-col items-center gap-2">
                  <Inbox className="text-slate-300" size={40} />
                  <div className="font-medium">Sem transações PagBank nesse período</div>
                  <div className="text-xs">
                    Tente mudar o intervalo de datas ou aguarde o cron das 7h.
                  </div>
                </div>
              ) : (
                <div className="border rounded-lg overflow-x-auto bg-white">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                      <tr>
                        <th className="text-left p-3 font-medium">Data</th>
                        <th className="text-left p-3 font-medium">Hora</th>
                        <th className="text-left p-3 font-medium">Bandeira</th>
                        <th className="text-left p-3 font-medium">Tipo</th>
                        <th className="text-right p-3 font-medium">Bruto</th>
                        <th className="text-right p-3 font-medium">Taxa</th>
                        <th className="text-right p-3 font-medium">Líquido</th>
                        <th className="text-right p-3 font-medium">Parcelas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagbankSorted.map((t: any, idx: number) => {
                        const { data, hora } = pbDataHora(t);
                        const parcelas =
                          Number(t.quantidade_parcelas ?? 0) > 0
                            ? `${t.quantidade_parcelas}x`
                            : "à vista";
                        return (
                          <tr
                            key={`${t.codigo_transacao ?? t.tid ?? idx}`}
                            className="border-t hover:bg-slate-50"
                          >
                            <td className="p-3">{data}</td>
                            <td className="p-3 tabular-nums">{hora}</td>
                            <td className="p-3 font-medium">
                              {pbBandeiraLabel(t.arranjo_ur)}
                            </td>
                            <td className="p-3 text-slate-600">{pbTipo(t)}</td>
                            <td className="p-3 text-right tabular-nums">
                              {BRL(Number(t.valor_total_transacao))}
                            </td>
                            <td className="p-3 text-right tabular-nums text-rose-700">
                              {BRL(Number(t.taxa_intermediacao))}
                            </td>
                            <td className="p-3 text-right tabular-nums text-emerald-700 font-medium">
                              {BRL(Number(t.valor_liquido_transacao))}
                            </td>
                            <td className="p-3 text-right text-slate-600">{parcelas}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* Asaas ---------------------------------------------------------- */}
        <TabsContent value="asaas" className="space-y-4">
          {!isLoading && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-slate-500">Cobranças</div>
                    <div className="text-2xl font-semibold">{asaasResumo.count}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-slate-500">
                      Pagas ({asaasResumo.receivedCount})
                    </div>
                    <div className="text-2xl font-semibold text-emerald-700">
                      {BRL(asaasResumo.received)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-slate-500">
                      Pendentes ({asaasResumo.pendingCount})
                    </div>
                    <div className="text-2xl font-semibold text-amber-700">
                      {BRL(asaasResumo.pending)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-slate-500">
                      Vencidas ({asaasResumo.overdueCount})
                    </div>
                    <div className="text-2xl font-semibold text-rose-700">
                      {BRL(asaasResumo.overdue)}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {asaasSorted.length === 0 ? (
                <div className="p-8 text-center text-slate-500 border rounded-lg flex flex-col items-center gap-2">
                  <Inbox className="text-slate-300" size={40} />
                  <div className="font-medium">Sem cobranças Asaas nesse período</div>
                  <div className="text-xs">Ajuste o intervalo de datas e tente novamente.</div>
                </div>
              ) : (
                <div className="border rounded-lg overflow-x-auto bg-white">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                      <tr>
                        <th className="text-left p-3 font-medium">Data</th>
                        <th className="text-left p-3 font-medium">Cliente / Descrição</th>
                        <th className="text-left p-3 font-medium">Tipo</th>
                        <th className="text-right p-3 font-medium">Valor</th>
                        <th className="text-right p-3 font-medium">Líquido</th>
                        <th className="text-center p-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {asaasSorted.map((p: any) => {
                        const { data } = asaasDataHora(p);
                        return (
                          <tr key={p.id} className="border-t hover:bg-slate-50">
                            <td className="p-3 whitespace-nowrap">{data}</td>
                            <td className="p-3 text-slate-700 max-w-xs truncate">
                              {asaasCliente(p)}
                            </td>
                            <td className="p-3 text-slate-600 whitespace-nowrap">
                              {asaasTipo(p)}
                            </td>
                            <td className="p-3 text-right tabular-nums">
                              {BRL(Number(p.value))}
                            </td>
                            <td className="p-3 text-right tabular-nums text-emerald-700">
                              {BRL(Number(p.netValue ?? p.value))}
                            </td>
                            <td className="p-3 text-center">{asaasStatusBadge(p.status)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
