import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayoutNew } from "@/components/layout/AppLayoutNew";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button, Badge, CountBadge, GlassCard, StatCard, EmptyState, PageHeader } from "@design-system";
import { Plus, Users, Clock, UserCheck, Bell, Crown } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useQueue } from "@/hooks/useQueue";
import { useQueueLeads } from "@/hooks/useQueueLeads";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { useQueueRealtime } from "@/hooks/useQueueRealtime";
import { useCaixas } from "@/hooks/useCaixas";
import { useToast } from "@/hooks/use-toast";
import { QueueCard } from "@/components/queue/QueueCard";
import { AddWalkInModal } from "@/components/queue/AddWalkInModal";
import { VenderClubeModal } from "@/components/clube/VenderClubeModal";
import { AssignProfessionalModal } from "@/components/queue/AssignProfessionalModal";
import { notifyQueueEntry, notifyLead } from "@/lib/queueNotifications";
import type { QueueEntry } from "@/types/queue";

const SITE_URL = window.location.origin;

const horaSP = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

// "entrou às 12:21 (há 2h10)"; pedido feito em outro dia (depois do fechamento) mostra a data.
function entrouEm(iso: string): string {
  const d = new Date(iso);
  const dia = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
  if (dia !== hoje) return `entrou em ${dia} às ${horaSP(iso)}`;
  const min = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
  const ha = min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
  return `entrou às ${horaSP(iso)} (há ${ha})`;
}

const RESULTADO_AVISO: Record<string, string> = {
  enviado: "Avisada automático",
  manual: "Avisada pela recepção",
  ja_na_fila: "Já estava na fila",
  duplicado: "Pedido repetido",
  telefone_invalido: "Telefone inválido",
};

