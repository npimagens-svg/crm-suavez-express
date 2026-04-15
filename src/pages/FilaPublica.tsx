import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Users, Clock, Bell } from "lucide-react";
import { useQueue } from "@/hooks/useQueue";
import { useQueueSettings } from "@/hooks/useQueueSettings";
import { useQueueLeads } from "@/hooks/useQueueLeads";
import { useQueueRealtime } from "@/hooks/useQueueRealtime";
import { useToast } from "@/hooks/use-toast";

export default function FilaPublica() {
  const navigate = useNavigate();
  const { stats } = useQueue();
  const { settings } = useQueueSettings();
  const { addLead } = useQueueLeads();
  const { toast } = useToast();
  useQueueRealtime();

  const [leadModalOpen, setLeadModalOpen] = useState(false);
  const [leadName, setLeadName] = useState("");
  const [leadPhone, setLeadPhone] = useState("");
  const [leadMaxQueue, setLeadMaxQueue] = useState("3");

  const inflationFactor = settings?.inflation_factor || 1.7;
  const displayCount = stats.totalInQueue === 0 ? 0 : Math.ceil(stats.totalInQueue * inflationFactor);
  const displayMinutes = stats.totalInQueue === 0 ? 0 : Math.ceil(stats.estimatedMinutes * inflationFactor);

  const handleLeadSubmit = async () => {
    if (!leadName.trim() || !leadPhone.trim()) {
      toast({ title: "Preencha nome e WhatsApp", variant: "destructive" });
      return;
    }
    try {
      await addLead({ name: leadName.trim(), phone: leadPhone.trim(), max_queue_size: parseInt(leadMaxQueue) });
      toast({ title: "Pronto! Vamos te avisar quando a fila diminuir." });
      setLeadModalOpen(false);
      setLeadName("");
      setLeadPhone("");
    } catch {
      toast({ title: "Erro ao cadastrar. Tente novamente.", variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-900 to-zinc-800 flex flex-col items-center justify-center p-4">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-white">NP Hair Express</h1>
        <p className="text-zinc-400 mt-1">Salao sem agendamento</p>
      </div>

      <Card className="w-full max-w-sm mb-6">
        <CardContent className="pt-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Users className="h-5 w-5 text-primary" />
            <span className="text-3xl font-bold">{displayCount}</span>
            <span className="text-muted-foreground">
              {displayCount === 1 ? "pessoa na fila" : "pessoas na fila"}
            </span>
          </div>
          {displayCount > 0 && (
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>Tempo estimado: ~{displayMinutes} min</span>
            </div>
          )}
          {displayCount === 0 && (
            <p className="text-green-500 font-medium">Fila vazia! Atendimento imediato.</p>
          )}
        </CardContent>
      </Card>

      <div className="w-full max-w-sm space-y-3">
        <Button className="w-full h-14 text-lg" onClick={() => navigate("/fila/comprar")}>
          Quero ser atendida
        </Button>
        <Button variant="outline" className="w-full" onClick={() => setLeadModalOpen(true)}>
          <Bell className="h-4 w-4 mr-2" />
          Me avisa quando a fila diminuir
        </Button>
      </div>

      <Dialog open={leadModalOpen} onOpenChange={setLeadModalOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Receber aviso</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome</Label>
              <Input placeholder="Seu nome" value={leadName} onChange={(e) => setLeadName(e.target.value)} />
            </div>
            <div>
              <Label>WhatsApp</Label>
              <Input placeholder="(11) 99999-9999" value={leadPhone} onChange={(e) => setLeadPhone(e.target.value)} />
            </div>
            <div>
              <Label>Me avisa quando tiver menos de</Label>
              <Select value={leadMaxQueue} onValueChange={setLeadMaxQueue}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">2 pessoas</SelectItem>
                  <SelectItem value="3">3 pessoas</SelectItem>
                  <SelectItem value="5">5 pessoas</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLeadModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleLeadSubmit}>Quero ser avisada</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
