import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronUp, ChevronDown, CheckCircle, UserPlus, SkipForward, X, Clock, CreditCard, Banknote, AlertCircle } from "lucide-react";
import type { QueueEntry } from "@/types/queue";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface QueueCardProps {
  entry: QueueEntry;
  isFirst: boolean;
  isLast: boolean;
  onCheckIn: () => void;
  onAssignProfessional: () => void;
  onSkip: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onComplete?: () => void;
}

const statusConfig: Record<string, { label: string; className: string }> = {
  waiting: { label: "Aguardando", className: "bg-blue-100 text-blue-800" },
  checked_in: { label: "Presente", className: "bg-green-100 text-green-800" },
  in_service: { label: "Em atendimento", className: "bg-orange-100 text-orange-800" },
};

export function QueueCard({ entry, isFirst, isLast, onCheckIn, onAssignProfessional, onSkip, onRemove, onMoveUp, onMoveDown, onComplete }: QueueCardProps) {
  const status = statusConfig[entry.status] || statusConfig.waiting;
  const timeInQueue = formatDistanceToNow(new Date(entry.created_at), { locale: ptBR, addSuffix: false });

  return (
    <Card className="mb-2">
      <CardContent className="py-3 space-y-2">
        {/* Top row: position + info + status */}
        <div className="flex items-center gap-3">
          {/* Position controls */}
          <div className="flex flex-col items-center shrink-0">
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onMoveUp} disabled={isFirst}>
              <ChevronUp className="h-4 w-4" />
            </Button>
            <span className="text-lg font-bold">{entry.position}</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onMoveDown} disabled={isLast}>
              <ChevronDown className="h-4 w-4" />
            </Button>
          </div>

          {/* Client info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium truncate">{entry.customer_name}</span>
              <Badge variant="outline" className={status.className}>{status.label}</Badge>
              <Badge variant="outline">{entry.source === "online" ? "Online" : "Presencial"}</Badge>
              {entry.source === "online" && entry.payment_status === "confirmed" && (
                <Badge variant="outline" className="bg-emerald-100 text-emerald-800 border-emerald-300">
                  {entry.payment_method === "credit_card" ? (
                    <><CreditCard className="h-3 w-3 mr-1" />Cartão pago</>
                  ) : (
                    <><Banknote className="h-3 w-3 mr-1" />PIX pago</>
                  )}
                </Badge>
              )}
              {entry.source === "online" && entry.payment_status === "pending" && (
                <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-300">
                  <AlertCircle className="h-3 w-3 mr-1" />Pagamento pendente
                </Badge>
              )}
              {entry.source === "walk_in" && (
                <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-300">
                  Cobrar no balcão
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
              <span>{entry.service?.name}</span>
              {entry.service?.price !== undefined && (
                <span className="font-medium text-foreground">
                  R$ {entry.service.price.toFixed(2).replace(".", ",")}
                </span>
              )}
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{timeInQueue}</span>
              {entry.professional && <span className="font-medium text-foreground">{entry.professional.name}</span>}
            </div>
          </div>
        </div>

        {/* Action buttons row */}
        {entry.status !== "in_service" ? (
          <div className="flex items-center gap-2 pl-10">
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={onAssignProfessional}>
              <UserPlus className="h-4 w-4 mr-1" />
              Atender
            </Button>
            <Button size="sm" variant="outline" className="text-orange-700 border-orange-300 hover:bg-orange-50" onClick={onSkip}>
              <SkipForward className="h-4 w-4 mr-1" />
              Pular
            </Button>
            <Button size="sm" variant="outline" className="text-red-700 border-red-300 hover:bg-red-50" onClick={onRemove}>
              <X className="h-4 w-4 mr-1" />
              Remover
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 pl-10">
            {onComplete && (
              <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={onComplete}>
                <CheckCircle className="h-4 w-4 mr-1" />
                Finalizar atendimento
              </Button>
            )}
            <Button size="sm" variant="outline" className="text-red-700 border-red-300 hover:bg-red-50" onClick={onRemove}>
              <X className="h-4 w-4 mr-1" />
              Remover da fila
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
