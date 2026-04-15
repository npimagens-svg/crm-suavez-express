import { useState } from "react";
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
import { notifyQueueEntry, notifyReception } from "@/lib/queueNotifications";
import { supabase } from "@/lib/dynamicSupabaseClient";

const SITE_URL = window.location.origin;

type Step = "service" | "data" | "payment" | "confirmation";

export default function FilaComprar() {
  const navigate = useNavigate();
  const { salonId, services, settings, addToQueue, activeEntries } = usePublicQueue();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>("service");
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [notifyMinutes, setNotifyMinutes] = useState("40");
  const [queueEntryId, setQueueEntryId] = useState("");
  const [queuePosition, setQueuePosition] = useState(0);

  const selectedService = services.find((s: any) => s.id === selectedServiceId);
  const notifyOptions = settings?.notify_options || [20, 40, 60, 90];
  const effectiveSalonId = salonId || "";

  const handleServiceSelect = (serviceId: string) => {
    setSelectedServiceId(serviceId);
    setStep("data");
  };

  const handleDataSubmit = async () => {
    if (!customerName.trim() || !customerPhone.trim()) {
      toast({ title: "Preencha nome e WhatsApp", variant: "destructive" });
      return;
    }
    try {
      const entry = await addToQueue({
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim(),
        customer_email: customerEmail.trim() || undefined,
        service_id: selectedServiceId,
        notify_minutes_before: parseInt(notifyMinutes),
      });
      setQueueEntryId(entry.id);
      setQueuePosition(entry.position);
      setStep("payment");
    } catch {
      toast({ title: "Erro ao entrar na fila", variant: "destructive" });
    }
  };

  const handlePaymentConfirmed = async (paymentId: string) => {
    await supabase
      .from("queue_entries")
      .update({ payment_id: paymentId, payment_status: "confirmed", updated_at: new Date().toISOString() })
      .eq("id", queueEntryId);

    const trackingUrl = `${SITE_URL}/fila/acompanhar/${queueEntryId}`;

    await notifyQueueEntry(effectiveSalonId, {
      customer_phone: customerPhone,
      customer_email: customerEmail || null,
      customer_name: customerName,
    }, "entered", { position: queuePosition, trackingUrl });

    await notifyReception(effectiveSalonId,
      "Nova cliente na fila!",
      `${customerName} comprou ${selectedService?.name} e entrou na fila (posição ${queuePosition}).`
    );

    setStep("confirmation");
  };

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
          <div className="space-y-3">
            {services.length === 0 && (
              <p className="text-center text-zinc-400 py-8">Nenhum serviço disponível no momento.</p>
            )}
            {services.map((service: any) => (
              <Card key={service.id} className="cursor-pointer hover:border-primary transition-colors" onClick={() => handleServiceSelect(service.id)}>
                <CardContent className="flex justify-between items-center py-4">
                  <div>
                    <p className="font-medium">{service.name}</p>
                    <p className="text-sm text-muted-foreground">{service.duration_minutes} min</p>
                  </div>
                  <p className="font-semibold text-primary">{fmt(service.price)}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {step === "data" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{selectedService?.name} — {fmt(selectedService?.price || 0)}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div><Label>Nome</Label><Input placeholder="Seu nome completo" value={customerName} onChange={(e) => setCustomerName(e.target.value)} /></div>
              <div><Label>WhatsApp</Label><Input placeholder="(11) 99999-9999" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} /></div>
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

        {step === "payment" && selectedService && (
          <AsaasCheckout
            salonId={effectiveSalonId}
            customerName={customerName}
            customerPhone={customerPhone}
            customerEmail={customerEmail || undefined}
            serviceName={selectedService.name}
            servicePrice={selectedService.price}
            queueEntryId={queueEntryId}
            onPaymentConfirmed={handlePaymentConfirmed}
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
              <p className="text-2xl font-bold text-primary">{queuePosition}ª posição</p>
              <p className="text-sm text-muted-foreground text-center">
                Você receberá um aviso no WhatsApp {notifyMinutes} minutos antes do seu atendimento.
              </p>
              <Button className="w-full" onClick={() => navigate(`/fila/acompanhar/${queueEntryId}`)}>
                Acompanhar minha posição
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
