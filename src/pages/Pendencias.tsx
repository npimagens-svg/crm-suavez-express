// @ts-nocheck
import { useState } from "react";
import { AppLayoutNew } from "@/components/layout/AppLayoutNew";
import { useAuth } from "@/contexts/AuthContext";
import { useClosureIssues } from "@/hooks/useClosureIssues";
import { IssueCard } from "@/components/pendencias/IssueCard";
import { IssueRequestCorrectionModal } from "@/components/pendencias/IssueRequestCorrectionModal";

export default function Pendencias() {
  const { salonId } = useAuth();
  const { data: issues, isLoading, error } = useClosureIssues(salonId);
  const [selected, setSelected] = useState<any>(null);

  const openCount = issues?.length ?? 0;

  return (
    <AppLayoutNew>
      <div className="container max-w-4xl mx-auto p-4 md:p-6">
        <header className="mb-6">
          <h1 className="text-2xl font-bold">⚠️ Pendências de Fechamento</h1>
          <p className="text-slate-500 text-sm">
            {openCount} aberta{openCount !== 1 ? "s" : ""}
          </p>
        </header>

        {isLoading && (
          <div className="p-6 text-center text-slate-500">Carregando…</div>
        )}

        {error && (
          <div className="p-4 mb-4 rounded border border-rose-200 bg-rose-50 text-rose-900 text-sm">
            Erro ao carregar pendências: {String((error as any)?.message ?? error)}
          </div>
        )}

        <div className="space-y-3">
          {issues?.map((i: any) => (
            <IssueCard
              key={i.id}
              issue={i}
              onRequestCorrection={() => setSelected(i)}
            />
          ))}
          {!isLoading && !error && openCount === 0 && (
            <div className="p-6 text-center text-slate-500 border rounded">
              ✅ Nenhuma pendência aberta
            </div>
          )}
        </div>

        {selected && (
          <IssueRequestCorrectionModal
            open
            onClose={() => setSelected(null)}
            issue={selected}
          />
        )}
      </div>
    </AppLayoutNew>
  );
}
