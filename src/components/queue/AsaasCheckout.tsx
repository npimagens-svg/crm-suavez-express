import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Copy, CheckCircle, QrCode, CreditCard, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { createCheckout, getIntentStatus } from "@/lib/asaas";
import type { CheckoutResponse } from "@/lib/asaas";

// Checkout público — fluxo novo (falhas 3/10 corrigidas):
// - PIX: QR gerado server-side (asaas-checkout) com preço do banco.
// - Cartão: checkout HOSPEDADO do Asaas (invoice_url). NUNCA coletamos
//   número de cartão/CVV — o formulário antigo foi removido de propósito.
// - Confirmação: quem cria a entrada na fila é o WEBHOOK (server-side).
//   Aqui só consultamos o status da intenção; quando vira "queued",
//   entregamos o token de acompanhamento pro fluxo seguir.

interface AsaasCheckoutProps {
  customerName: string;
  customerCpf: string;
  customerPhone: string;
  customerEmail?: string;
  serviceIds: string[];
  serviceName: string;
  servicePrice: number;
  notifyMinutes: number;
  onQueued: (trackingToken: string) => void;
  onError: (error: string) => void;
}

type PaymentMethod = "choose" | "pix" | "card";

export function AsaasCheckout({
  customerName,
  customerCpf,
  customerPhone,
  customerEmail,
  serviceIds,
  serviceName,
  servicePrice,
  notifyMinutes,
  onQueued,
  onError,
}: AsaasCheckoutProps) {
  const [method, setMethod] = useState<PaymentMethod>("choose");
  const [loading, setLoading] = useState(false);
  const [checkout, setCheckout] = useState<CheckoutResponse | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  // Idempotência: reenvio/duplo clique reaproveita a MESMA intenção no servidor
  const idempotencyKey = useRef(`${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);

  const fmt = (value: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

  const startCheckout = async (billing: "pix" | "card") => {
    setLoading(true);
    try {
      const result = await createCheckout({
        serviceIds,
        name: customerName,
        cpfCnpj: customerCpf.replace(/\D/g, ""),
        phone: customerPhone,
        email: customerEmail,
        billing,
        notifyMinutesBefore: notifyMinutes,
        idempotencyKey: `${idempotencyKey.current}_${billing}`,
      });
      setCheckout(result);
      setMethod(billing === "pix" ? "pix" : "card");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erro ao criar pagamento");
    } finally {
      setLoading(false);
    }
  };

  // Poll do status da INTENÇÃO (servidor é a fonte da verdade).
  // Mesmo que a cliente feche esta tela, o webhook coloca ela na fila.
  useEffect(() => {
    if (!checkout?.intent_id || confirmed) return;
    const interval = setInterval(async () => {
      try {
        const st = await getIntentStatus(checkout.intent_id);
        if (st.found && st.status === "queued" && st.tracking_token) {
          setConfirmed(true);
          clearInterval(interval);
          onQueued(st.tracking_token);
        }
        if (st.found && (st.status === "cancelled" || st.status === "refunded")) {
          clearInterval(interval);
          onError("Pagamento cancelado. Tente novamente.");
        }
      } catch {
        /* silently retry */
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [checkout?.intent_id, confirmed, onQueued, onError]);

  const handleCopyPix = () => {
    if (checkout?.pix_qr_code?.payload) {
      navigator.clipboard.writeText(checkout.pix_qr_code.payload);
      setCopied(true);
      toast({ title: "Código PIX copiado!" });
      setTimeout(() => setCopied(false), 3000);
    }
  };

  if (confirmed) {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <CheckCircle className="h-12 w-12 text-green-500" />
        <p className="text-lg font-semibold">Pagamento confirmado!</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Gerando pagamento...</p>
      </div>
    );
  }

  // Passo 1: escolher a forma de pagamento
  if (method === "choose") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 pt-6">
          <p className="text-lg font-semibold">{fmt(servicePrice)}</p>
          <p className="text-sm text-muted-foreground">Como deseja pagar?</p>

          <Button className="w-full h-14 text-base" onClick={() => startCheckout("pix")}>
            <QrCode className="h-5 w-5 mr-3" />
            PIX
          </Button>

          <Button variant="outline" className="w-full h-14 text-base" onClick={() => startCheckout("card")}>
            <CreditCard className="h-5 w-5 mr-3" />
            Cartão de Crédito
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Passo 2a: PIX
  if (method === "pix") {
    if (!checkout?.pix_qr_code) {
      return (
        <div className="text-center py-8">
          <p className="text-destructive">Erro ao gerar QR Code PIX.</p>
          <p className="text-sm text-muted-foreground mt-2">Tente novamente em alguns instantes.</p>
        </div>
      );
    }

    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 pt-6">
          <p className="text-lg font-semibold">{fmt(servicePrice)}</p>
          <p className="text-sm text-muted-foreground">Escaneie o QR Code ou copie o código PIX</p>
          <img
            src={`data:image/png;base64,${checkout.pix_qr_code.encodedImage}`}
            alt="QR Code PIX"
            className="w-56 h-56"
          />
          <Button variant="outline" onClick={handleCopyPix} className="w-full">
            {copied ? <CheckCircle className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
            {copied ? "Copiado!" : "Copiar código PIX"}
          </Button>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Aguardando pagamento...
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Pode fechar esta tela depois de pagar — sua vaga na fila é garantida
            assim que o pagamento confirmar.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Passo 2b: cartão — checkout HOSPEDADO do Asaas (sem coletar cartão aqui)
  if (method === "card") {
    if (!checkout?.invoice_url) {
      return (
        <div className="text-center py-8">
          <p className="text-destructive">Erro ao gerar o link de pagamento.</p>
          <p className="text-sm text-muted-foreground mt-2">Tente novamente em alguns instantes.</p>
        </div>
      );
    }

    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 pt-6">
          <p className="text-lg font-semibold">{fmt(servicePrice)}</p>
          <p className="text-sm text-muted-foreground text-center">
            Você vai pagar na página segura do Asaas. Assim que o pagamento
            confirmar, sua vaga na fila é criada automaticamente.
          </p>
          <Button
            className="w-full h-14 text-base"
            onClick={() => window.open(checkout.invoice_url!, "_blank", "noopener")}
          >
            <ExternalLink className="h-5 w-5 mr-3" />
            Pagar com cartão
          </Button>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Aguardando confirmação do pagamento...
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
}
