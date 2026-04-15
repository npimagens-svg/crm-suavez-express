import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { RefreshCw, Clock, Users, AlertTriangle } from "lucide-react";
import { useQueueRealtime } from "@/hooks/useQueueRealtime";
import type { QueueEntry } from "@/types/queue";

const statusLabels: Record<string, { label: string; color: string }> = {
  waiting: { label: "Aguardando", color: "bg-blue-500" },
  checked_in: { label: "Check-in feito", color: "bg-green-500" },
  in_service: { label: "Em atendimento", color: "bg-orange-500" },
  completed: { label: "Concluido", color: "bg-gray-500" },
  cancelled: { label: "Cancelado", color: "bg-red-500" },
  no_show: { label: "Nao compareceu", color: "bg-red-500" },
};

export default function FilaAcompanhar() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  useQueueRealtime();

  const { data: entry, isLoading, refetch } = useQuery({
    queryKey: ["queue_entry", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("queue_entries")
        .select("*, service:services(id, name, price, duration_minutes)")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as QueueEntry;
    },
    enabled: !!id,
  });

  const { data: aheadCount } = useQuery({
    queryKey: ["queue_ahead", id, entry?.position, entry?.salon_id],
    queryFn: async () => {
      if (!entry) return 0;
      const { count } = await supabase
        .from("queue_entries")
        .select("id", { count: "exact", head: true })
        .eq("salon_id", entry.salon_id)
        .in("status", ["waiting", "checked_in", "in_service"])
        .lt("position", entry.position);
      return count || 0;
    },
    enabled: !!entry && ["waiting", "checked_in"].includes(entry.status),
    refetchInterval: 30000,
  });

  const handleCancel = async () => {
    if (!id || !entry) return;

    if (entry.payment_status === "confirmed" && entry.service) {
      const { data: settings } = await supabase
        .from("queue_settings")
        .select("credit_validity_days")
        .eq("salon_id", entry.salon_id)
        .single();

      const validityDays = settings?.credit_validity_days || 30;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + validityDays);

      await supabase.from("customer_credits").insert({
        salon_id: entry.salon_id,
        customer_phone: entry.customer_phone,
        amount: entry.service.price,
        origin_queue_entry_id: id,
        expires_at: expiresAt.toISOString(),
      });
    }

    await supabase
      .from("queue_entries")
      .update({
        status: "cancelled",
        payment_status: entry.payment_status === "confirmed" ? "credit" : entry.payment_status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    setCancelDialogOpen(false);
    refetch();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-zinc-900 to-zinc-800 flex items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-white" />
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-zinc-900 to-zinc-800 flex flex-col items-center justify-center p-4 text-white">
        <p>Entrada nao encontrada.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/fila")}>Voltar</Button>
      </div>
    );
  }

  const status = statusLabels[entry.status] || statusLabels.waiting;
  const isActive = ["waiting", "checked_in"].includes(entry.status);
  const isNext = aheadCount === 0 && isActive;

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
              <p className="text-lg text-muted-foreground">Voce recebeu um credito valido por 30 dias.</p>
            )}

            <div className="border-t pt-4">
              <p className="text-sm text-muted-foreground">Servico</p>
              <p className="font-medium">{entry.service?.name}</p>
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
            Voce recebera um credito de{" "}
            {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(entry.service?.price || 0)}{" "}
            valido por 30 dias.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>Voltar</Button>
            <Button variant="destructive" onClick={handleCancel}>Sim, desistir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
