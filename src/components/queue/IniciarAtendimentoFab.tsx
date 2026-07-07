// @ts-nocheck
// Botão flutuante global "Iniciar Atendimento" (spec Cleiton 04/07).
// Abre uma comanda ágil: busca/cadastra cliente, escolhe serviço, sugere a
// profissional "da vez" (livre) e já coloca a cliente na fila (walk-in).
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useClients";
import { useServices } from "@/hooks/useServices";
import { useProfessionals } from "@/hooks/useProfessionals";
import { useComandas } from "@/hooks/useComandas";
import { useQueue } from "@/hooks/useQueue";
import { useCaixas } from "@/hooks/useCaixas";
import { useToast } from "@/hooks/use-toast";
import { ClientSearchSelect } from "@/components/shared/ClientSearchSelect";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Play, Loader2, UserPlus, CalendarDays } from "lucide-react";

export function IniciarAtendimentoFab() {
  const navigate = useNavigate();
  const { salonId } = useAuth();
  const { toast } = useToast();
  const { clients } = useClients();
  const { services } = useServices();
  const { professionals } = useProfessionals();
  const { createComandaAsync } = useComandas();
  const { addToQueue } = useQueue();
  const { getCurrentUserOpenCaixa, openCaixaAsync } = useCaixas();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Cliente: existente (clientId) OU novo (newName/newPhone/newEmail)
  const [clientId, setClientId] = useState<string | null>(null);
  const [novoCliente, setNovoCliente] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");

  const [serviceId, setServiceId] = useState("");
  const [professionalId, setProfessionalId] = useState<string | null>(null);
  const [suggestedProfId, setSuggestedProfId] = useState<string | null>(null);

  const activeProfs = professionals.filter((p: any) => p.is_active);
  const activeServices = services.filter((s: any) => s.is_active);
  const hoje = new Date().toLocaleDateString("pt-BR");

  const reset = () => {
    setClientId(null); setNovoCliente(false);
    setNewName(""); setNewPhone(""); setNewEmail("");
    setServiceId(""); setProfessionalId(null); setSuggestedProfId(null);
  };

  // Ao abrir: sugere a profissional "da vez" (a livre — sem comanda aberta nem em atendimento)
  useEffect(() => {
    if (!open || !salonId) return;
    (async () => {
      const busy = new Set<string>();
      const { data: abertas } = await supabase
        .from("comandas").select("professional_id")
        .eq("salon_id", salonId).is("closed_at", null);
      (abertas || []).forEach((c: any) => c.professional_id && busy.add(c.professional_id));
      const { data: emAtend } = await supabase
        .from("queue_entries").select("assigned_professional_id")
        .eq("salon_id", salonId).eq("status", "in_service");
      (emAtend || []).forEach((e: any) => e.assigned_professional_id && busy.add(e.assigned_professional_id));
      const livre = activeProfs.find((p: any) => !busy.has(p.id));
      setSuggestedProfId(livre?.id || null);
      setProfessionalId(livre?.id || activeProfs[0]?.id || null);
    })();
  }, [open, salonId, professionals]);

  const selectedClient = clients.find((c: any) => c.id === clientId);

  const handleStart = async () => {
    if (!salonId) return;
    // Cliente
    let name = "", phone = "", email = "";
    let resolvedClientId = clientId;
    if (novoCliente) {
      if (!newName.trim() || !newPhone.trim()) {
        toast({ title: "Preencha nome e telefone do cliente", variant: "destructive" });
        return;
      }
      name = newName.trim(); phone = newPhone.trim(); email = newEmail.trim();
    } else if (selectedClient) {
      name = selectedClient.name; phone = selectedClient.phone || ""; email = selectedClient.email || "";
    } else {
      toast({ title: "Selecione ou cadastre a cliente", variant: "destructive" });
      return;
    }
    if (!serviceId) {
      toast({ title: "Selecione o serviço", variant: "destructive" });
      return;
    }
    const svc = activeServices.find((s: any) => s.id === serviceId);

    setLoading(true);
    try {
      // Cadastra cliente novo agora (pega o id de forma síncrona)
      if (novoCliente) {
        const cleanPhone = phone.replace(/\D/g, "");
        const { data: existing } = await supabase
          .from("clients").select("id").eq("salon_id", salonId)
          .or(`phone.eq.${cleanPhone},phone.eq.${phone}`).limit(1).maybeSingle();
        if (existing) {
          resolvedClientId = existing.id;
        } else {
          const { data: nc } = await supabase.from("clients")
            .insert({ salon_id: salonId, name, phone: cleanPhone, email: email || null })
            .select("id").single();
          resolvedClientId = nc?.id || null;
        }
      }

      // 0. Garante caixa aberto
      let caixa = await getCurrentUserOpenCaixa();
      if (!caixa) caixa = await openCaixaAsync({ opening_balance: 0 });

      // 1. Coloca na fila como walk-in (já chega como checked_in)
      const res = await addToQueue({
        customer_name: name,
        customer_phone: phone,
        customer_email: email || undefined,
        service_id: serviceId,
        source: "walk_in",
      });
      const entryId = (res as any)?.entryId;

      // 2. Vincula profissional da vez + cliente na entry
      if (entryId) {
        await supabase.from("queue_entries").update({
          customer_id: resolvedClientId,
          assigned_professional_id: professionalId || null,
          status: professionalId ? "in_service" : "checked_in",
          updated_at: new Date().toISOString(),
        }).eq("id", entryId);
      }

      // 3. Cria a comanda aberta com o serviço como primeiro item
      const comanda = await createComandaAsync({
        client_id: resolvedClientId,
        professional_id: professionalId || null,
        caixa_id: caixa?.id,
      });
      if (comanda?.id && svc) {
        await supabase.from("comanda_items").insert({
          comanda_id: comanda.id,
          service_id: serviceId,
          professional_id: professionalId || null,
          description: svc.name,
          item_type: "service",
          quantity: 1,
          unit_price: svc.price,
          total_price: svc.price,
        });
        await supabase.from("comandas")
          .update({ subtotal: svc.price, total: svc.price })
          .eq("id", comanda.id);
      }

      toast({ title: "Atendimento iniciado!", description: `${name} está na fila e a comanda foi aberta.` });
      setOpen(false);
      reset();
      if (comanda?.id) navigate(`/comandas?comanda=${comanda.id}&edit=true`);
    } catch (err) {
      toast({ title: "Erro ao iniciar atendimento", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* FAB */}
      <Button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 h-14 rounded-full shadow-lg gap-2 px-5 text-base"
        size="lg"
      >
        <Play className="h-5 w-5" />
        <span className="hidden sm:inline">Iniciar Atendimento</span>
      </Button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Iniciar Atendimento</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Data */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarDays className="h-4 w-4" />
              Data: <span className="font-medium text-foreground">{hoje}</span>
            </div>

            {/* Cliente */}
            <div className="space-y-2">
              <Label>Cliente</Label>
              {!novoCliente ? (
                <ClientSearchSelect
                  clients={clients}
                  value={clientId}
                  onSelect={(id) => { setClientId(id); setNovoCliente(false); }}
                  onCreateNew={(name) => { setNovoCliente(true); setNewName(name); setClientId(null); }}
                  placeholder="Buscar por nome ou telefone..."
                />
              ) : (
                <div className="space-y-2 rounded-md border p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-primary">
                    <UserPlus className="h-4 w-4" /> Novo cliente
                  </div>
                  <div><Label className="text-xs">Nome</Label><Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nome completo" /></div>
                  <div><Label className="text-xs">Telefone</Label><Input value={newPhone} inputMode="numeric" onChange={(e) => setNewPhone(e.target.value)} placeholder="(11) 99999-9999" /></div>
                  <div><Label className="text-xs">E-mail (opcional)</Label><Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="email@exemplo.com" /></div>
                  <Button variant="ghost" size="sm" onClick={() => { setNovoCliente(false); setNewName(""); }}>Buscar cliente existente</Button>
                </div>
              )}
            </div>

            {/* Serviço */}
            <div className="space-y-2">
              <Label>Serviço</Label>
              <Select value={serviceId} onValueChange={setServiceId}>
                <SelectTrigger><SelectValue placeholder="Escolha o serviço" /></SelectTrigger>
                <SelectContent>
                  {activeServices.map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} — {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(s.price)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Profissional da vez */}
            <div className="space-y-2">
              <Label>Profissional</Label>
              <Select value={professionalId || ""} onValueChange={setProfessionalId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {activeProfs.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="flex items-center gap-2">
                        {p.name}
                        {p.id === suggestedProfId && <Badge variant="secondary" className="text-[10px]">da vez</Badge>}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {suggestedProfId && professionalId === suggestedProfId && (
                <p className="text-xs text-green-600">Sugerimos {activeProfs.find((p: any) => p.id === suggestedProfId)?.name} (livre agora). Pode trocar.</p>
              )}
            </div>

            <Button className="w-full h-12 gap-2" onClick={handleStart} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Iniciar Atendimento
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
