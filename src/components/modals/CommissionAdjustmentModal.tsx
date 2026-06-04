import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Gift, MinusCircle, Loader2 } from "lucide-react";
import type { AdjustmentType, CommissionAdjustmentInput } from "@/hooks/useCommissionAdjustments";

interface CommissionAdjustmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: AdjustmentType;
  professionalId: string;
  professionalName: string;
  createdByName?: string | null;
  onSubmit: (input: CommissionAdjustmentInput) => void;
  isSubmitting?: boolean;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export function CommissionAdjustmentModal({
  open,
  onOpenChange,
  type,
  professionalId,
  professionalName,
  createdByName,
  onSubmit,
  isSubmitting,
}: CommissionAdjustmentModalProps) {
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (open) {
      setDate(todayIso());
      setAmount("");
      setDescription("");
    }
  }, [open]);

  const isBonus = type === "bonus";
  const title = isBonus ? "Adicionar Bônus" : "Adicionar Desconto";
  const Icon = isBonus ? Gift : MinusCircle;
  const iconColor = isBonus ? "text-green-600" : "text-destructive";
  const buttonClass = isBonus
    ? "bg-green-600 hover:bg-green-700 text-white"
    : "bg-destructive hover:bg-destructive/90 text-destructive-foreground";
  const parsedAmount = parseFloat(amount.replace(",", "."));
  const canSubmit =
    !!date &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0 &&
    description.trim().length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      professional_id: professionalId,
      adjustment_date: date,
      adjustment_type: type,
      amount: parsedAmount,
      description: description.trim(),
      created_by_name: createdByName ?? null,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className={`h-5 w-5 ${iconColor}`} />
            {title}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-md bg-muted/40 p-3 text-sm">
            <p>
              <span className="font-semibold">Profissional:</span> {professionalName}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="adj-date">Data *</Label>
              <Input
                id="adj-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adj-amount">Valor (R$) *</Label>
              <Input
                id="adj-amount"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0,00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="adj-description">Motivo *</Label>
            <Textarea
              id="adj-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                isBonus
                  ? "Ex: Indicou cliente novo, bateu meta, gorjeta extra..."
                  : "Ex: Faltou segunda, adiantamento, quebra..."
              }
              rows={2}
              required
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" className={buttonClass} disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" /> Salvando...
                </>
              ) : (
                `Adicionar ${isBonus ? "Bônus" : "Desconto"}`
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
