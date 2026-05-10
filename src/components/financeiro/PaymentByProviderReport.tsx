import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Wallet } from "lucide-react";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

const PROVIDER_LABELS: Record<string, string> = {
  pagbank: "PagBank",
  asaas: "Asaas",
  manual: "Manual",
};

const METHOD_LABELS: Record<string, string> = {
  cash: "Dinheiro",
  pix: "PIX",
  credit_card: "Cartão de crédito",
  debit_card: "Cartão de débito",
  voucher: "Voucher",
  transfer: "Transferência",
};

type PaymentRow = {
  payment_provider: string | null;
  payment_method: string | null;
  amount: number | null;
  fee_amount: number | null;
  net_amount: number | null;
  created_at: string;
};

type Row = {
  provider: string;
  method: string;
  count: number;
  gross: number;
  net: number;
  fees: number;
};

type ProviderGroup = {
  provider: string;
  rows: Row[];
  subtotal: Row;
};

export function PaymentByProviderReport() {
  const { salonId } = useAuth();

  const [dateStart, setDateStart] = useState(() =>
    format(startOfMonth(new Date()), "yyyy-MM-dd")
  );
  const [dateEnd, setDateEnd] = useState(() =>
    format(new Date(), "yyyy-MM-dd")
  );

  const { data: payments, isLoading } = useQuery<PaymentRow[]>({
    queryKey: ["payments-by-provider", salonId, dateStart, dateEnd],
    enabled: !!salonId && !!dateStart && !!dateEnd,
    queryFn: async () => {
      const from = `${dateStart}T00:00:00-03:00`;
      const to = `${dateEnd}T23:59:59-03:00`;
      const { data, error } = await supabase
        .from("payments")
        .select(
          "payment_provider, payment_method, amount, fee_amount, net_amount, created_at"
        )
        .gte("created_at", from)
        .lte("created_at", to);
      if (error) throw error;
      return (data ?? []) as PaymentRow[];
    },
  });

  const { groups, grandTotal } = useMemo(() => {
    const map = new Map<string, Row>();
    for (const p of payments ?? []) {
      const provider = p.payment_provider ?? "manual";
      const method = p.payment_method ?? "—";
      const key = `${provider}__${method}`;
      const row = map.get(key) ?? {
        provider,
        method,
        count: 0,
        gross: 0,
        net: 0,
        fees: 0,
      };
      const amount = Number(p.amount ?? 0);
      const fee = Number(p.fee_amount ?? 0);
      const net = p.net_amount != null ? Number(p.net_amount) : amount - fee;
      row.count += 1;
      row.gross += amount;
      row.fees += fee;
      row.net += net;
      map.set(key, row);
    }

    const providerOrder = ["pagbank", "asaas", "manual"];
    const byProvider = new Map<string, Row[]>();
    for (const row of map.values()) {
      const arr = byProvider.get(row.provider) ?? [];
      arr.push(row);
      byProvider.set(row.provider, arr);
    }

    const groups: ProviderGroup[] = [];
    const seen = new Set<string>();
    const pushGroup = (provider: string) => {
      const rows = byProvider.get(provider);
      if (!rows || rows.length === 0) return;
      seen.add(provider);
      rows.sort((a, b) =>
        (METHOD_LABELS[a.method] ?? a.method).localeCompare(
          METHOD_LABELS[b.method] ?? b.method
        )
      );
      const subtotal = rows.reduce<Row>(
        (acc, r) => ({
          provider,
          method: "TOTAL",
          count: acc.count + r.count,
          gross: acc.gross + r.gross,
          fees: acc.fees + r.fees,
          net: acc.net + r.net,
        }),
        { provider, method: "TOTAL", count: 0, gross: 0, fees: 0, net: 0 }
      );
      groups.push({ provider, rows, subtotal });
    };

    for (const p of providerOrder) pushGroup(p);
    // Any unexpected provider value goes after.
    for (const p of Array.from(byProvider.keys())) {
      if (!seen.has(p)) pushGroup(p);
    }

    const grandTotal: Row = groups.reduce<Row>(
      (acc, g) => ({
        provider: "TOTAL",
        method: "TOTAL",
        count: acc.count + g.subtotal.count,
        gross: acc.gross + g.subtotal.gross,
        fees: acc.fees + g.subtotal.fees,
        net: acc.net + g.subtotal.net,
      }),
      { provider: "TOTAL", method: "TOTAL", count: 0, gross: 0, fees: 0, net: 0 }
    );

    return { groups, grandTotal };
  }, [payments]);

  const totalCount = grandTotal.count;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold">Pagamentos por gateway</h2>
        </div>
        <Badge variant="outline" className="px-3">
          {totalCount} pagamento{totalCount !== 1 ? "s" : ""} no período
        </Badge>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="date-start">De</Label>
              <Input
                id="date-start"
                type="date"
                value={dateStart}
                onChange={(e) => setDateStart(e.target.value)}
                max={dateEnd}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="date-end">Até</Label>
              <Input
                id="date-end"
                type="date"
                value={dateEnd}
                onChange={(e) => setDateEnd(e.target.value)}
                min={dateStart}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Card>
          <CardContent className="py-10 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Nenhum pagamento encontrado no período selecionado.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Cards resumo por gateway */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {groups.map((g) => (
              <Card key={`card-${g.provider}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {PROVIDER_LABELS[g.provider] ?? g.provider}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold">
                    {formatCurrency(g.subtotal.net)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {g.subtotal.count} pagamento
                    {g.subtotal.count !== 1 ? "s" : ""} · bruto{" "}
                    {formatCurrency(g.subtotal.gross)}
                    {g.subtotal.fees > 0 && (
                      <> · taxa {formatCurrency(g.subtotal.fees)}</>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Tabela detalhada */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Detalhamento</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Gateway</TableHead>
                    <TableHead>Método</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                    <TableHead className="text-right">Bruto</TableHead>
                    <TableHead className="text-right">Taxa</TableHead>
                    <TableHead className="text-right">Líquido</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((g) => (
                    <ProviderBlock key={g.provider} group={g} />
                  ))}
                  <TableRow className="bg-primary/10 font-semibold border-t-2 border-primary">
                    <TableCell colSpan={2}>TOTAL GERAL</TableCell>
                    <TableCell className="text-right">
                      {grandTotal.count}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(grandTotal.gross)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(grandTotal.fees)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(grandTotal.net)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function ProviderBlock({ group }: { group: ProviderGroup }) {
  return (
    <>
      {group.rows.map((r, idx) => (
        <TableRow key={`${r.provider}-${r.method}-${idx}`}>
          <TableCell className="font-medium">
            {PROVIDER_LABELS[r.provider] ?? r.provider}
          </TableCell>
          <TableCell>{METHOD_LABELS[r.method] ?? r.method}</TableCell>
          <TableCell className="text-right tabular-nums">{r.count}</TableCell>
          <TableCell className="text-right tabular-nums">
            {formatCurrency(r.gross)}
          </TableCell>
          <TableCell className="text-right tabular-nums">
            {r.fees > 0 ? formatCurrency(r.fees) : "—"}
          </TableCell>
          <TableCell className="text-right tabular-nums">
            {formatCurrency(r.net)}
          </TableCell>
        </TableRow>
      ))}
      <TableRow className={cn("bg-muted/50 font-medium")}>
        <TableCell>
          Subtotal {PROVIDER_LABELS[group.provider] ?? group.provider}
        </TableCell>
        <TableCell />
        <TableCell className="text-right tabular-nums">
          {group.subtotal.count}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {formatCurrency(group.subtotal.gross)}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {formatCurrency(group.subtotal.fees)}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {formatCurrency(group.subtotal.net)}
        </TableCell>
      </TableRow>
    </>
  );
}
