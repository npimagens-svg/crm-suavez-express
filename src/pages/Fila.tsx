import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayoutNew } from "@/components/layout/AppLayoutNew";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Plus, Users, Clock, UserCheck, Bell } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useQueue } from "@/hooks/useQueue";
import { useQueueLeads } from "@/hooks/useQueueLeads";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { useQueueRealtime } from "@/hooks/useQueueRealtime";
import { useComandas } from "@/hooks/useComandas";
import { useCaixas } from "@/hooks/useCaixas";
import { useToast } from "@/hooks/use-toast";
import { QueueCard } from "@/components/queue/QueueCard";
import { AddWalkInModal } from "@/components/queue/AddWalkInModal";
import { AssignProfessionalModal } from "@/components/queue/AssignProfessionalModal";
import { notifyQueueEntry, notifyLead } from "@/lib/queueNotifications";
import { useQueueNotificationCheck } from "@/hooks/useQueueNotificationCheck";
import type { QueueEntry } from "@/types/queue";

const SITE_URL = window.location.origin;

export default function Fila() {
  const navigate = useNavigate();
  const { salonId } = useAuth();
  const { toast } = useToast();
  const { entries, stats, addToQueue, checkIn, assignProfessional, skip, remove, reorder, complete } = useQueue();
  const { pendingLeads, notifiedLeads, markNotified } = useQueueLeads();
  const { getCurrentUserOpenCaixa, openCaixaAsync, updateCaixaTotalsAsync } = useCaixas();
  const { createComandaAsync } = useComandas();
  useQueueRealtime();
  useQueueNotificationCheck();

  const [walkInModalOpen, setWalkInModalOpen] = useState(false);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<QueueEntry | null>(null);

  const [prevCount, setPrevCount] = useState(entries.length);
  useEffect(() => {
    if (entries.length > prevCount) {
      try { new Audio("/notification.mp3").play(); } catch {}
    }
    setPrevCount(entries.length);
  }, [entries.length]);

  const handleAddWalkIn = async (data: { customer_name: string; customer_phone: string; service_id: string }) => {
    try {
      await addToQueue({ customer_name: data.customer_name, customer_phone: data.customer_phone, service_id: data.service_id, source: "walk_in" });
      toast({ title: "Cliente adicionada na fila!" });
    } catch { toast({ title: "Erro ao adicionar", variant: "destructive" }); }
  };

  const handleAssignProfessional = async (professionalId: string) => {
    if (!selectedEntry || !salonId) return;
    try {
      // 0. Get or auto-open caixa
      let openCaixa = await getCurrentUserOpenCaixa();
      if (!openCaixa) {
        toast({ title: "Abrindo caixa automaticamente..." });
        const newCaixa = await openCaixaAsync({ opening_balance: 0 });
        openCaixa = newCaixa;
        if (!openCaixa) {
          toast({ title: "Erro ao abrir caixa", variant: "destructive" });
          return;
        }
      }

      // 1. Find or create client by phone
      let clientId = selectedEntry.customer_id;
      if (!clientId && selectedEntry.customer_phone) {
        const cleanPhone = selectedEntry.customer_phone.replace(/\D/g, "");
        const { data: existingClient } = await supabase
          .from("clients")
          .select("id")
          .eq("salon_id", salonId)
          .or(`phone.eq.${cleanPhone},phone.eq.${selectedEntry.customer_phone}`)
          .limit(1)
          .maybeSingle();

        if (existingClient) {
          clientId = existingClient.id;
        } else {
          const { data: newClient } = await supabase
            .from("clients")
            .insert({
              salon_id: salonId,
              name: selectedEntry.customer_name,
              phone: cleanPhone,
              email: selectedEntry.customer_email || null,
            })
            .select("id")
            .single();
          clientId = newClient?.id || null;
        }

        // Update queue entry with client_id
        if (clientId) {
          await supabase
            .from("queue_entries")
            .update({ customer_id: clientId })
            .eq("id", selectedEntry.id);
        }
      }

      // 2. Assign professional in queue (moves to in_service)
      const { error: assignError } = await supabase
        .from("queue_entries")
        .update({
          assigned_professional_id: professionalId,
          status: "in_service",
          checked_in_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", selectedEntry.id);
      if (assignError) console.error("Assign error:", assignError);

      // 3. Create comanda linked to client and caixa
      const comanda = await createComandaAsync({
        client_id: clientId,
        professional_id: professionalId,
        caixa_id: openCaixa.id,
      });

      // 4. Add the service as comanda item
      if (comanda?.id && selectedEntry.service) {
        await supabase.from("comanda_items").insert({
          comanda_id: comanda.id,
          service_id: selectedEntry.service_id,
          professional_id: professionalId,
          description: selectedEntry.service.name,
          item_type: "service",
          quantity: 1,
          unit_price: selectedEntry.service.price,
          total_price: selectedEntry.service.price,
        });

        // Update comanda totals
        await supabase
          .from("comandas")
          .update({
            subtotal: selectedEntry.service.price,
            total: selectedEntry.service.price,
          })
          .eq("id", comanda.id);

        // 5. Register payment in comanda (already paid online via Asaas)
        if (selectedEntry.source === "online" && selectedEntry.payment_status === "confirmed") {
          const payMethod = selectedEntry.payment_method === "credit_card" ? "credit_card" : "pix";
          await supabase.from("payments").insert({
            comanda_id: comanda.id,
            salon_id: salonId,
            payment_method: payMethod,
            payment_provider: "asaas", // pagamento online via fila → sempre Asaas
            amount: selectedEntry.service.price,
            fee_amount: 0,
            net_amount: selectedEntry.service.price,
            notes: `Pagamento online via Asaas - fila ${selectedEntry.id}`,
          });

          // Mark comanda as paid and closed
          await supabase
            .from("comandas")
            .update({
              is_paid: true,
              closed_at: new Date().toISOString(),
            })
            .eq("id", comanda.id);

          // 6. Add to agenda for visual tracking
          await supabase.from("appointments").insert({
            salon_id: salonId,
            client_id: clientId,
            professional_id: professionalId,
            service_id: selectedEntry.service_id,
            scheduled_at: new Date().toISOString(),
            duration_minutes: selectedEntry.service.duration_minutes || 45,
            status: "in_progress",
            notes: `Fila online - ${selectedEntry.source === "online" ? "Pagamento online" : "Presencial"}`,
            price: selectedEntry.service.price,
          });

          // 7. Update caixa totals
          await updateCaixaTotalsAsync({
            caixaId: openCaixa.id,
            paymentMethod: payMethod,
            amount: selectedEntry.service.price,
          });
        }
      }

      toast({ title: "Comanda aberta!" });

      // 5. Navigate to comanda
      if (comanda?.id) {
        navigate(`/comandas?comanda=${comanda.id}&edit=true`);
      }
    } catch (err) {
      toast({ title: "Erro ao atribuir", variant: "destructive" });
    }
  };

  const handleSkip = (entry: QueueEntry) => {
    skip(entry.id);
    if (entry.source === "online" && entry.customer_phone && salonId) {
      notifyQueueEntry(salonId, entry, "skipped");
    }
  };

  const handleRemove = (entry: QueueEntry) => {
    remove(entry.id);
    if (entry.source === "online" && entry.payment_status === "confirmed" && salonId) {
      notifyQueueEntry(salonId, entry, "credit", { creditAmount: entry.service?.price });
    }
  };

  const handleNotifyLead = async (lead: { id: string; phone: string; name: string }) => {
    if (!salonId) return;
    const sent = await notifyLead(salonId, lead, stats.totalInQueue, `${SITE_URL}/fila`);
    if (sent) {
      markNotified(lead.id);
      toast({ title: "WhatsApp enviado!" });
    } else {
      toast({ title: "Falha ao enviar WhatsApp. Verifique Z-API.", variant: "destructive" });
    }
  };

  const inServiceEntries = entries.filter((e) => e.status === "in_service");
  const waitingEntries = entries.filter((e) => ["waiting", "checked_in"].includes(e.status));

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const ids = waitingEntries.map((e) => e.id);
    [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
    reorder(ids);
  };

  const handleMoveDown = (index: number) => {
    if (index >= waitingEntries.length - 1) return;
    const ids = waitingEntries.map((e) => e.id);
    [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
    reorder(ids);
  };

  return (
    <AppLayoutNew>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Fila de Atendimento</h1>
          <Button onClick={() => setWalkInModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />Adicionar presencial
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Card><CardContent className="pt-4 text-center">
            <Users className="h-5 w-5 mx-auto text-blue-500 mb-1" />
            <p className="text-2xl font-bold">{stats.totalInQueue}</p>
            <p className="text-xs text-muted-foreground">Na fila</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <Clock className="h-5 w-5 mx-auto text-orange-500 mb-1" />
            <p className="text-2xl font-bold">~{stats.estimatedMinutes} min</p>
            <p className="text-xs text-muted-foreground">Tempo estimado</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <UserCheck className="h-5 w-5 mx-auto text-green-500 mb-1" />
            <p className="text-2xl font-bold">{inServiceEntries.length}</p>
            <p className="text-xs text-muted-foreground">Em atendimento</p>
          </CardContent></Card>
        </div>

        <Tabs defaultValue="fila">
          <TabsList>
            <TabsTrigger value="fila">Fila ({waitingEntries.length})</TabsTrigger>
            <TabsTrigger value="atendimento">Em atendimento ({inServiceEntries.length})</TabsTrigger>
            <TabsTrigger value="leads">Leads{pendingLeads.length > 0 && <Badge className="ml-2 bg-red-500">{pendingLeads.length}</Badge>}</TabsTrigger>
          </TabsList>

          <TabsContent value="fila">
            {waitingEntries.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">Fila vazia</p>
            ) : waitingEntries.map((entry, index) => (
              <QueueCard key={entry.id} entry={entry}
                isFirst={index === 0}
                isLast={index === waitingEntries.length - 1}
                onCheckIn={() => checkIn(entry.id)}
                onAssignProfessional={() => { setSelectedEntry(entry); setAssignModalOpen(true); }}
                onSkip={() => handleSkip(entry)}
                onRemove={() => handleRemove(entry)}
                onMoveUp={() => handleMoveUp(index)}
                onMoveDown={() => handleMoveDown(index)}
              />
            ))}
          </TabsContent>

          <TabsContent value="atendimento">
            {inServiceEntries.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">Nenhum atendimento em andamento</p>
            ) : inServiceEntries.map((entry, index) => (
              <QueueCard key={entry.id} entry={entry}
                isFirst={true} isLast={true}
                onCheckIn={() => {}} onAssignProfessional={() => {}} onSkip={() => {}} onRemove={() => handleRemove(entry)}
                onMoveUp={() => {}} onMoveDown={() => {}}
                onComplete={() => {
                  if (confirm(`Finalizar o atendimento de ${entry.customer_name}?`)) {
                    complete(entry.id);
                  }
                }}
              />
            ))}
          </TabsContent>

          <TabsContent value="leads">
            {pendingLeads.length === 0 && notifiedLeads.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">Nenhum lead</p>
            ) : (
              <div className="space-y-2">
                {pendingLeads.map((lead) => (
                  <Card key={lead.id}><CardContent className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium">{lead.name}</p>
                      <p className="text-sm text-muted-foreground">{lead.phone} · Quer fila &lt; {lead.max_queue_size}</p>
                    </div>
                    <Button size="sm" onClick={() => handleNotifyLead(lead)}><Bell className="h-4 w-4 mr-1" />Notificar</Button>
                  </CardContent></Card>
                ))}
                {notifiedLeads.map((lead) => (
                  <Card key={lead.id} className="opacity-60"><CardContent className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium">{lead.name}</p>
                      <p className="text-sm text-muted-foreground">{lead.phone}</p>
                    </div>
                    <Badge variant="outline">Notificada</Badge>
                  </CardContent></Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <AddWalkInModal open={walkInModalOpen} onClose={() => setWalkInModalOpen(false)} onSubmit={handleAddWalkIn} />
      {selectedEntry && (
        <AssignProfessionalModal
          open={assignModalOpen}
          onClose={() => { setAssignModalOpen(false); setSelectedEntry(null); }}
          customerName={selectedEntry.customer_name}
          serviceName={selectedEntry.service?.name || ""}
          onAssign={handleAssignProfessional}
        />
      )}
    </AppLayoutNew>
  );
}
