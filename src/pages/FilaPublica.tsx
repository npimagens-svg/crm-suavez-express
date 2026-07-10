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

// Clube da Escova: agora exige OTP (prova de posse do telefone — falha 13).
// 1) manda o código pro WhatsApp (Edge Function clube-otp);
// 2) valida na RPC clube_entrar_fila(celular, otp), que debita o crédito
//    de forma atômica e devolve o TOKEN opaco de acompanhamento.

type ClubeResposta = {
  ok: boolean;
  erro?: string;
  tracking_token?: string;
  position?: number;
  nome?: string;
  usadas?: number;
  total?: number;
};

export default function FilaPublica() {
  const navigate = useNavigate();
  const { stats, settings, addLead } = usePublicQueue();
  const { toast } = useToast();

  const [leadModalOpen, setLeadModalOpen] = useState(false);
  const [leadName, setLeadName] = useState("");
  const [leadPhone, setLeadPhone] = useState("");
  const [leadMaxQueue, setLeadMaxQueue] = useState("3");

  const [clubeModalOpen, setClubeModalOpen] = useState(false);
  const [clubePhone, setClubePhone] = useState("");
  const [clubeOtp, setClubeOtp] = useState("");
  const [clubeStep, setClubeStep] = useState<"phone" | "otp">("phone");
  const [clubeLoading, setClubeLoading] = useState(false);

  const resetClube = () => {
    setClubeStep("phone");
    setClubeOtp("");
    setClubeLoading(false);
  };

  const handleClubeSendOtp = async () => {
    if (clubePhone.replace(/\D/g, "").length < 10) {
      toast({ title: "Digite seu WhatsApp com DDD", variant: "destructive" });
      return;
    }
    setClubeLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("clube-otp", {
        body: { celular: clubePhone },
      });
      if (error) throw error;
      if (data?.erro === "muitas_tentativas") {
        toast({ title: "Muitos códigos pedidos", description: "Aguarde alguns minutos e tente de novo.", variant: "destructive" });
        return;
      }
      if (data?.erro === "otp_indisponivel" || data?.erro === "envio_falhou") {
        toast({ title: "Envio do código indisponível", description: "Fale com a recepção para entrar na fila do Clube.", variant: "destructive" });
        return;
      }
      setClubeStep("otp");
      toast({ title: "Código enviado!", description: "Confira seu WhatsApp e digite o código de 6 dígitos." });
    } catch {
      toast({ title: "Erro ao enviar o código. Tente de novo.", variant: "destructive" });
    } finally {
      setClubeLoading(false);
    }
  };

  const handleClubeSubmit = async () => {
    if (clubeOtp.replace(/\D/g, "").length !== 6) {
      toast({ title: "Digite o código de 6 dígitos", variant: "destructive" });
      return;
    }
    setClubeLoading(true);
    try {
      const { data, error } = await supabase.rpc("clube_entrar_fila", {
        p_celular: clubePhone,
        p_otp: clubeOtp.replace(/\D/g, ""),
      });
      if (error) throw error;
      const resp = data as ClubeResposta;

      if (resp.ok && resp.tracking_token) {
        setClubeModalOpen(false);
        resetClube();
        toast({
          title: `Bem-vinda, ${(resp.nome || "").split(" ")[0] || "assinante"}!`,
          description: `Você entrou na fila (${resp.position}ª posição). Escova ${resp.usadas} de ${resp.total} do mês.`,
        });
        try {
          localStorage.setItem("fila_tracking_token", resp.tracking_token);
        } catch { /* sem storage, segue o fluxo */ }
        navigate(`/fila/acompanhar/${resp.tracking_token}`);
        return;
      }

      if (resp.erro === "ja_na_fila") {
        setClubeModalOpen(false);
        resetClube();
        toast({ title: "Você já está na fila!", description: `Sua posição: ${resp.position}ª.` });
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
      if (resp.erro === "otp_incorreto") {
        toast({ title: "Código incorreto", description: "Confira o código no seu WhatsApp.", variant: "destructive" });
        return;
      }
      if (resp.erro === "otp_expirado" || resp.erro === "otp_bloqueado") {
        setClubeStep("phone");
        setClubeOtp("");
        toast({ title: "Código expirado", description: "Peça um novo código.", variant: "destructive" });
        return;
      }
      toast({ title: "Não foi possível entrar na fila. Tente de novo.", variant: "destructive" });
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
          onClick={() => { resetClube(); setClubeModalOpen(true); }}
        >
          <Crown className="h-4 w-4 mr-2" />
          Sou do Clube da Escova
        </Button>
        <Button variant="outline" className="w-full" onClick={() => setLeadModalOpen(true)}>
          <Bell className="h-4 w-4 mr-2" />
          Me avisa quando a fila diminuir
        </Button>
      </div>

      <Dialog open={clubeModalOpen} onOpenChange={(open) => { setClubeModalOpen(open); if (!open) resetClube(); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-amber-500" />
              Clube da Escova
            </DialogTitle>
          </DialogHeader>
          {clubeStep === "phone" ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Sua escova já está paga pela assinatura. Digite o WhatsApp usado
                na assinatura — vamos te mandar um código de confirmação.
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
                  onKeyDown={(e) => { if (e.key === "Enter" && !clubeLoading) handleClubeSendOtp(); }}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Enviamos um código de 6 dígitos pro seu WhatsApp. Digite abaixo.
              </p>
              <div>
                <Label>Código</Label>
                <Input
                  placeholder="000000"
                  inputMode="numeric"
                  maxLength={6}
                  value={clubeOtp}
                  onChange={(e) => setClubeOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  onKeyDown={(e) => { if (e.key === "Enter" && !clubeLoading) handleClubeSubmit(); }}
                />
              </div>
              <button
                type="button"
                className="text-xs text-muted-foreground underline"
                onClick={handleClubeSendOtp}
                disabled={clubeLoading}
              >
                Não recebeu? Enviar outro código
              </button>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setClubeModalOpen(false); resetClube(); }} disabled={clubeLoading}>Cancelar</Button>
            {clubeStep === "phone" ? (
              <Button onClick={handleClubeSendOtp} disabled={clubeLoading}>
                {clubeLoading ? "Enviando…" : "Receber código"}
              </Button>
            ) : (
              <Button onClick={handleClubeSubmit} disabled={clubeLoading}>
                {clubeLoading ? "Verificando…" : "Entrar na fila"}
              </Button>
            )}
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
