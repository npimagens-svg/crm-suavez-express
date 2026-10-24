import { useEffect, useState } from "react";
import { glassModal, modalTitle } from "@/components/financeiro/glass";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { CATEGORIAS_MANUAIS, hojeSP, type Entrada } from "@/lib/entradas";
import type { EntradaInput } from "@/hooks/useEntradas";

interface EntradaModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: EntradaInput | (EntradaInput & { id: string })) => void;
  /** Entrada manual em edição (id no formato "tx-<uuid>"); null = nova. */
  entrada: Entrada | null;
  isLoading: boolean;
}

const vazio = (): EntradaInput => ({
  transaction_date: hojeSP(),
  amount: 0,
  description: "",
  category: "Outros",
});

export function EntradaModal({ open, onClose, onSave, entrada, isLoading }: EntradaModalProps) {
  const isEdit = !!entrada;
  const [form, setForm] = useState<EntradaInput>(vazio);

  useEffect(() => {
    if (entrada) {
      setForm({
        transaction_date: entrada.dataSP,
        amount: entrada.valor,
        description: entrada.descricao,
        category: entrada.categoria && (CATEGORIAS_MANUAIS as readonly string[]).includes(entrada.categoria)
          ? entrada.categoria
          : "Outros",
      });
    } else {
      setForm(vazio());
    }
  }, [entrada, open]);

  const valido = !!form.transaction_date && form.amount > 0 && !!form.description.trim();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valido) return;
    const data: EntradaInput = { ...form, description: form.description.trim() };
    if (isEdit && entrada) {
      onSave({ ...data, id: entrada.id.replace(/^tx-/, "") });
    } else {
      onSave(data);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={`max-w-lg max-h-[90vh] overflow-y-auto ${glassModal}`}>
        <DialogHeader>
          <DialogTitle className={modalTitle}>{isEdit ? "Editar entrada" : "Nova entrada"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>Data *</Label>
              <Input
                type="date"
                value={form.transaction_date}
                onChange={(e) => setForm({ ...form, transaction_date: e.target.value })}
                required
              />
            </div>
            <div>
              <Label>Valor (R$) *</Label>
              <Input
                type="number"
                step="0.01"
                min={0.01}
                inputMode="decimal"
                value={form.amount || ""}
                onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
                aria-invalid={form.amount <= 0}
                required
              />
            </div>
          </div>

          <div>
            <Label>Descrição *</Label>
            <Input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Ex: Aporte para pagar fornecedor"
              required
            />
          </div>

          <div>
            <Label>Categoria</Label>
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIAS_MANUAIS.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={isLoading || !valido}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit ? "Salvar" : "Lançar entrada"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
