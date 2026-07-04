import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Users, Clock, Bell, Crown } from "lucide-react";
import { usePublicQueue } from "@/hooks/usePublicQueue";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { notifyQueueEntry, notifyReception } from "@/lib/queueNotifications";

const SITE_URL = window.location.origin;

type ClubeResposta = {
  ok: boolean;
  erro?: string;
  entry_id?: string;
  position?: number;
  nome?: string;
  usadas?: number;
  total?: number;
};

export default function FilaPublica() {
  const navigate = useNavigate();
  const { salonId, stats, settings, addLead } = usePublicQueue();
  const { toast } = useToast();

  const [leadModalOpen, setLeadModalOpen] = useState(false);
  const [leadName, setLeadName] = useState("");
  const [leadPhone, setLeadPhone] = useState("");
  const [leadMaxQueue, setLeadMaxQueue] = useState("3");

  const [clubeModalOpen, setClubeModalOpen] = useState(false);
  const [clubePhone, setClubePhone] = useState("");
  const [clubeLoading, setClubeLoading] = useState(false);

  const handleClubeSubmit = async () => {
    if (clubePhone.replace(/\D/g, "").length < 10) {
      toast({ title: "Digite seu WhatsApp com DDD", variant: "destructive" });
      return;
    }
    setClubeLoading(true);
    try {
      const { data, error } = await supabase.rpc("clube_entrar_fila", { p_celular: clubePhone });
      if (error) throw error;
      const resp = data as ClubeResposta;

      if (resp.ok && resp.entry_id) {
        setClubeModalOpen(false);
        toast({
          title: `Bem-vinda, ${(resp.nome || "").split(" ")[0] || "assinante"}!`,
          description: `Você entrou na fila (${resp.position}ª posição). Escova ${resp.usadas} de ${resp.total} do mês.`,
        });
        if (salonId) {
          const trackingUrl = `${SITE_URL}/fila/acompanhar/${resp.entry_id}`;
          notifyQueueEntry(salonId, {
            customer_phone: clubePhone,
            customer_email: null,
            customer_name: resp.nome || "Assinante Clube",
          }, "entered", { position: resp.position, trackingUrl }).catch(() => {});
          notifyReception(salonId,
            "Assinante do Clube na fila!",
            `${resp.nome || "Assinante"} entrou pela fila do Clube da Escova (posição ${resp.position}, escova ${resp.usadas}/${resp.total} do mês).`
          ).catch(() => {});
        }
        navigate(`/fila/acompanhar/${resp.entry_id}`);
        return;
      }

      if (resp.erro === "ja_na_fila" && resp.entry_id) {
        setClubeModalOpen(false);
        toast({ title: "Você já está na fila!", description: `Sua posição: ${resp.position}ª.` });
        navigate(`/fila/acompanhar/${resp.entry_id}`);
        return;
      }
      if (resp.erro === "teto_atingido") {
        toast({
          title: "Escovas do mês já usadas",
          description: `Você já usou as ${resp.total} escovas do seu plano neste mês. Elas renovam no próximo ciclo.`,
          variant: "destructive",
        });
        return;
      }
      if (resp.erro === "nao_encontrado") {
        toast({
          title: "Não achei sua assinatura",
          description: "Confira se digitou o mesmo número usado na assinatura — ou fale com a recepção.",
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Número inválido. Digite com DDD.", variant: "destructive" });
    } catch {
      toast({ title: "Erro ao entrar na fila. Tente de novo.", variant: "destructive" });
    } finally {
      setClubeLoading(false);
    }
  };

  const inflationFactor = settings?.inflation_factor || 1.7;
  const displayCount = stats.totalInQueue === 0 ? 0 : Math.ceil(stats.totalInQueue * inflationFactor);
  const displayMinutes = stats.totalInQueue === 0 ? 0 : Math.ceil(stats.estimatedMinutes * inflationFactor);

  const handleLeadSubmit = async () => {
    if (!leadName.trim() || !leadPhone.trim()) {
      toast({ title: "Preencha nome e WhatsApp", variant: "destructive" });
      return;
    }
    try {
      await addLead({ name: leadName.trim(), phone: leadPhone.trim(), max_queue_size: parseInt(leadMaxQueue) });
      toast({ title: "Pronto! Vamos te avisar quando a fila diminuir." });
      setLeadModalOpen(false);
      setLeadName("");
      setLeadPhone("");
    } catch {
      toast({ title: "Erro ao cadastrar. Tente novamente.", variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-900 to-zinc-800 flex flex-col items-center justify-center p-4">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-white">NP Hair Express</h1>
        <p className="text-zinc-400 mt-1">Salão sem agendamento</p>
      </div>

      <Card className="w-full max-w-sm mb-6">
        <CardContent className="pt-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Users className="h-5 w-5 text-primary" />
            <span className="text-3xl font-bold">{displayCount}</span>
            <span className="text-muted-foreground">
              {displayCount === 1 ? "pessoa na fila" : "pessoas na fila"}
            </span>
          </div>
          {displayCount > 0 && (
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>Tempo estimado: ~{displayMinutes} min</span>
            </div>
          )}
          {displayCount === 0 && (
            <p className="text-green-500 font-medium">Fila vazia! Atendimento imediato.</p>
          )}
        </CardContent>
      </Card>

      <div className="w-full max-w-sm space-y-3">
        <Button className="w-full h-14 text-lg" onClick={() => navigate("/fila/comprar")}>
          Quero ser atendida
        </Button>
        <Button
          variant="outline"
          className="w-full h-12 border-amber-500/60 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
          onClick={() => setClubeModalOpen(true)}
        >
          <Crown className="h-4 w-4 mr-2" />
          Sou do Clube da Escova
        </Button>
        <Button variant="outline" className="w-full" onClick={() => setLeadModalOpen(true)}>
          <Bell className="h-4 w-4 mr-2" />
          Me avisa quando a fila diminuir
        </Button>
      </div>

      <Dialog open={clubeModalOpen} onOpenChange={setClubeModalOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-amber-500" />
              Clube da Escova
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Sua escova já está paga pela assinatura. Digite o WhatsApp usado na assinatura pra entrar na fila.
            </p>
            <div>
              <Label>WhatsApp</Label>
              <Input
                placeholder="(11) 99999-9999"
                inputMode="numeric"
                autoComplete="tel"
                name="phone"
                value={clubePhone}
                onChange={(e) => setClubePhone(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !clubeLoading) handleClubeSubmit(); }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClubeModalOpen(false)} disabled={clubeLoading}>Cancelar</Button>
            <Button onClick={handleClubeSubmit} disabled={clubeLoading}>
              {clubeLoading ? "Verificando…" : "Entrar na fila"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={leadModalOpen} onOpenChange={setLeadModalOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Receber aviso</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome</Label>
              <Input placeholder="Seu nome" value={leadName} onChange={(e) => setLeadName(e.target.value)} />
            </div>
            <div>
              <Label>WhatsApp</Label>
              <Input placeholder="(11) 99999-9999" value={leadPhone} onChange={(e) => setLeadPhone(e.target.value)} />
            </div>
            <div>
              <Label>Me avisa quando tiver menos de</Label>
              <Select value={leadMaxQueue} onValueChange={setLeadMaxQueue}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">2 pessoas</SelectItem>
                  <SelectItem value="3">3 pessoas</SelectItem>
                  <SelectItem value="5">5 pessoas</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLeadModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleLeadSubmit}>Quero ser avisada</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