export default function Fila() {
  const navigate = useNavigate();
  const { salonId } = useAuth();
  const { toast } = useToast();
  const { entries, stats, addToQueue, checkIn, assignProfessional, skip, remove, markNoShow, reorder, complete, archiveStaleEntries } = useQueue();
  const { pendingLeads, notifiedLeads, markNotified } = useQueueLeads();
  const { getSalonOpenCaixa } = useCaixas();
  useQueueRealtime();
  // Aviso de "vez chegando" agora é server-side (edge queue-cron, pg_cron 1/min)
  // — não depende mais desta tela estar aberta.

  const [walkInModalOpen, setWalkInModalOpen] = useState(false);
  const [venderClubeOpen, setVenderClubeOpen] = useState(false);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<QueueEntry | null>(null);

  // Arquiva zumbis de dias anteriores uma vez ao abrir a Fila
  useEffect(() => {
    archiveStaleEntries();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salonId]);

  const [prevCount, setPrevCount] = useState(entries.length);
  useEffect(() => {
    if (entries.length > prevCount) {
      try { new Audio("/notification.mp3").play(); } catch {}
    }
    setPrevCount(entries.length);
  }, [entries.length]);

  // Regra da casa: comanda aberta NA CHEGADA da cliente; cobrança só na saída.
  // Abre (ou reaproveita, se já houver aberta) a comanda da cliente com os
  // serviços da fila como itens, via rpc_iniciar_atendimento (etapa 5): comanda
  // + itens + fila in_service + pagamento Asaas numa transação, SEM caixa.
  // Retorna ids pra quem chamou.
  const abrirComandaDaChegada = async (
    entry: QueueEntry,
    professionalId?: string | null
  ): Promise<{ comandaId: string | null; clientId: string | null }> => {
    if (!salonId) return { comandaId: null, clientId: null };
    // Regra Cleiton 08/07: só abre comanda automática pra quem veio da FILA DIGITAL (online/pago).
    // Walk-in/presencial NÃO abre comanda sozinho — a recepção usa o botão "Abrir Comanda".
    // (Também evita a comanda/atendimento duplicado do fluxo presencial.)
    if (entry.source !== "online") return { comandaId: null, clientId: null };

    // 1. Find or create client by phone
    let clientId = entry.customer_id;
    if (!clientId && entry.customer_phone) {
      const cleanPhone = entry.customer_phone.replace(/\D/g, "");
      const { data: existingClient } = await supabase
        .from("clients_staff")
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

    // 2. A RPC exige a profissional. No check-in a entrada online ainda não tem
    // profissional → a comanda abre no "Atender" (que reaproveita se já houver).
    const profId = professionalId || entry.assigned_professional_id || null;
    if (!profId) return { comandaId: null, clientId };

    // 3. Caixa NÃO abre mais sozinho: a comanda nasce sem caixa e só precisa
    // dele na hora de fechar. Aqui só avisa.
    const caixaAberto = await getSalonOpenCaixa();
    if (!caixaAberto) {
      toast({
        title: "Nenhum caixa aberto",
        description: "A comanda pode ser aberta; abra o caixa antes de fechá-la.",
      });
    }

    // 4. Comanda (ou reaproveita a aberta) + itens dos serviços da fila + fila
    // in_service + pagamento Asaas (uma vez) — tudo na RPC.
    const { data, error } = await supabase.rpc("rpc_iniciar_atendimento", {
      p_client_id: clientId,
      p_professional_id: profId,
      p_service_id: entry.service_id || null,
      p_queue_entry_id: entry.id,
      p_source: "fila_online",
    });
    if (error) throw error;

    return { comandaId: (data?.comanda_id as string) || null, clientId };
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
      // 1. Garante a comanda (reaproveita se já houver aberta); a RPC já vincula
      // a profissional à comanda/itens e registra o pagamento Asaas.
      const { comandaId, clientId } = await abrirComandaDaChegada(selectedEntry, professionalId);

      // 2. Assign professional in queue (moves to in_service) — a RPC já faz
      // isso pra entrada online; aqui continua valendo pra presencial/walk-in.
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
        // 3. Pagamento online (Asaas) confirmado: a RPC já registrou UMA vez na
        // comanda (valor pago, não o do catálogo). A comanda FICA ABERTA até a
        // saída; o caixa recebe no fechamento dela. Aqui só a agenda visual.
        if (selectedEntry.source === "online" && selectedEntry.payment_status === "confirmed") {
          const svcIds = (selectedEntry.service_ids && selectedEntry.service_ids.length > 0)
            ? selectedEntry.service_ids
            : (selectedEntry.service_id ? [selectedEntry.service_id] : []);
          const { data: svcs } = await supabase.from("services").select("id, name, price, duration_minutes").in("id", svcIds);
          type SvcRow = { id: string; name: string; price: number; duration_minutes: number | null };
          const svcRows = (svcs || []) as SvcRow[];

          // Agenda for visual tracking (um por serviço)
          if (svcRows.length > 0) {
            await supabase.from("appointments").insert(svcRows.map((s) => ({
              salon_id: salonId,
              client_id: clientId,
              professional_id: professionalId,
              service_id: s.id,
              scheduled_at: new Date().toISOString(),
              duration_minutes: s.duration_minutes || 45,
              status: "in_progress",
              notes: `Fila online - Pagamento online`,
              price: s.price,
            })));
          }
        }
      }

      toast({ title: "Atendimento iniciado!" });

      if (comandaId) {
        navigate(`/comandas?comanda=${comandaId}&edit=true`);
      }
    } catch (err) {
      toast({
        title: "Erro ao atribuir",
        description: (err as { message?: string })?.message,
        variant: "destructive",
      });
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
    const sent = await notifyLead(salonId, lead, `${SITE_URL}/fila`);
    if (sent) {
      markNotified(lead.id);
      toast({ title: "WhatsApp enviado!" });
    } else {
      toast({ title: "Não consegui enviar o WhatsApp agora. Tente de novo em instantes.", variant: "destructive" });
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
      <div className="space-y-6">
        <PageHeader
          eyebrow="Recepção"
          title="Fila de Atendimento"
          actions={
            <>
              <Button variant="secondary" icon={Crown} onClick={() => setVenderClubeOpen(true)}>
                Vender Clube
              </Button>
              <Button icon={Plus} onClick={() => setWalkInModalOpen(true)}>
                Adicionar presencial
              </Button>
            </>
          }
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          <StatCard title="Na fila" value={<span className="tabular-nums">{stats.totalInQueue}</span>} icon={Users} accent />
          <StatCard title="Tempo estimado" value={<span className="tabular-nums">~{stats.estimatedMinutes} min</span>} icon={Clock} />
          <StatCard title="Em atendimento" value={<span className="tabular-nums">{inServiceEntries.length}</span>} icon={UserCheck} />
        </div>

        <Tabs defaultValue="fila">
          <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-full border border-border bg-[color:var(--np-tabs-bg)] p-1 sm:w-auto">
            <TabsTrigger value="fila" className="min-h-[40px] rounded-full px-4 text-[color:var(--np-tabs-text)] hover:text-[color:var(--np-tabs-text-hover)] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Fila ({waitingEntries.length})</TabsTrigger>
            <TabsTrigger value="atendimento" className="min-h-[40px] rounded-full px-4 text-[color:var(--np-tabs-text)] hover:text-[color:var(--np-tabs-text-hover)] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Em atendimento ({inServiceEntries.length})</TabsTrigger>
            <TabsTrigger value="leads" className="min-h-[40px] rounded-full px-4 text-[color:var(--np-tabs-text)] hover:text-[color:var(--np-tabs-text-hover)] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Leads{pendingLeads.length > 0 && <CountBadge count={pendingLeads.length} tone="danger" className="ml-2" />}</TabsTrigger>
          </TabsList>

          <TabsContent value="fila" className="mt-4">
            {waitingEntries.length === 0 ? (
              <GlassCard><EmptyState icon={Users} title="Fila vazia" /></GlassCard>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {waitingEntries.map((entry, index) => (
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
              </div>
            )}
          </TabsContent>

          <TabsContent value="atendimento" className="mt-4">
            {inServiceEntries.length === 0 ? (
              <GlassCard><EmptyState icon={UserCheck} title="Nenhum atendimento em andamento" /></GlassCard>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {inServiceEntries.map((entry) => {
                  // Fila de verdade: mostra há quanto tempo está "em atendimento"
                  // e cutuca a equipe a dar baixa quando passa do razoável.
                  const inicio = entry.checked_in_at || entry.created_at;
                  const mins = inicio ? Math.max(0, Math.round((Date.now() - new Date(inicio).getTime()) / 60000)) : null;
                  return (
                    <div key={entry.id} className="space-y-2">
                      {mins !== null && (
                        <p className={`text-xs px-1 tabular-nums ${mins > 90 ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
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
              </div>
            )}
          </TabsContent>

          <TabsContent value="leads" className="mt-4">
            {pendingLeads.length === 0 && notifiedLeads.length === 0 ? (
              <GlassCard><EmptyState icon={Bell} title="Nenhum pedido de aviso hoje" /></GlassCard>
            ) : (
              <div className="space-y-3">
                {pendingLeads.length > 0 && (
                  <p className="text-sm font-semibold text-muted-foreground">Aguardando aviso · o WhatsApp sai sozinho quando a fila ficar menor que o pedido</p>
                )}
                {pendingLeads.map((lead) => (
                  <GlassCard key={lead.id} padding={16}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground">{lead.name}</p>
                        <p className="text-sm text-muted-foreground tabular-nums">{lead.phone} · quer fila com menos de {lead.max_queue_size}</p>
                        <p className="text-sm text-muted-foreground tabular-nums">{entrouEm(lead.created_at)}</p>
                      </div>
                      <Button variant="secondary" icon={Bell} onClick={() => handleNotifyLead(lead)}>Avisar agora</Button>
                    </div>
                  </GlassCard>
                ))}
                {notifiedLeads.length > 0 && (
                  <p className="pt-2 text-sm font-semibold text-muted-foreground">Avisadas hoje</p>
                )}
                {notifiedLeads.map((lead) => (
                  <GlassCard key={lead.id} padding={16} className="opacity-60">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground">{lead.name}</p>
                        <p className="text-sm text-muted-foreground tabular-nums">{lead.phone} · {entrouEm(lead.created_at)}</p>
                      </div>
                      <Badge tone="neutral">
                        {RESULTADO_AVISO[lead.notify_result ?? ""] ?? "Avisada"}
                        {lead.notified_at ? ` às ${horaSP(lead.notified_at)}` : ""}
                      </Badge>
                    </div>
                  </GlassCard>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <VenderClubeModal open={venderClubeOpen} onClose={() => setVenderClubeOpen(false)} />
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
