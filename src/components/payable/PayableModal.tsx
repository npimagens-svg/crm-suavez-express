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
import { useSuppliers } from "@/hooks/useSuppliers";
import { AccountPayable, PayableInput } from "@/hooks/useAccountsPayable";

interface PayableModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: PayableInput | (PayableInput & { id: string })) => void;
  payable: AccountPayable | null;
  isLoading: boolean;
}

const CATEGORIAS = [
  "Estoque",
  "Estoque - Keune",
  "Estoque - Truss",
  "Aluguel",
  "Energia",
  "Água",
  "Internet",
  "Telefone",
  "Folha de Pagamento",
  "Impostos",
  "Marketing",
  "Manutenção",
  "Outros",
];

const PAYMENT_METHODS = [
  { value: "boleto", label: "Boleto" },
  { value: "pix", label: "PIX" },
  { value: "cartao_credito", label: "Cartão de Crédito" },
  { value: "cartao_debito", label: "Cartão de Débito" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "transferencia", label: "Transferência" },
];

export function PayableModal({ open, onClose, onSave, payable, isLoading }: PayableModalProps) {
  const { suppliers } = useSuppliers();
  const isEdit = !!payable;

  const [form, setForm] = useState<PayableInput>({
    supplier_id: null,
    nf_numero: "",
    nf_serie: "",
    parcela: 1,
    total_parcelas: 1,
    valor_original: 0,
    emissao: null,
    due_date: new Date().toISOString().slice(0, 10),
    description: "",
    category: "Estoque",
    payment_method: "boleto",
    notes: "",
  });

  useEffect(() => {
    if (payable) {
      setForm({
        supplier_id: payable.supplier_id,
        nf_numero: payable.nf_numero ?? "",
        nf_serie: payable.nf_serie ?? "",
        parcela: payable.parcela,
        total_parcelas: payable.total_parcelas,
        valor_original: Number(payable.valor_original),
        emissao: payable.emissao,
        due_date: payable.due_date,
        description: payable.description,
        category: payable.category ?? "Estoque",
        payment_method: payable.payment_method ?? "boleto",
        notes: payable.notes ?? "",
      });
    } else {
      setForm({
        supplier_id: null,
        nf_numero: "",
        nf_serie: "",
        parcela: 1,
        total_parcelas: 1,
        valor_original: 0,
        emissao: null,
        due_date: new Date().toISOString().slice(0, 10),
        description: "",
        category: "Estoque",
        payment_method: "boleto",
        notes: "",
      });
    }
  }, [payable, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.description || !form.due_date || !form.valor_original) return;
    if (isEdit && payable) {
      onSave({ ...form, id: payable.id });
    } else {
      onSave(form);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar conta a pagar" : "Nova conta a pagar"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>Fornecedor</Label>
              <Select
                value={form.supplier_id ?? "none"}
                onValueChange={(v) => setForm({ ...form, supplier_id: v === "none" ? null : v })}
              >
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Sem fornecedor —</SelectItem>
                  {suppliers?.map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Categoria</Label>
              <Select
                value={form.category ?? "Estoque"}
                onValueChange={(v) => setForm({ ...form, category: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIAS.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Descrição *</Label>
            <Input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Ex: Boleto 1/3 NF 256241 BeautyBiz/Keune"
              required
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <Label>NF Número</Label>
              <Input value={form.nf_numero ?? ""} onChange={(e) => setForm({ ...form, nf_numero: e.target.value })} />
            </div>
            <div>
              <Label>NF Série</Label>
              <Input value={form.nf_serie ?? ""} onChange={(e) => setForm({ ...form, nf_serie: e.target.value })} />
            </div>
            <div>
              <Label>Parcela</Label>
              <Input type="number" min={1} value={form.parcela} onChange={(e) => setForm({ ...form, parcela: parseInt(e.target.value) || 1 })} />
            </div>
            <div>
              <Label>Total Parcelas</Label>
              <Input type="number" min={1} value={form.total_parcelas} onChange={(e) => setForm({ ...form, total_parcelas: parseInt(e.target.value) || 1 })} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label>Valor Original (R$) *</Label>
              <Input type="number" step="0.01" min={0} value={form.valor_original} onChange={(e) => setForm({ ...form, valor_original: parseFloat(e.target.value) || 0 })} required />
            </div>
            <div>
              <Label>Emissão</Label>
              <Input type="date" value={form.emissao ?? ""} onChange={(e) => setForm({ ...form, emissao: e.target.value || null })} />
            </div>
            <div>
              <Label>Vencimento *</Label>
              <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} required />
            </div>
          </div>

          <div>
            <Label>Forma de Pagamento</Label>
            <Select value={form.payment_method ?? "boleto"} onValueChange={(v) => setForm({ ...form, payment_method: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (<SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Observações</Label>
            <Textarea value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
