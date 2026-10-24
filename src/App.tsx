// @ts-nocheck
import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useLayoutEffect } from "react";
import { NpThemeProvider } from "@design-system";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { SensitiveDataProvider } from "@/components/common/SensitiveData";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { useQuery } from "@tanstack/react-query";
// Estáticas (primeiro paint): login, dashboard, terminal da equipe e rotas públicas da fila/clube.
import Dashboard from "./pages/Dashboard";
import AuthNew from "./pages/AuthNew";
import AuthNovaSenha from "./pages/AuthNovaSenha";
import AtendimentoTerminal from "./pages/AtendimentoTerminal";
import FilaPublica from "@/pages/FilaPublica";
import ClubeEscova from "@/pages/ClubeEscova";
import FilaComprar from "@/pages/FilaComprar";
import FilaAcompanhar from "@/pages/FilaAcompanhar";
// Demais páginas: chunk próprio, carregado só quando a rota abre.
const Agenda = lazy(() => import("./pages/Agenda"));
const Clientes = lazy(() => import("./pages/Clientes"));
const Servicos = lazy(() => import("./pages/Servicos"));
const Pacotes = lazy(() => import("./pages/Pacotes"));
const Profissionais = lazy(() => import("./pages/Profissionais").then((m) => ({ default: m.Profissionais })));
const Comandas = lazy(() => import("./pages/Comandas"));
const Financeiro = lazy(() => import("./pages/Financeiro"));
const Comissoes = lazy(() => import("./pages/Comissoes"));
const Estoque = lazy(() => import("./pages/Estoque"));
const Configuracoes = lazy(() => import("./pages/Configuracoes"));
const Relatorios = lazy(() => import("./pages/Relatorios"));
const Marketing = lazy(() => import("./pages/Marketing"));
const ClientAlerts = lazy(() => import("./pages/ClientAlerts"));
const ClientLoyalty = lazy(() => import("./pages/ClientLoyalty"));
const NotFound = lazy(() => import("./pages/NotFound"));
const SetupWizard = lazy(() => import("./pages/SetupWizard"));
const Fila = lazy(() => import("@/pages/Fila"));
const ClubeAdmin = lazy(() => import("./pages/ClubeAdmin"));
const Pendencias = lazy(() => import("@/pages/Pendencias"));
const Fechamentos = lazy(() => import("@/pages/Fechamentos"));
const ContasAPagar = lazy(() => import("@/pages/ContasAPagar"));
const Entradas = lazy(() => import("@/pages/Entradas"));
// Vitrine do design system (redesign): fora do menu, sem gate nesta branch.
const DesignSystemShowcase = lazy(() => import("@/pages/DesignSystemShowcase"));

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } },
});

