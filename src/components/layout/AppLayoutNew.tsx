import { AppHeaderNew } from "./AppHeaderNew";
import { TopNavigation } from "./TopNavigation";
import { IniciarAtendimentoFab } from "@/components/queue/IniciarAtendimentoFab";

interface AppLayoutNewProps {
  children: React.ReactNode;
}

export function AppLayoutNew({ children }: AppLayoutNewProps) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeaderNew />
      <TopNavigation />
      <main className="p-2 md:p-4 lg:p-6 flex-1 overflow-x-hidden">
        {children}
      </main>
      <IniciarAtendimentoFab />
    </div>
  );
}
