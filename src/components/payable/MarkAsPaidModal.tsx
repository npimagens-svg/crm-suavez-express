import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { AccountPayable, MarkAsPaidInput } from "@/hooks/useAccountsPayable";

interface MarkAsPaidModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: MarkAsPaidInput) => void;
  payable: AccountPayable | null;
  isLoading: boolean;
}

const PAYMENT_METHODS = [
  { value: "boleto", label: "Boleto" },
  { value: "pix", label: "PIX" },
  { value: "cartao_credito", label: "Cartão de Crédito" },
  { value: "cartao_debito", label: "Cartão de Débito" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "transferencia", label: "Transferência" },
];

function brl(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function MarkAsPaidModal({ open, onClose, onSubmit, payable, isLoading }: MarkAsPaidModalProps) {
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [juros, setJuros] = useState(0);
  const [desconto, setDesconto] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState("boleto");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open && payable) {
      setPaidAt(new Date().toISOString().slice(0, 10));
      setJuros(0);
      setDesconto(0);
      setPaymentMethod(payable.payment_method ?? "boleto");
      setNotes("");
    }
  }, [open, payable]);

  if (!payable) return null;

  const valorOriginal = Number(payable.valor_original);
  const valorPago = valorOriginal + Number(juros || 0) - Number(desconto || 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      id: payable.id,
      paid_at: paidAt,
      valor_pago: valorPago,
      juros: Number(juros) || 0,
      desconto: Number(desconto) || 0,
      payment_method: paymentMethod,
      notes: notes || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Marcar como paga</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-md bg-muted p-3 text-sm">
            <p className="font-medium">{payable.description}</p>
            <p className="text-muted-foreground mt-1">
              Valor original: <span className="font-semibold">{brl(valorOriginal)}</span> ·
              Vencimento: {new Date(payable.due_date).toLocaleDateString("pt-BR", { timeZone: "UTC" })}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>Data do pagamento *</Label>
              <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} required />
            </div>
            <div>
              <Label>Forma de Pagamento</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (<SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Juros (R$)</Label>
              <Input type="number" step="0.01" min={0} value={juros} onChange={(e) => setJuros(parseFloat(e.target.value) || 0)} />
            </div>
            <div>
              <Label>Desconto (R$)</Label>
              <Input type="number" step="0.01" min={0} value={desconto} onChange={(e) => setDesconto(parseFloat(e.target.value) || 0)} />
            </div>
          </div>

          <div className="rounded-md border p-3 bg-primary/5">
            <p className="text-sm text-muted-foreground">Valor a registrar como pago:</p>
            <p className="text-2xl font-bold">{brl(valorPago)}</p>
          </div>

          <div>
            <Label>Observação</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Ex: pago via internet banking" />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar pagamento
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
