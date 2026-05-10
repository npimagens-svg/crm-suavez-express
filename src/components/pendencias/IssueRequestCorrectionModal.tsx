// @ts-nocheck
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRequestCorrection } from "@/hooks/useClosureIssues";

interface Props {
  open: boolean;
  onClose: () => void;
  issue: any;
}

function buildDefaultMessage(issue: any) {
  const profName = issue?.professionals?.name ?? "profissional";
  const comandaNum = issue?.comandas?.comanda_number ?? "—";
  const clientName = issue?.comandas?.clients?.name ?? "cliente";
  const date = issue?.detected_date ?? "";
  const description = issue?.description ?? "";

  return `Oi ${profName}, tudo bem?

Identifiquei uma divergência na *comanda #${comandaNum}* de _${clientName}_ (${date}):

${description}

Pode conferir no sistema e ajustar? 🙏`;
}

export function IssueRequestCorrectionModal({ open, onClose, issue }: Props) {
  const [phone, setPhone] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const send = useRequestCorrection();

  // Reset fields when modal opens or issue changes.
  useEffect(() => {
    if (open && issue) {
      setPhone(issue?.professionals?.phone ?? "");
      setMessage(buildDefaultMessage(issue));
    }
  }, [open, issue]);

  if (!issue) return null;

  const handleSend = async () => {
    try {
      await send.mutateAsync({ issueId: issue.id, phone, message });
      onClose();
    } catch (err) {
      // Mutation error já invalida o estado; mantém modal aberto pro user tentar de novo.
      console.error("Falha ao enviar correção:", err);
      window.alert(
        `Erro ao enviar mensagem: ${
          err instanceof Error ? err.message : "desconhecido"
        }`
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Solicitar correção</DialogTitle>
        </DialogHeader>

        <label className="block text-sm font-medium mt-2">
          Para (telefone com DDI)
        </label>
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="5511..."
        />

        <label className="block text-sm font-medium mt-3">Mensagem</label>
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={10}
        />

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={handleSend}
            disabled={!phone || !message || send.isPending}
          >
            {send.isPending ? "Enviando..." : "Enviar WhatsApp"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
