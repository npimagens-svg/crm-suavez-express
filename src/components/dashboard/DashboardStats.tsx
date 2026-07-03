import { DollarSign, Users, Calendar, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { Sensitive } from "@/components/common/SensitiveData";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { useQuery } from "@tanstack/react-query";

interface StatCardProps {
  title: string;
  value: string;
  change: number;
  changeLabel: string;
  icon: React.ReactNode;
  loading?: boolean;
  sensitive?: boolean;
}

function StatCard({ title, value, change, changeLabel, icon, loading, sensitive }: StatCardProps) {
  const isPositive = change > 0;
  const isNeutral = change === 0;

  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-4 md:p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1 md:space-y-2 min-w-0 flex-1">
            <p className="text-xs md:text-sm font-medium text-muted-foreground truncate">{title}</p>
            {loading ? (
              <div className="h-7 md:h-8 w-20 md:w-24 animate-pulse rounded bg-muted" />
            ) : (
              <p className="text-xl md:text-2xl font-bold tracking-tight truncate">
                {sensitive ? <Sensitive>{value}</Sensitive> : value}
              </p>
            )}
            <div className="flex items-center gap-1 text-xs md:text-sm">
              {isNeutral ? (
                <Minus className="h-3 w-3 md:h-4 md:w-4 text-muted-foreground" />
              ) : isPositive ? (
                <TrendingUp className="h-3 w-3 md:h-4 md:w-4 text-success" />
              ) : (
                <TrendingDown className="h-3 w-3 md:h-4 md:w-4 text-destructive" />
              )}
              <span className={isNeutral ? "text-muted-foreground" : isPositive ? "text-success" : "text-destructive"}>
                {isPositive && "+"}{change}%
              </span>
              <span className="text-muted-foreground hidden sm:inline">{changeLabel}</span>
            </div>
          </div>
          <div className="flex h-9 w-9 md:h-12 md:w-12 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0 ml-2">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function calcChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

interface DashboardStatsProps {
  professionalId?: string | null;
}

export function DashboardStats({ professionalId }: DashboardStatsProps) {
  const { salonId } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-stats", salonId, professionalId],
    queryFn: async () => {
      if (!salonId) return null;

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
      const lastMonthEnd = monthStart;

      if (professionalId) {
        // Professional-specific stats: use comanda_items filtered by professional_id
        const { data: monthItems } = await supabase
          .from("comanda_items")
          .select("total_price, comanda_id")
          .eq("professional_id", professionalId)
          .gte("created_at", monthStart)
          .lt("created_at", monthEnd);

        const monthRevenue = monthItems?.reduce((s, i) => s + (i.total_price || 0), 0) ?? 0;

        const { data: lastMonthItems } = await supabase
          .from("comanda_items")
          .select("total_price, comanda_id")
          .eq("professional_id", professionalId)
          .gte("created_at", lastMonthStart)
          .lt("created_at", lastMonthEnd);

        const lastMonthRevenue = lastMonthItems?.reduce((s, i) => s + (i.total_price || 0), 0) ?? 0;

        // Appointments count
        const { count: monthAppts } = await supabase
          .from("appointments")
          .select("id", { count: "exact", head: true })
          .eq("salon_id", salonId)
          .eq("professional_id", professionalId)
          .gte("scheduled_at", monthStart)
          .lt("scheduled_at", monthEnd);

        const { count: lastMonthAppts } = await supabase
          .from("appointments")
          .select("id", { count: "exact", head: true })
          .eq("salon_id", salonId)
          .eq("professional_id", professionalId)
          .gte("scheduled_at", lastMonthStart)
          .lt("scheduled_at", lastMonthEnd);

        // Ticket (unique comandas)
        const uniqueComandaIds = new Set(monthItems?.map(i => i.comanda_id) ?? []);
        const monthCount = uniqueComandaIds.size;
        const monthTicket = monthCount > 0 ? monthRevenue / monthCount : 0;

        const lastUniqueComandaIds = new Set(lastMonthItems?.map(i => i.comanda_id) ?? []);
        const lastMonthCount = lastUniqueComandaIds.size;
        const lastMonthTicket = lastMonthCount > 0 ? lastMonthRevenue / lastMonthCount : 0;

        // Clients attended this month (from appointments)
        const { data: monthClientAppts } = await supabase
          .from("appointments")
          .select("client_id")
          .eq("salon_id", salonId)
          .eq("professional_id", professionalId)
          .gte("scheduled_at", monthStart)
          .lt("scheduled_at", monthEnd)
          .not("client_id", "is", null);

        const uniqueClients = new Set(monthClientAppts?.map(a => a.client_id) ?? []);

        const { data: lastMonthClientAppts } = await supabase
          .from("appointments")
          .select("client_id")
          .eq("salon_id", salonId)
          .eq("professional_id", professionalId)
          .gte("scheduled_at", lastMonthStart)
          .lt("scheduled_at", lastMonthEnd)
          .not("client_id", "is", null);

        const lastUniqueClients = new Set(lastMonthClientAppts?.map(a => a.client_id) ?? []);

        return {
          monthRevenue,
          revenueChange: calcChange(monthRevenue, lastMonthRevenue),
          monthAppts: monthAppts ?? 0,
          apptsChange: calcChange(monthAppts ?? 0, lastMonthAppts ?? 0),
          monthTicket,
          ticketChange: calcChange(monthTicket, lastMonthTicket),
          newClients: uniqueClients.size,
          clientsChange: calcChange(uniqueClients.size, lastUniqueClients.size),
        };
      }

      // Salon-wide stats (original logic)
      const { data: monthCom } = await supabase
        .from("comandas")
        .select("total")
        .eq("salon_id", salonId)
        .gte("closed_at", monthStart)
        .lt("closed_at", monthEnd)
        .eq("is_paid", true);

      const monthRevenue = monthCom?.reduce((s, c) => s + (c.total || 0), 0) ?? 0;

      const { data: lastMonthCom } = await supabase
        .from("comandas")
        .select("total")
        .eq("salon_id", salonId)
        .gte("closed_at", lastMonthStart)
        .lt("closed_at", lastMonthEnd)
        .eq("is_paid", true);

      const lastMonthRevenue = lastMonthCom?.reduce((s, c) => s + (c.total || 0), 0) ?? 0;

      const { count: monthAppts } = await supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("salon_id", salonId)
        .gte("scheduled_at", monthStart)
        .lt("scheduled_at", monthEnd);

      const { count: lastMonthAppts } = await supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("salon_id", salonId)
        .gte("scheduled_at", lastMonthStart)
        .lt("scheduled_at", lastMonthEnd);

      const monthCount = monthCom?.length ?? 0;
      const monthTicket = monthCount > 0 ? monthRevenue / monthCount : 0;

      const lastMonthCount = lastMonthCom?.length ?? 0;
      const lastMonthTicket = lastMonthCount > 0 ? lastMonthRevenue / lastMonthCount : 0;

      const { count: newClientsMonth } = await supabase
        .from("clients")
        .select("id", { count: "exact", head: true })
        .eq("salon_id", salonId)
        .gte("created_at", monthStart)
        .lt("created_at", monthEnd);

      const { count: newClientsLastMonth } = await supabase
        .from("clients")
        .select("id", { count: "exact", head: true })
        .eq("salon_id", salonId)
        .gte("created_at", lastMonthStart)
        .lt("created_at", lastMonthEnd);

      return {
        monthRevenue,
        revenueChange: calcChange(monthRevenue, lastMonthRevenue),
        monthAppts: monthAppts ?? 0,
        apptsChange: calcChange(monthAppts ?? 0, lastMonthAppts ?? 0),
        monthTicket,
        ticketChange: calcChange(monthTicket, lastMonthTicket),
        newClients: newClientsMonth ?? 0,
        clientsChange: calcChange(newClientsMonth ?? 0, newClientsLastMonth ?? 0),
      };
    },
    enabled: !!salonId,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const isProfessional = !!professionalId;

  const stats = [
    {
      title: isProfessional ? "Meu Faturamento" : "Faturamento do Mês",
      value: formatCurrency(data?.monthRevenue ?? 0),
      change: data?.revenueChange ?? 0,
      changeLabel: "vs mês anterior",
      icon: <DollarSign className="h-5 w-5 md:h-6 md:w-6" />,
      sensitive: true,
    },
    {
      title: isProfessional ? "Meus Atendimentos" : "Atendimentos do Mês",
      value: String(data?.monthAppts ?? 0),
      change: data?.apptsChange ?? 0,
      changeLabel: "vs mês anterior",
      icon: <Calendar className="h-5 w-5 md:h-6 md:w-6" />,
    },
    {
      title: "Ticket Médio",
      value: formatCurrency(data?.monthTicket ?? 0),
      change: data?.ticketChange ?? 0,
      changeLabel: "vs mês anterior",
      icon: <TrendingUp className="h-5 w-5 md:h-6 md:w-6" />,
      sensitive: true,
    },
    {
      title: isProfessional ? "Clientes Atendidos" : "Novos Clientes",
      value: String(data?.newClients ?? 0),
      change: data?.clientsChange ?? 0,
      changeLabel: "vs mês anterior",
      icon: <Users className="h-5 w-5 md:h-6 md:w-6" />,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
      {stats.map((stat) => (
        <StatCard key={stat.title} {...stat} loading={isLoading} />
      ))}
    </div>
  );
}
