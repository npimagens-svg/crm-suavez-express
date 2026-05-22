import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowDownCircle, ArrowUpCircle, Loader2 } from "lucide-react";
import { useCaixaMovements, CaixaMovementType, CaixaMovementMethod } from "@/hooks/useCaixaMovements";

interface SangriaSuprimentoModalProps {
  open: boolean;
  onClose: () => void;
  caixaId: string;
  defaultType?: CaixaMovementType;
}

const METHOD_LABEL: Record<CaixaMovementMethod, string> = {
  cash: "Dinheiro",
  pix: "PIX",
  credit_card: "Cartão Crédito",
  debit_card: "Cartão Débito",
  other: "Outro",
};

export function SangriaSuprimentoModal({ open, onClose, caixaId, defaultType = "sangria" }: SangriaSuprimentoModalProps) {
  const { createMovementAsync, isCreating } = useCaixaMovements(caixaId);
  const [type, setType] = useState<CaixaMovementType>(defaultType);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<CaixaMovementMethod>("cash");

  useEffect(() => {
    if (open) {
      setType(defaultType);
      setAmount("");
      setReason("");
      setMethod("cash");
    }
  }, [open, defaultType]);

  const parsedAmount = parseFloat(amount.replace(/\./g, "").replace(",", ".")) || 0;
  const canSubmit = parsedAmount > 0 && reason.trim().length > 0 && !isCreating;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      await createMovementAsync({
        caixa_id: caixaId,
        type,
        amount: parsedAmount,
        reason: reason.trim(),
        payment_method: method,
      });
      onClose();
    } catch {
      // toast já tratado no hook
    }
  };

  const isSangria = type === "sangria";
  const Icon = isSangria ? ArrowDownCircle : ArrowUpCircle;
  const color = isSangria ? "text-red-600" : "text-green-600";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className={`h-5 w-5 ${color}`} />
            {isSangria ? "Sangria (saída de dinheiro)" : "Suprimento (entrada de dinheiro)"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={isSangria ? "default" : "outline"}
              className={isSangria ? "bg-red-600 hover:bg-red-700" : ""}
              onClick={() => setType("sangria")}
            >
              <ArrowDownCircle className="mr-2 h-4 w-4" /> Sangria
            </Button>
            <Button
              type="button"
              variant={!isSangria ? "default" : "outline"}
              className={!isSangria ? "bg-green-600 hover:bg-green-700" : ""}
              onClick={() => setType("suprimento")}
            >
              <ArrowUpCircle className="mr-2 h-4 w-4" /> Suprimento
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="movAmount">Valor (R$)</Label>
            <Input
              id="movAmount"
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="movMethod">Forma</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as CaixaMovementMethod)}>
              <SelectTrigger id="movMethod">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(METHOD_LABEL) as CaixaMovementMethod[]).map((m) => (
                  <SelectItem key={m} value={m}>{METHOD_LABEL[m]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {isSangria ? "Subtrai" : "Adiciona"} do total dessa forma no caixa.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="movReason">Motivo *</Label>
            <Textarea
              id="movReason"
              placeholder={isSangria
                ? "Ex: Pagamento entregador Burguer King, troco quebrado, retirada Vanessa..."
                : "Ex: Vanessa trouxe troco do banco, cliente pagou dívida antiga em dinheiro..."}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">Obrigatório. Aparece no relatório do caixa.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isCreating}>Cancelar</Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={isSangria ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"}
          >
            {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isSangria ? "Registrar sangria" : "Registrar suprimento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
