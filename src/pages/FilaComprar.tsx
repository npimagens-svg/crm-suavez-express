import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Check } from "lucide-react";
import { usePublicQueue } from "@/hooks/usePublicQueue";
import { useToast } from "@/hooks/use-toast";
import { AsaasCheckout } from "@/components/queue/AsaasCheckout";
import { getIntentStatus, loadPendingIntent, clearPendingIntent } from "@/lib/asaas";
import { supabase } from "@/lib/dynamicSupabaseClient";

type Step = "service" | "data" | "payment" | "confirmation";

export default function FilaComprar() {
  const navigate = useNavigate();
  const { services, settings } = usePublicQueue();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>("service");
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerCpf, setCustomerCpf] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [notifyMinutes, setNotifyMinutes] = useState("40");
  const [trackingToken, setTrackingToken] = useState("");
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  // Confirmação vinda da RECUPERAÇÃO: a antecedência real do aviso não é
  // conhecida aqui (o "40" é só default do select) — a linha do WhatsApp
  // é omitida nesse caso.
  const [recoveredConfirmation, setRecoveredConfirmation] = useState(false);
  // Permite parar o poller de recuperação de fora do effect (ex.: a cliente
  // iniciou um checkout NOVO — step foi pra "payment").
  const stopRecoveryRef = useRef<(() => void) | null>(null);

  const selectedServices = services.filter((s) => selectedServiceIds.includes(s.id));
  const totalPrice = selectedServices.reduce((sum, s) => sum + Number(s.price || 0), 0);
  const combinedName = selectedServices.map((s) => s.name).join(" + ");
  const notifyOptions = settings?.notify_options || [20, 40, 60, 90];

  const toggleService = (serviceId: string) => {
    setSelectedServiceIds((prev) =>
      prev.includes(serviceId) ? prev.filter((id) => id !== serviceId) : [...prev, serviceId]
    );
  };

  // Seções na ordem em que a RPC devolve (sort_order); título amigável por categoria.
  const CATEGORY_LABELS: Record<string, string> = {
    CABELOS: "Cabelo",
    "MANICURE E PEDICURE": "Manicure e Pedicure",
    "ESTETICA FACIAL": "Sobrancelha e Rosto",
  };
  const sections = services.reduce<{ label: string; items: typeof services }[]>((acc, s) => {
    const label = CATEGORY_LABELS[s.category ?? ""] ?? "Outros";
    const last = acc[acc.length - 1];
    if (last && last.label === label) last.items.push(s);
    else acc.push({ label, items: [s] });
    return acc;
  }, []);

  const handleDataSubmit = async () => {
    if (!customerName.trim() || !customerPhone.trim() || !customerCpf.trim()) {
      toast({ title: "Preencha nome, CPF e WhatsApp", variant: "destructive" });
      return;
    }
    const cpfDigits = customerCpf.replace(/\D/g, "");
    if (cpfDigits.length !== 11 || /^(\d)\1+$/.test(cpfDigits)) {
      toast({ title: "CPF inválido", variant: "destructive" });
      return;
    }
    // Validate CPF check digits
    const calcDigit = (slice: string, factor: number) => {
      let sum = 0;
      for (let i = 0; i < slice.length; i++) sum += parseInt(slice[i]) * (factor - i);
      const rest = sum % 11;
      return rest < 2 ? 0 : 11 - rest;
    };
    if (calcDigit(cpfDigits.slice(0, 9), 10) !== parseInt(cpfDigits[9]) ||
        calcDigit(cpfDigits.slice(0, 10), 11) !== parseInt(cpfDigits[10])) {
      toast({ title: "CPF inválido", variant: "destructive" });
      return;
    }
    setStep("payment");
  };

  // O WEBHOOK criou a entrada na fila (server-side). Aqui só recebemos o
  // token opaco de acompanhamento e mostramos a posição.
  const handleQueued = async (token: string) => {
    setRecoveredConfirmation(false); // compra feita AQUI: antecedência conhecida
    setTrackingToken(token);
    try {
      localStorage.setItem("fila_tracking_token", token);
    } catch { /* storage indisponível não impede o fluxo */ }
    try {
      const { data } = await supabase.rpc("fila_minha_situacao", { p_token: token });
      const info = data as { found?: boolean; people_ahead?: number } | null;
      if (info?.found) setQueuePosition((info.people_ahead ?? 0) + 1);
    } catch { /* posição é cosmética aqui */ }
    setStep("confirmation");
  };

  // RECUPERAÇÃO (caso real: pagou e fechou o navegador antes da confirmação).
  // A entrada já nasceu no servidor via webhook — aqui reencontramos ela pela
  // intenção pendente salva no localStorage e entregamos token + posição.
  // O navegador nunca insere na fila, só consulta. Blindagens:
  // - RE-LÊ a chave antes de agir: se o AsaasCheckout salvou uma intent NOVA
  //   na mesma chave, este poller (que carrega a intent da montagem) para sem
  //   apagar nada nem chamar handleQueued com token velho.
  // - Valida via fila_minha_situacao que a entrada ainda está ATIVA
  //   (waiting/checked_in): compra antiga já atendida/cancelada não mostra
  //   "Você entrou na fila!" — limpa a chave em silêncio e segue o fluxo.
  // - Teto de polling: 5s nos 2 primeiros minutos, depois 30s, e para de vez
  //   após ~30min (a chave fica no localStorage pro próximo acesso).
  useEffect(() => {
    const pendingIntent = loadPendingIntent();
    if (!pendingIntent) return;
    let cancelled = false;
    let stopped = false;
    let timer: number | undefined;
    const startedAt = Date.now();

    const stop = () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
    stopRecoveryRef.current = stop;

    // A chave ainda aponta pra intent que este poller está consultando?
    // (um checkout novo pode ter sobrescrito — ou limpado — a mesma chave)
    const stillOurs = () => loadPendingIntent() === pendingIntent;

    const check = async () => {
      try {
        if (!stillOurs()) {
          stop();
          return;
        }
        const st = await getIntentStatus(pendingIntent);
        if (cancelled || stopped) return;
        if (st.found && st.status === "queued" && st.tracking_token) {
          const token = st.tracking_token;
          // Entrada ainda ATIVA na fila? Compra antiga já atendida/cancelada
          // não pode reabrir a confirmação nem travar uma compra nova.
          const { data, error } = await supabase.rpc("fila_minha_situacao", { p_token: token });
          if (cancelled || stopped) return;
          // supabase-js v2 NÃO lança: falha transitória vira error preenchido.
          // Sem stop nem clearPendingIntent — tenta de novo no próximo tick.
          if (error) return;
          const situacao = data as { found?: boolean; status?: string; people_ahead?: number } | null;
          const ativa = !!situacao?.found && ["waiting", "checked_in"].includes(situacao?.status ?? "");
          if (!stillOurs()) {
            stop();
            return;
          }
          stop();
          clearPendingIntent();
          if (!ativa) return; // fila já resolvida: segue o fluxo normal de compra
          setTrackingToken(token);
          try {
            localStorage.setItem("fila_tracking_token", token);
          } catch { /* storage indisponível não impede o fluxo */ }
          setQueuePosition((situacao?.people_ahead ?? 0) + 1);
          setRecoveredConfirmation(true);
          setStep("confirmation");
        } else if (!st.found || st.status === "cancelled" || st.status === "refunded" || st.status === "chargeback") {
          stop();
          if (stillOurs()) clearPendingIntent();
        }
        // pending/paid: o webhook pode estar a caminho — continua consultando
      } catch { /* rede oscilou: tenta de novo no próximo tick */ }
    };

    const tick = async () => {
      await check();
      if (cancelled || stopped) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed >= 30 * 60 * 1000) {
        stop(); // intent 'pending' não martela a RPC pra sempre
        return;
      }
      timer = window.setTimeout(tick, elapsed < 2 * 60 * 1000 ? 5000 : 30000);
    };

    tick();
    return () => {
      cancelled = true;
      stop();
      if (stopRecoveryRef.current === stop) stopRecoveryRef.current = null;
    };
    // roda UMA vez, na montagem — a intent pendente é a daquele momento
  }, []);

  // Checkout NOVO iniciado (step chegou em "payment"): o poller de recuperação
  // para na hora — a partir daqui a intent da chave é a da compra nova.
  useEffect(() => {
    if (step === "payment") stopRecoveryRef.current?.();
  }, [step]);

  const fmt = (value: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-900 to-zinc-800 p-4">
      <div className="max-w-sm mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={() => {
            if (step === "service") navigate("/fila");
            else if (step === "data") setStep("service");
          }}>
            <ArrowLeft className="h-5 w-5 text-white" />
          </Button>
          <h1 className="text-xl font-bold text-white">
            {step === "service" && "Escolha o serviço"}
            {step === "data" && "Seus dados"}
            {step === "payment" && "Pagamento"}
            {step === "confirmation" && "Confirmado!"}
          </h1>
        </div>

        {step === "service" && (
          <div className="space-y-3 pb-24">
            <p className="text-sm text-zinc-400">
              Toque para escolher um ou mais serviços. O preço é final — cabelo longo (passa da linha do busto) já tem o próprio preço.
            </p>
            {services.length === 0 && (
              <p className="text-center text-zinc-400 py-8">Nenhum serviço disponível no momento.</p>
            )}
            {sections.map((section) => (
              <div key={section.label} className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400 pt-2">{section.label}</h2>
                {section.items.map((service) => {
                  const isSelected = selectedServiceIds.includes(service.id);
                  return (
                    <Card key={service.id} className={`cursor-pointer transition-colors ${isSelected ? "border-primary ring-1 ring-primary" : "hover:border-primary"}`} onClick={() => toggleService(service.id)}>
                      <CardContent className="flex justify-between items-center py-4">
                        <div className="flex items-center gap-3">
                          <div className={`h-5 w-5 rounded-full border flex items-center justify-center shrink-0 ${isSelected ? "bg-primary border-primary" : "border-zinc-400"}`}>
                            {isSelected && <Check className="h-3.5 w-3.5 text-white" />}
                          </div>
                          <div>
                            <p className="font-medium">{service.name}</p>
                            {service.description && (
                              <p className="text-xs text-muted-foreground">{service.description}</p>
                            )}
                            <p className="text-sm text-muted-foreground">{service.duration_minutes} min</p>
                          </div>
                        </div>
                        <p className="font-semibold text-primary whitespace-nowrap pl-2">{fmt(service.price)}</p>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ))}
            {selectedServiceIds.length > 0 && (
              <div className="fixed bottom-0 left-0 right-0 p-4 bg-zinc-900/95 border-t border-zinc-700">
                <div className="max-w-sm mx-auto">
                  <Button className="w-full" onClick={() => setStep("data")}>
                    Continuar · {selectedServiceIds.length} {selectedServiceIds.length === 1 ? "serviço" : "serviços"} · {fmt(totalPrice)}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {step === "data" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{combinedName} — {fmt(totalPrice)}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div><Label>Nome</Label><Input placeholder="Seu nome completo" value={customerName} onChange={(e) => setCustomerName(e.target.value)} /></div>
              <div><Label>CPF</Label><Input placeholder="000.000.000-00" inputMode="numeric" autoComplete="cpf" name="cpf" value={customerCpf} onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 11);
                const formatted = v.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
                setCustomerCpf(formatted);
              }} /></div>
              <div><Label>WhatsApp</Label><Input placeholder="(11) 99999-9999" inputMode="numeric" autoComplete="tel" name="phone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} /></div>
              <div><Label>E-mail (opcional)</Label><Input placeholder="seu@email.com" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} /></div>
              <div>
                <Label>Me avise com antecedência de</Label>
                <Select value={notifyMinutes} onValueChange={setNotifyMinutes}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {notifyOptions.map((min: number) => (
                      <SelectItem key={min} value={String(min)}>{min} minutos</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button className="w-full" onClick={handleDataSubmit}>Ir para pagamento</Button>
            </CardContent>
          </Card>
        )}

        {step === "payment" && selectedServices.length > 0 && (
          <AsaasCheckout
            customerName={customerName}
            customerCpf={customerCpf}
            customerPhone={customerPhone}
            customerEmail={customerEmail || undefined}
            serviceIds={selectedServiceIds}
            serviceName={combinedName}
            servicePrice={totalPrice}
            notifyMinutes={parseInt(notifyMinutes)}
            onQueued={handleQueued}
            onError={(err) => toast({ title: err, variant: "destructive" })}
          />
        )}

        {step === "confirmation" && (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 pt-6">
              <div className="h-16 w-16 rounded-full bg-green-500/20 flex items-center justify-center">
                <Check className="h-8 w-8 text-green-500" />
              </div>
              <h2 className="text-xl font-bold">Você entrou na fila!</h2>
              {queuePosition !== null && (
                <p className="text-2xl font-bold text-primary">{queuePosition}ª posição</p>
              )}
              {!recoveredConfirmation && (
                <p className="text-sm text-muted-foreground text-center">
                  Você receberá um aviso no WhatsApp {notifyMinutes} minutos antes do seu atendimento.
                </p>
              )}
              <Button className="w-full" onClick={() => navigate(`/fila/acompanhar/${trackingToken}`)}>
                Acompanhar minha posição
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
