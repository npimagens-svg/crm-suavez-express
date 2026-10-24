import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useSalonPermissions } from "@/hooks/useSalonPermissions";
import {
  DollarSign,
  Users,
  Megaphone,
  BarChart3,
  Settings,
  Scissors,
  Gift,
  ListOrdered,
  ClipboardCheck,
} from "lucide-react";

export interface NavItem {
  title: string;
  url: string;
  icon: React.ElementType;
  subItems?: { title: string; url: string }[];
}

// 29/09/2026 (auditoria D11): Agenda, Estoque, Clientes→Avisos, Marketing→Promoções/SMS saíram do menu.
// Rotas e código continuam; só não aparecem pra equipe.
export const navItems: NavItem[] = [
  {
    title: "Fila",
    url: "/fila-admin",
    icon: ListOrdered,
  },
  {
    title: "Financeiro", 
    url: "/financeiro", 
    icon: DollarSign,
    subItems: [
      { title: "Caixas Abertos", url: "/financeiro" },
      { title: "Clube da Escova", url: "/clube-admin" },
      { title: "Histórico de Caixas", url: "/financeiro/historico" },
      { title: "Comandas", url: "/comandas" },
      { title: "Comissões", url: "/financeiro/comissoes" },
      { title: "Contas a Pagar", url: "/financeiro/contas-a-pagar" },
      { title: "Entradas", url: "/financeiro/entradas" },
      { title: "Por gateway", url: "/financeiro/por-gateway" },
    ]
  },
  {
    title: "Serviços",
    url: "/servicos",
    icon: Scissors,
  },
  {
    title: "Pacotes",
    url: "/pacotes",
    icon: Gift,
  },
  {
    title: "Clientes",
    url: "/clientes",
    icon: Users,
  },
  {
    title: "Marketing",
    url: "/marketing",
    icon: Megaphone,
    subItems: [
      { title: "Campanhas de E-mail", url: "/marketing?tab=email" },
      { title: "Fidelidade", url: "/marketing?tab=fidelidade" },
    ]
  },
  {
    title: "Relatórios",
    url: "/relatorios",
    icon: BarChart3,
  },
  {
    title: "Fechamentos",
    url: "/fechamentos",
    icon: ClipboardCheck,
    subItems: [
      { title: "Diários", url: "/fechamentos" },
      { title: "Pendências", url: "/pendencias" },
    ],
  },
  {
    title: "Configurações",
    url: "/configuracoes",
    icon: Settings,
  },
];

// Lógica do menu (permissão + item ativo), compartilhada pela sidebar do AppShell (Fase A do redesign)
// e por esta barra antiga. Não mudar uma sem a outra.
export function useNavMenu() {
  const location = useLocation();
  const navigate = useNavigate();
  const { pode, isLoading: loadingPermissions } = useSalonPermissions();
  // Etapa 6: menu Financeiro só para quem tem financeiro.ver.
  // 30/09: quem não tem vê só "Comissões" (a própria), em vez de perder o acesso inteiro.
  const visibleNavItems = navItems.flatMap((item) => {
    if (item.url !== "/financeiro" || loadingPermissions || pode("financeiro.ver")) return [item];
    return [{ title: "Comissões", url: "/financeiro/comissoes", icon: item.icon }];
  });

  const activeNavItem = visibleNavItems.find(item => {
    if (location.pathname === item.url) return true;
    if (item.subItems) {
      return item.subItems.some(sub => {
        const subUrl = sub.url.split("?")[0];
        return location.pathname === subUrl || location.pathname.startsWith(subUrl + "/");
      });
    }
    return location.pathname.startsWith(item.url);
  });

  return { location, navigate, visibleNavItems, activeNavItem };
}

/** Sub-aba ativa: mesma regra que a barra antiga usava. */
export function isSubItemActive(location: { pathname: string; search: string }, subItem: { url: string }) {
  return location.pathname + location.search === subItem.url ||
    (subItem.url.includes("?") && location.pathname + location.search === subItem.url) ||
    (!subItem.url.includes("?") && location.pathname === subItem.url);
}

export function TopNavigation() {
  const { location, navigate, visibleNavItems, activeNavItem } = useNavMenu();

  return (
    <div className="border-b border-border bg-card">
      {/* Main Nav — Avec-style icons with text */}
      <nav className="flex items-center gap-0 px-2 md:px-4 py-1 overflow-x-auto scrollbar-hide md:justify-center">
        {visibleNavItems.map((item) => {
          const isActive = activeNavItem?.url === item.url;
          const Icon = item.icon;

          return (
            <button
              key={item.url}
              onClick={() => navigate(item.url)}
              className={cn(
                "flex flex-col items-center gap-0.5 px-3 md:px-5 py-2 transition-all duration-200 min-w-[56px] md:min-w-[76px] shrink-0 border-b-2",
                "hover:text-primary",
                isActive
                  ? "text-primary border-primary"
                  : "border-transparent text-muted-foreground"
              )}
            >
              <Icon className={cn(
                "h-5 w-5 md:h-6 md:w-6 transition-colors",
                isActive ? "text-primary" : "text-muted-foreground"
              )} />
              <span className={cn(
                "text-[10px] md:text-xs font-medium transition-colors whitespace-nowrap",
                isActive ? "text-primary" : "text-muted-foreground"
              )}>
                {item.title}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Sub-tabs — Avec-style clean text with underline */}
      {activeNavItem?.subItems && (
        <div className="flex items-center gap-1 px-4 md:px-6 border-t border-border overflow-x-auto scrollbar-hide">
          {activeNavItem.subItems.map((subItem) => {
            const isSubActive = isSubItemActive(location, subItem);

            return (
              <button
                key={subItem.url}
                onClick={() => navigate(subItem.url)}
                className={cn(
                  "px-3 md:px-4 py-2.5 text-xs md:text-sm font-medium transition-colors border-b-2 -mb-[1px] whitespace-nowrap shrink-0",
                  isSubActive
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {subItem.title}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
