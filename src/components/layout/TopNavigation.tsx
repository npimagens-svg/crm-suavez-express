import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  Calendar,
  DollarSign,
  Package,
  Users,
  Megaphone,
  BarChart3,
  Settings,
  Scissors,
  Gift,
  ListOrdered,
  ClipboardCheck,
} from "lucide-react";

interface NavItem {
  title: string;
  url: string;
  icon: React.ElementType;
  subItems?: { title: string; url: string }[];
}

const navItems: NavItem[] = [
  {
    title: "Agenda",
    url: "/agenda",
    icon: Calendar,
  },
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
      { title: "Histórico de Caixas", url: "/financeiro/historico" },
      { title: "Comandas", url: "/comandas" },
      { title: "Comissões", url: "/financeiro/comissoes" },
    ]
  },
  { 
    title: "Estoque", 
    url: "/estoque", 
    icon: Package,
    subItems: [
      { title: "Produtos", url: "/estoque" },
      { title: "Fornecedores", url: "/estoque/fornecedores" },
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
    subItems: [
      { title: "Lista de Clientes", url: "/clientes" },
      { title: "Avisos", url: "/clientes/avisos" },
    ]
  },
  {
    title: "Marketing",
    url: "/marketing",
    icon: Megaphone,
    subItems: [
      { title: "Promoções", url: "/marketing?tab=promocoes" },
      { title: "Campanhas de E-mail", url: "/marketing?tab=email" },
      { title: "Campanhas de SMS", url: "/marketing?tab=sms" },
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

export function TopNavigation() {
  const location = useLocation();
  const navigate = useNavigate();

  const activeNavItem = navItems.find(item => {
    if (location.pathname === item.url) return true;
    if (item.subItems) {
      return item.subItems.some(sub => {
        const subUrl = sub.url.split("?")[0];
        return location.pathname === subUrl || location.pathname.startsWith(subUrl + "/");
      });
    }
    return location.pathname.startsWith(item.url);
  });

  return (
    <div className="border-b border-border bg-card">
      {/* Main Nav — Avec-style icons with text */}
      <nav className="flex items-center gap-0 px-2 md:px-4 py-1 overflow-x-auto scrollbar-hide md:justify-center">
        {navItems.map((item) => {
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
            const isSubActive = location.pathname + location.search === subItem.url ||
              (subItem.url.includes("?") && location.pathname + location.search === subItem.url) ||
              (!subItem.url.includes("?") && location.pathname === subItem.url);

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
