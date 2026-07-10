import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { RefreshCw, Users, AlertTriangle } from "lucide-react";

// Acompanhamento da fila via TOKEN OPACO (falhas 2/13 corrigidas):
// - A página só enxerga a PRÓPRIA entrada (RPC fila_minha_situacao).
// - Cancelar exige o token (RPC fila_cancelar) — o crédito de pagamento
//   confirmado é gerado no SERVIDOR, nunca pelo browser.

const statusLabels: Record<string, { label: string; color: string }> = {
  waiting: { label: "Aguardando", color: "bg-blue-500" },
  checked_in: { label: "Check-in feito", color: "bg-green-500" },
  in_service: { label: "Em atendimento", color: "bg-orange-500" },
  completed: { label: "Concluido", color: "bg-gray-500" },
  cancelled: { label: "Cancelado", color: "bg-red-500" },
  no_show: { label: "Nao compareceu", color: "bg-red-500" },
};

interface MinhaSituacao {
  found: boolean;
  status?: string;
  payment_status?: string;
  people_ahead?: number;
  estimated_minutes?: number;
  service_names?: string;
  customer_first_name?: string;
}

export default function FilaAcompanhar() {
  const { id: token } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const { data: entry, isLoading, refetch } = useQuery({
    queryKey: ["fila_minha_situacao", token],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fila_minha_situacao", { p_token: token });
      if (error) throw error;
      return data as unknown as MinhaSituacao;
    },
    enabled: !!token,
    refetchInterval: 15000,
  });

  const handleCancel = async () => {
    if (!token) return;
    setCancelling(true);
    try {
      await supabase.rpc("fila_cancelar", { p_token: token });
    } finally {
      setCancelling(false);
      setCancelDialogOpen(false);
      refetch();
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-zinc-900 to-zinc-800 flex items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-white" />
      </div>
    );
  }

  if (!entry?.found) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-zinc-900 to-zinc-800 flex flex-col items-center justify-center p-4 text-white">
        <p>Entrada nao encontrada.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/fila")}>Voltar</Button>
      </div>
    );
  }

  const status = statusLabels[entry.status || "waiting"] || statusLabels.waiting;
  const isActive = ["waiting", "checked_in"].includes(entry.status || "");
  const aheadCount = entry.people_ahead ?? 0;
  const isNext = aheadCount === 0 && isActive;
  const gotCredit = entry.payment_status === "credit";

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-900 to-zinc-800 flex flex-col items-center p-4">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-bold text-white text-center mb-6">NP Hair Express</h1>

        <Card className="mb-4">
          <CardContent className="pt-6 text-center space-y-4">
            <Badge className={`${status.color} text-white`}>{status.label}</Badge>

            {isActive && (
              <div>
                {isNext ? (
                  <p className="text-2xl font-bold text-green-500">Voce e a proxima!</p>
                ) : (
                  <div className="flex items-center justify-center gap-2">
                    <Users className="h-5 w-5 text-primary" />
                    <span className="text-3xl font-bold">{aheadCount}</span>
                    <span className="text-muted-foreground">
                      {aheadCount === 1 ? "pessoa na frente" : "pessoas na frente"}
                    </span>
                  </div>
                )}
              </div>
            )}

            {entry.status === "in_service" && (
              <p className="text-xl font-bold text-orange-500">Voce esta sendo atendida!</p>
            )}

            {entry.status === "completed" && (
              <p className="text-lg text-muted-foreground">Atendimento concluido. Obrigada por vir!</p>
            )}

            {(entry.status === "cancelled" || entry.status === "no_show") && (
              <p className="text-lg text-muted-foreground">
                {gotCredit
                  ? "Voce recebeu um credito valido por 30 dias."
                  : "Sua entrada na fila foi encerrada."}
              </p>
            )}

            <div className="border-t pt-4">
              <p className="text-sm text-muted-foreground">Servico</p>
              <p className="font-medium">{entry.service_names || "—"}</p>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-3">
          <Button variant="outline" className="w-full" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />Atualizar
          </Button>
          {isActive && (
            <Button variant="ghost" className="w-full text-destructive hover:text-destructive" onClick={() => setCancelDialogOpen(true)}>
              <AlertTriangle className="h-4 w-4 mr-2" />Desistir da fila
            </Button>
          )}
        </div>
      </div>

      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Desistir da fila?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {entry.payment_status === "confirmed"
              ? "O valor pago vira um credito valido por 30 dias para usar em outra visita."
              : "Sua entrada sera cancelada."}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialogOpen(false)} disabled={cancelling}>Voltar</Button>
            <Button variant="destructive" onClick={handleCancel} disabled={cancelling}>
              {cancelling ? "Cancelando…" : "Sim, desistir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
