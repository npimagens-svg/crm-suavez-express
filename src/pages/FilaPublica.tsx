import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Button as NpButton, npAssets } from "@design-system";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Bell, Crown } from "lucide-react";
import { usePublicQueue } from "@/hooks/usePublicQueue";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { FilaAviso } from "@/components/queue/FilaAviso";
import { FilaAgora } from "@/components/queue/FilaAgora";

// Clube da Escova: agora exige OTP (prova de posse do telefone — falha 13).
// 1) manda o código pro WhatsApp (Edge Function clube-otp);
// 2) valida na RPC clube_entrar_fila(celular, otp), que debita o crédito
//    de forma atômica e devolve o TOKEN opaco de acompanhamento.

// Página PÚBLICA (celular, sem login): tema escuro fixo do design system aplicado aqui mesmo.
// A rota ainda recebe html.np-legacy do App.tsx; o wrapper redefine os tokens (data-theme="dark"
// + classe .dark), e os modais repetem isso porque são renderizados fora do wrapper (portal).
const PUBLIC_SHELL = "dark np-bg np-bg--waves min-h-screen text-foreground [font-family:var(--np-font-body)]";
const PUBLIC_MODAL = "dark rounded-2xl border-[color:var(--np-border-glass)] bg-[color:var(--np-surface-glass-strong)] text-foreground shadow-[var(--np-shadow-modal)] backdrop-blur-2xl [font-family:var(--np-font-body)]";

type ClubeResposta = {
  ok: boolean;
  erro?: string;
  tracking_token?: string;
  position?: number;
  nome?: string;
  usadas?: number;
  total?: number;
  valido_ate?: string | null;
  mensagem?: string;
};

// Data de fim do ciclo do Clube (timestamp do servidor) em DD/MM, fuso de Brasília.
function fmtValidoAte(iso?: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).format(new Date(iso));
}

export default function FilaPublica() {
  const navigate = useNavigate();
  const { addLead, fila, painel, services } = usePublicQueue();
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
          description: `Você entrou na fila (${resp.position}ª posição). Escova ${resp.usadas} de ${resp.total} do ciclo · válido até ${fmtValidoAte(resp.valido_ate)}.`,
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
          title: "Escovas do ciclo já usadas",
          description: `Você já usou as ${resp.total} escovas do ciclo válido até ${fmtValidoAte(resp.valido_ate)}. O próximo pagamento confirmado abre um novo ciclo.`,
          variant: "destructive",
        });
        return;
      }
      if (resp.erro === "sem_mensalidade") {
        toast({
          title: "Mensalidade do Clube não confirmada",
          description: resp.mensagem || "Não há mensalidade confirmada do Clube válida para hoje. Faça a renovação no cartão antes de liberar a escova.",
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

  const handleLeadSubmit = async () => {
    if (!leadName.trim() || !leadPhone.trim()) {
      toast({ title: "Preencha nome e WhatsApp", variant: "destructive" });
      return;
    }
    // DDD + número (10 ou 11 dígitos), aceitando +55 na frente
    const digitos = leadPhone.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
    if (digitos.length < 10 || digitos.length > 11) {
      toast({ title: "Confira o WhatsApp com DDD", variant: "destructive" });
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
    <div data-theme="dark" className={PUBLIC_SHELL}>
      <div className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
        <header className="flex flex-col items-center gap-2 text-center">
          <img src={npAssets.logo} alt="NP Hair Express" className="h-auto w-56 max-w-full" />
          <p className="np-caps">Salão sem agendamento</p>
        </header>

        <FilaAgora painel={painel} services={services} fila={fila} />

        <FilaAviso fila={fila} />

        <div className="space-y-3">
          <NpButton size="xl" block onClick={() => navigate("/fila/comprar")}>
            Quero ser atendida
          </NpButton>
          <NpButton
            variant="secondary"
            size="lg"
            block
            icon={Crown}
            className="text-[color:var(--np-accent-text)]"
            onClick={() => { resetClube(); setClubeModalOpen(true); }}
          >
            Sou do Clube da Escova
          </NpButton>
          <NpButton variant="ghost" size="lg" block icon={Bell} onClick={() => setLeadModalOpen(true)}>
            Me avisa quando a fila diminuir
          </NpButton>
        </div>
      </div>

      <Dialog open={clubeModalOpen} onOpenChange={(open) => { setClubeModalOpen(open); if (!open) resetClube(); }}>
        <DialogContent data-theme="dark" className={`sm:max-w-sm ${PUBLIC_MODAL}`}>
          <DialogHeader>
            <DialogTitle className="np-display flex items-center gap-2 text-xl">
              <Crown className="h-5 w-5 text-[color:var(--np-accent-text)]" />
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
                  className="h-12"
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
                  className="h-12"
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
                className="min-h-[44px] text-xs text-muted-foreground underline"
                onClick={handleClubeSendOtp}
                disabled={clubeLoading}
              >
                Não recebeu? Enviar outro código
              </button>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="h-12 border-border bg-transparent" onClick={() => { setClubeModalOpen(false); resetClube(); }} disabled={clubeLoading}>Cancelar</Button>
            {clubeStep === "phone" ? (
              <Button className="h-12" onClick={handleClubeSendOtp} disabled={clubeLoading}>
                {clubeLoading ? "Enviando…" : "Receber código"}
              </Button>
            ) : (
              <Button className="h-12" onClick={handleClubeSubmit} disabled={clubeLoading}>
                {clubeLoading ? "Verificando…" : "Entrar na fila"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={leadModalOpen} onOpenChange={setLeadModalOpen}>
        <DialogContent data-theme="dark" className={`sm:max-w-sm ${PUBLIC_MODAL}`}>
          <DialogHeader>
            <DialogTitle className="np-display text-xl">Receber aviso</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome</Label>
              <Input className="h-12" placeholder="Seu nome" value={leadName} onChange={(e) => setLeadName(e.target.value)} />
            </div>
            <div>
              <Label>WhatsApp</Label>
              <Input className="h-12" placeholder="(11) 99999-9999" value={leadPhone} onChange={(e) => setLeadPhone(e.target.value)} />
            </div>
            <div>
              <Label>Me avisa quando tiver menos de</Label>
              <Select value={leadMaxQueue} onValueChange={setLeadMaxQueue}>
                <SelectTrigger className="h-12"><SelectValue /></SelectTrigger>
                <SelectContent data-theme="dark" className="dark">
                  <SelectItem value="2">2 pessoas</SelectItem>
                  <SelectItem value="3">3 pessoas</SelectItem>
                  <SelectItem value="5">5 pessoas</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-12 border-border bg-transparent" onClick={() => setLeadModalOpen(false)}>Cancelar</Button>
            <Button className="h-12" onClick={handleLeadSubmit}>Quero ser avisada</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
