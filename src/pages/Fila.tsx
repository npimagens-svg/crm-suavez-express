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
  const { entries, stats, addToQueue, checkIn, assignProfessional, skip, remove, markNoShow, reorder, complete } = useQueue();
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

  // Regra da casa: comanda aberta NA CHEGADA da cliente; cobrança só na saída.
  // Abre (ou reaproveita, se já houver aberta) a comanda da cliente com o
  // serviço da fila como primeiro item. Retorna ids pra quem chamou.
  const abrirComandaDaChegada = async (
    entry: QueueEntry
  ): Promise<{ comandaId: string | null; clientId: string | null }> => {
    if (!salonId) return { comandaId: null, clientId: null };
    // Regra Cleiton 08/07: só abre comanda automática pra quem veio da FILA DIGITAL (online/pago).
    // Walk-in/presencial NÃO abre comanda sozinho — a recepção usa o botão "Abrir Comanda".
    // (Também evita a comanda/atendimento duplicado do fluxo presencial.)
    if (entry.source !== "online") return { comandaId: null, clientId: null };

    // 0. Get or auto-open caixa
    let openCaixa = await getCurrentUserOpenCaixa();
    if (!openCaixa) {
      toast({ title: "Abrindo caixa automaticamente..." });
      openCaixa = await openCaixaAsync({ opening_balance: 0 });
      if (!openCaixa) {
        toast({ title: "Erro ao abrir caixa", variant: "destructive" });
        return { comandaId: null, clientId: null };
      }
    }

    // 1. Find or create client by phone
    let clientId = entry.customer_id;
    if (!clientId && entry.customer_phone) {
      const cleanPhone = entry.customer_phone.replace(/\D/g, "");
      const { data: existingClient } = await supabase
        .from("clients")
        .select("id")
        .eq("salon_id", salonId)
        .or(`phone.eq.${cleanPhone},phone.eq.${entry.customer_phone}`)
        .limit(1)
        .maybeSingle();

      if (existingClient) {
        clientId = existingClient.id;
      } else {
        const { data: newClient } = await supabase
          .from("clients")
          .insert({
            salon_id: salonId,
            name: entry.customer_name,
            phone: cleanPhone,
            email: entry.customer_email || null,
          })
          .select("id")
          .single();
        clientId = newClient?.id || null;
      }

      // Update queue entry with client_id
      if (clientId) {
        await supabase.from("queue_entries").update({ customer_id: clientId }).eq("id", entry.id);
      }
    }
    if (!clientId) return { comandaId: null, clientId: null };

    // 2. Já existe comanda aberta da cliente? Reaproveita (chegada → atender não duplica)
    const { data: existente } = await supabase
      .from("comandas")
      .select("id")
      .eq("client_id", clientId)
      .is("closed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existente?.id) return { comandaId: existente.id, clientId };

    // 3. Cria a comanda com o serviço da fila como primeiro item
    const comanda = await createComandaAsync({
      client_id: clientId,
      professional_id: entry.assigned_professional_id || null,
      caixa_id: openCaixa.id,
    });
    if (!comanda?.id) return { comandaId: null, clientId };

    if (entry.service) {
      await supabase.from("comanda_items").insert({
        comanda_id: comanda.id,
        service_id: entry.service_id,
        professional_id: entry.assigned_professional_id || null,
        description: entry.service.name,
        item_type: "service",
        quantity: 1,
        unit_price: entry.service.price,
        total_price: entry.service.price,
      });

      await supabase
        .from("comandas")
        .update({ subtotal: entry.service.price, total: entry.service.price })
        .eq("id", comanda.id);
    }

    return { comandaId: comanda.id, clientId };
  };

  const handleAddWalkIn = async (data: { customer_name: string; customer_phone: string; service_id: string }) => {
    try {
      await addToQueue({ customer_name: data.customer_name, customer_phone: data.customer_phone, service_id: data.service_id, source: "walk_in" });
      // Walk-in já entra como checked_in (chegou) → comanda abre na hora
      const { data: novaEntry } = await supabase
        .from("queue_entries")
        .select(`*, service:services(id, name, price, duration_minutes)`)
        .eq("salon_id", salonId)
        .eq("customer_phone", data.customer_phone)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (novaEntry) await abrirComandaDaChegada(novaEntry as QueueEntry);
      toast({ title: "Cliente na fila e comanda aberta!" });
    } catch { toast({ title: "Erro ao adicionar", variant: "destructive" }); }
  };

  // Check-in = a cliente CHEGOU → marca na fila e abre a comanda dela
  const handleCheckIn = async (entry: QueueEntry) => {
    checkIn(entry.id);
    const { comandaId } = await abrirComandaDaChegada(entry);
    if (comandaId) toast({ title: "Check-in feito e comanda aberta!" });
  };

  const handleAssignProfessional = async (professionalId: string) => {
    if (!selectedEntry || !salonId) return;
    try {
      // 1. Garante a comanda (se o check-in já abriu na chegada, reaproveita)
      const { comandaId, clientId } = await abrirComandaDaChegada(selectedEntry);

      // 2. Assign professional in queue (moves to in_service)
      const { error: assignError } = await supabase
        .from("queue_entries")
        .update({
          assigned_professional_id: professionalId,
          status: "in_service",
          checked_in_at: selectedEntry.checked_in_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", selectedEntry.id);
      if (assignError) console.error("Assign error:", assignError);

      if (comandaId) {
        // 3. Vincula o profissional à comanda e aos itens ainda sem profissional
        await supabase.from("comandas").update({ professional_id: professionalId }).eq("id", comandaId);
        await supabase
          .from("comanda_items")
          .update({ professional_id: professionalId })
          .eq("comanda_id", comandaId)
          .is("professional_id", null);

        // 4. Pagamento online (Asaas) já confirmado → registra o pagamento,
        // mas a comanda FICA ABERTA até a saída: dá pra lançar serviços extras
        // e o valor já pago via Asaas aparece abatido no fechamento da comanda.
        if (selectedEntry.source === "online" && selectedEntry.payment_status === "confirmed" && selectedEntry.service) {
          const payMethod = selectedEntry.payment_method === "credit_card" ? "credit_card" : "pix";
          await supabase.from("payments").insert({
            comanda_id: comandaId,
            salon_id: salonId,
            payment_method: payMethod,
            payment_provider: "asaas", // pagamento online via fila → sempre Asaas
            amount: selectedEntry.service.price,
            fee_amount: 0,
            net_amount: selectedEntry.service.price,
            notes: `Pagamento online via Asaas - fila ${selectedEntry.id}`,
          });

          // Agenda for visual tracking
          await supabase.from("appointments").insert({
            salon_id: salonId,
            client_id: clientId,
            professional_id: professionalId,
            service_id: selectedEntry.service_id,
            scheduled_at: new Date().toISOString(),
            duration_minutes: selectedEntry.service.duration_minutes || 45,
            status: "in_progress",
            notes: `Fila online - Pagamento online`,
            price: selectedEntry.service.price,
          });

          // Caixa totals
          const openCaixa = await getCurrentUserOpenCaixa();
          if (openCaixa) {
            await updateCaixaTotalsAsync({
              caixaId: openCaixa.id,
              paymentMethod: payMethod,
              amount: selectedEntry.service.price,
            });
          }
        }
      }

      toast({ title: "Atendimento iniciado!" });

      if (comandaId) {
        navigate(`/comandas?comanda=${comandaId}&edit=true`);
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
      // Z-API não configurada neste salão → não assusta a recepção com erro vermelho.
      toast({ title: "Notificação por WhatsApp não está ativa aqui." });
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
                onCheckIn={() => handleCheckIn(entry)}
                onAssignProfessional={() => { setSelectedEntry(entry); setAssignModalOpen(true); }}
                onSkip={() => handleSkip(entry)}
                onRemove={() => handleRemove(entry)}
                onNoShow={() => markNoShow(entry.id)}
                onMoveUp={() => handleMoveUp(index)}
                onMoveDown={() => handleMoveDown(index)}
              />
            ))}
          </TabsContent>

          <TabsContent value="atendimento">
            {inServiceEntries.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">Nenhum atendimento em andamento</p>
            ) : inServiceEntries.map((entry) => {
              // Fila de verdade: mostra há quanto tempo está "em atendimento"
              // e cutuca a equipe a dar baixa quando passa do razoável.
              const inicio = entry.checked_in_at || entry.created_at;
              const mins = inicio ? Math.max(0, Math.round((Date.now() - new Date(inicio).getTime()) / 60000)) : null;
              return (
                <div key={entry.id} className="space-y-1">
                  {mins !== null && (
                    <p className={`text-xs px-1 ${mins > 90 ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
                      Em atendimento há {mins} min{mins > 90 ? " — já terminou? Finaliza pra fila ficar de verdade" : ""}
                    </p>
                  )}
                  <QueueCard entry={entry}
                    isFirst={true} isLast={true}
                    onCheckIn={() => {}} onAssignProfessional={() => {}} onSkip={() => {}} onRemove={() => handleRemove(entry)}
                    onMoveUp={() => {}} onMoveDown={() => {}}
                    onComplete={() => {
                      if (confirm(`Finalizar o atendimento de ${entry.customer_name}?`)) {
                        complete(entry.id);
                      }
                    }}
                  />
                </div>
              );
            })}
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