// Mesmo spinner usado nas checagens de auth/setup abaixo.
const PageSpinner = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
  </div>
);

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  if (!user) return <Navigate to="/auth" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { user, loading, userRole, recoveryMode } = useAuth();
  // Profissional loga e cai DIRETO no terminal de atendimento (mobile), não na Dashboard.
  const homeElement = userRole === "professional"
    ? <Navigate to="/atendimento" replace />
    : <Dashboard />;

  // If wizard was permanently disabled after setup (baked into build via Vercel env var)
  const installerDisabled = import.meta.env.VITE_INSTALLER_ENABLED === "false";

  // Check if Supabase is configured (env vars OR localStorage credentials from wizard)
  const hasEnvConfig = Boolean(
    import.meta.env.VITE_SUPABASE_URL &&
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY &&
    import.meta.env.VITE_SUPABASE_URL !== "https://placeholder.supabase.co" &&
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY !== "placeholder"
  );
  const hasLocalConfig = (() => {
    try { return Boolean(localStorage.getItem("ext_supabase_url") && localStorage.getItem("ext_supabase_anon_key")); }
    catch { return false; }
  })();
  const supabaseConfigured = hasEnvConfig || hasLocalConfig;

  // Check if setup has been done via SECURITY DEFINER function (bypasses RLS)
  const { data: hasSalon, isLoading: checkingSalon } = useQuery({
    queryKey: ["setup-check"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_setup_done");
      if (error) return true; // assume setup done on error
      return data === true;
    },
    staleTime: 60000,
    enabled: supabaseConfigured && !installerDisabled,
  });

  // Rotas PÚBLICAS (bio, anúncio, QR da fila): respondem SEMPRE, antes de
  // qualquer checagem de instalação — visitante anônimo não tem config no
  // navegador e NUNCA pode cair no instalador.
  const publicPathname = window.location.pathname;
  // Vitrine do design system: só a biblioteca, sem dado do salão; responde antes das checagens.
  if (publicPathname === "/design-system") {
    return (
      <Routes>
        <Route path="/design-system" element={<DesignSystemShowcase />} />
      </Routes>
    );
  }
  const isPublicPath =
    publicPathname === "/clube-escova" ||
    publicPathname === "/fila" ||
    publicPathname.startsWith("/fila/");
  if (isPublicPath) {
    return (
      <Routes>
        <Route path="/fila" element={<FilaPublica />} />
        <Route path="/clube-escova" element={<ClubeEscova />} />
        <Route path="/fila/comprar" element={<FilaComprar />} />
        <Route path="/fila/acompanhar/:id" element={<FilaAcompanhar />} />
        <Route path="*" element={<Navigate to="/fila" replace />} />
      </Routes>
    );
  }

  // If installer was permanently disabled after first setup, skip all checks
  if (installerDisabled) {
    if (loading) return <div className="flex items-center justify-center min-h-screen"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
    return (
      <Routes>
        <Route path="/setup" element={<Navigate to="/auth" replace />} />
        <Route path="/auth" element={user ? <Navigate to={recoveryMode ? "/auth/nova-senha" : "/"} replace /> : <AuthNew />} />
        <Route path="/auth/nova-senha" element={<AuthNovaSenha />} />
        <Route path="/" element={<ProtectedRoute>{homeElement}</ProtectedRoute>} />
        <Route path="/agenda" element={<ProtectedRoute><Agenda /></ProtectedRoute>} />
        <Route path="/agenda/*" element={<ProtectedRoute><Agenda /></ProtectedRoute>} />
        <Route path="/clientes" element={<ProtectedRoute><Clientes /></ProtectedRoute>} />
        <Route path="/clientes/avisos" element={<ProtectedRoute><ClientAlerts /></ProtectedRoute>} />
        <Route path="/clientes/fidelidade" element={<ProtectedRoute><ClientLoyalty /></ProtectedRoute>} />
        <Route path="/clientes/*" element={<ProtectedRoute><Clientes /></ProtectedRoute>} />
        <Route path="/servicos" element={<ProtectedRoute><Servicos /></ProtectedRoute>} />
        <Route path="/pacotes" element={<ProtectedRoute><Pacotes /></ProtectedRoute>} />
        <Route path="/profissionais" element={<ProtectedRoute><Profissionais /></ProtectedRoute>} />
        <Route path="/comandas" element={<ProtectedRoute><Comandas /></ProtectedRoute>} />
        <Route path="/comandas/*" element={<ProtectedRoute><Comandas /></ProtectedRoute>} />
        <Route path="/atendimento" element={<ProtectedRoute><AtendimentoTerminal /></ProtectedRoute>} />
        <Route path="/financeiro" element={<ProtectedRoute><Financeiro /></ProtectedRoute>} />
        <Route path="/clube-admin" element={<ProtectedRoute><ClubeAdmin /></ProtectedRoute>} />
        <Route path="/financeiro/*" element={<ProtectedRoute><Financeiro /></ProtectedRoute>} />
        <Route path="/comissoes" element={<ProtectedRoute><Comissoes /></ProtectedRoute>} />
        <Route path="/financeiro/comissoes" element={<ProtectedRoute><Comissoes /></ProtectedRoute>} />
        <Route path="/financeiro/contas-a-pagar" element={<ProtectedRoute><ContasAPagar /></ProtectedRoute>} />
        <Route path="/financeiro/entradas" element={<ProtectedRoute><Entradas /></ProtectedRoute>} />
        <Route path="/estoque" element={<ProtectedRoute><Estoque /></ProtectedRoute>} />
        <Route path="/estoque/*" element={<ProtectedRoute><Estoque /></ProtectedRoute>} />
        <Route path="/marketing" element={<ProtectedRoute><Marketing /></ProtectedRoute>} />
        <Route path="/marketing/*" element={<ProtectedRoute><Marketing /></ProtectedRoute>} />
        <Route path="/relatorios" element={<ProtectedRoute><Relatorios /></ProtectedRoute>} />
        <Route path="/relatorios/*" element={<ProtectedRoute><Relatorios /></ProtectedRoute>} />
        <Route path="/configuracoes" element={<ProtectedRoute><Configuracoes /></ProtectedRoute>} />
        <Route path="/configuracoes/*" element={<ProtectedRoute><Configuracoes /></ProtectedRoute>} />
        <Route path="/fila-admin" element={<ProtectedRoute><Fila /></ProtectedRoute>} />
        <Route path="/fila" element={<FilaPublica />} />
        <Route path="/clube-escova" element={<ClubeEscova />} />
        <Route path="/fila/comprar" element={<FilaComprar />} />
        <Route path="/fila/acompanhar/:id" element={<FilaAcompanhar />} />
        <Route path="/pendencias" element={<ProtectedRoute><Pendencias /></ProtectedRoute>} />
        <Route path="/fechamentos" element={<ProtectedRoute><Fechamentos /></ProtectedRoute>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    );
  }

  // If Supabase is not configured, go to setup wizard
  if (!supabaseConfigured) {
    return (
      <Routes>
        <Route path="/setup" element={<SetupWizard />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  if (loading || checkingSalon)
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );

  // If no salon exists, force setup wizard
  if (!hasSalon && !user) {
    return (
      <Routes>
        <Route path="/setup" element={<SetupWizard />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/setup" element={<SetupWizard />} />
      <Route path="/auth" element={user ? <Navigate to={recoveryMode ? "/auth/nova-senha" : "/"} replace /> : <AuthNew />} />
      <Route path="/auth/nova-senha" element={<AuthNovaSenha />} />
      <Route path="/" element={<ProtectedRoute>{homeElement}</ProtectedRoute>} />
      <Route path="/agenda" element={<ProtectedRoute><Agenda /></ProtectedRoute>} />
      <Route path="/agenda/*" element={<ProtectedRoute><Agenda /></ProtectedRoute>} />
      <Route path="/clientes" element={<ProtectedRoute><Clientes /></ProtectedRoute>} />
      <Route path="/clientes/avisos" element={<ProtectedRoute><ClientAlerts /></ProtectedRoute>} />
      <Route path="/clientes/fidelidade" element={<ProtectedRoute><ClientLoyalty /></ProtectedRoute>} />
      <Route path="/clientes/*" element={<ProtectedRoute><Clientes /></ProtectedRoute>} />
      <Route path="/servicos" element={<ProtectedRoute><Servicos /></ProtectedRoute>} />
      <Route path="/profissionais" element={<ProtectedRoute><Profissionais /></ProtectedRoute>} />
      <Route path="/comandas" element={<ProtectedRoute><Comandas /></ProtectedRoute>} />
      <Route path="/comandas/*" element={<ProtectedRoute><Comandas /></ProtectedRoute>} />
      <Route path="/atendimento" element={<ProtectedRoute><AtendimentoTerminal /></ProtectedRoute>} />
      <Route path="/financeiro" element={<ProtectedRoute><Financeiro /></ProtectedRoute>} />
      <Route path="/financeiro/*" element={<ProtectedRoute><Financeiro /></ProtectedRoute>} />
      <Route path="/comissoes" element={<ProtectedRoute><Comissoes /></ProtectedRoute>} />
      <Route path="/financeiro/comissoes" element={<ProtectedRoute><Comissoes /></ProtectedRoute>} />
      <Route path="/financeiro/contas-a-pagar" element={<ProtectedRoute><ContasAPagar /></ProtectedRoute>} />
      <Route path="/financeiro/entradas" element={<ProtectedRoute><Entradas /></ProtectedRoute>} />
      <Route path="/estoque" element={<ProtectedRoute><Estoque /></ProtectedRoute>} />
      <Route path="/estoque/*" element={<ProtectedRoute><Estoque /></ProtectedRoute>} />
      <Route path="/marketing" element={<ProtectedRoute><Marketing /></ProtectedRoute>} />
      <Route path="/marketing/*" element={<ProtectedRoute><Marketing /></ProtectedRoute>} />
      <Route path="/relatorios" element={<ProtectedRoute><Relatorios /></ProtectedRoute>} />
      <Route path="/relatorios/*" element={<ProtectedRoute><Relatorios /></ProtectedRoute>} />
      <Route path="/configuracoes" element={<ProtectedRoute><Configuracoes /></ProtectedRoute>} />
      <Route path="/configuracoes/*" element={<ProtectedRoute><Configuracoes /></ProtectedRoute>} />
      <Route path="/fila-admin" element={<ProtectedRoute><Fila /></ProtectedRoute>} />
      <Route path="/fila" element={<FilaPublica />} />
      <Route path="/fila/comprar" element={<FilaComprar />} />
      <Route path="/fila/acompanhar/:id" element={<FilaAcompanhar />} />
      <Route path="/pendencias" element={<ProtectedRoute><Pendencias /></ProtectedRoute>} />
      <Route path="/fechamentos" element={<ProtectedRoute><Fechamentos /></ProtectedRoute>} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

// Fase A do redesign (30/09): tema do design system no app inteiro (escuro padrão, interruptor
// "acender/apagar a luz", localStorage "np-theme"). Páginas públicas da fila/clube e o terminal da
// profissional ficam ISOLADOS: tema claro fixo + classe np-legacy no <html>, que devolve as
// variáveis antigas do shadcn (src/index.css), então elas continuam exatamente como eram.
function isLegacyThemePath(pathname: string) {
  return pathname === "/setup";
}

// Fase B (01/10): fila pública, página do Clube e terminal da profissional já estão no design
// system, sempre no tema escuro (preto + âmbar), independente do interruptor.
function isFixedDarkPath(pathname: string) {
  return (
    pathname === "/fila" ||
    pathname.startsWith("/fila/") ||
    pathname === "/clube-escova" ||
    pathname === "/atendimento"
  );
}

function ThemeScope({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const legacy = isLegacyThemePath(pathname);
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("np-legacy", legacy);
  }, [legacy]);
  return (
    <NpThemeProvider restoreOnUnmount={false} forcedTheme={legacy ? "light" : isFixedDarkPath(pathname) ? "dark" : undefined}>
      {children}
    </NpThemeProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <ThemeScope>
            <AuthProvider>
              <SensitiveDataProvider>
                <Suspense fallback={<PageSpinner />}>
                  <AppRoutes />
                </Suspense>
              </SensitiveDataProvider>
            </AuthProvider>
            </ThemeScope>
          </BrowserRouter>
        </TooltipProvider>
      </ErrorBoundary>
    </QueryClientProvider>
  );
}

export default App;
