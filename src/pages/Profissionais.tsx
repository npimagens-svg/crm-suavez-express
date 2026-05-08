import { useState, useEffect } from "react";
import { AppLayoutNew } from "@/components/layout/AppLayoutNew";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Plus, Search, Loader2, Save, Trash2, UserCog, KeyRound, Scissors,
  FileText, Clock, CreditCard, Phone, MapPin, X,
} from "lucide-react";
import { useProfessionals, Professional, ProfessionalInput } from "@/hooks/useProfessionals";
import { useProfessionalWorkSchedules, WorkScheduleInput } from "@/hooks/useProfessionalWorkSchedules";
import { useProfessionalBankDetails, BankDetailsInput } from "@/hooks/useProfessionalBankDetails";
import { useProfessionalCommissionRules, CommissionRulesInput } from "@/hooks/useProfessionalCommissionRules";
import { useAccessLevels } from "@/hooks/useAccessLevels";
import { ProfessionalCommissionsTab } from "@/components/professionals/ProfessionalCommissionsTab";
import { AvatarUpload } from "@/components/shared/AvatarUpload";
import { useCepLookup } from "@/hooks/useCepLookup";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { ProfessionalModal } from "@/components/modals/ProfessionalModal";
import { TransferAppointmentsModal } from "@/components/modals/TransferAppointmentsModal";

const SPECIALTIES = [
  { value: "cabeleireiro", label: "Cabeleireiro(a)" },
  { value: "manicure", label: "Manicure" },
  { value: "esteticista", label: "Esteticista" },
  { value: "maquiador", label: "Maquiador(a)" },
  { value: "barbeiro", label: "Barbeiro" },
  { value: "depilador", label: "Depilador(a)" },
  { value: "massagista", label: "Massagista" },
  { value: "recepcionista", label: "Recepcionista" },
  { value: "gerente", label: "Gerente" },
  { value: "outro", label: "Outro" },
];

const CONTRACT_TYPES = [
  { value: "parceiro", label: "Profissional Parceiro" },
  { value: "clt", label: "CLT" },
  { value: "autonomo", label: "Autônomo" },
  { value: "mei", label: "MEI" },
];

const PAYMENT_FREQUENCIES = [
  { value: "semanal", label: "Semanal" },
  { value: "quinzenal", label: "Quinzenal" },
  { value: "mensal", label: "Mensal" },
];

const BANKS = [
  "Banco do Brasil", "Bradesco", "Caixa Econômica", "Itaú", "Santander",
  "Nubank", "Inter", "C6 Bank", "PagBank", "Sicredi", "Sicoob", "Outro",
];

const STATES = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"
];

function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

// ===== SIDEBAR =====
function ProfessionalSidebar({
  professionals,
  selectedId,
  onSelect,
  onAdd,
  search,
  onSearchChange,
  showInactive,
  onToggleInactive,
  inactiveCount,
  masterEmail,
}: {
  professionals: Professional[];
  selectedId: string | null;
  onSelect: (p: Professional) => void;
  onAdd: () => void;
  search: string;
  onSearchChange: (s: string) => void;
  showInactive: boolean;
  onToggleInactive: () => void;
  inactiveCount: number;
  masterEmail: string | null;
}) {
  return (
    <div className="w-64 shrink-0 border-r bg-muted/30 flex flex-col h-full">
      <div className="p-3 space-y-2">
        <Button onClick={onAdd} className="w-full gap-2" size="sm">
          <Plus className="h-4 w-4" /> Adicionar Profissional
        </Button>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Pesquisar profissional"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
          {search && (
            <button onClick={() => onSearchChange("")} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          )}
        </div>
        <div className="text-xs text-muted-foreground text-right">Total: {professionals.length}</div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {professionals.map((p) => (
          <button
            key={p.id}
            onClick={() => onSelect(p)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
              selectedId === p.id ? "bg-primary/10 border-l-4 border-primary font-medium" : "border-l-4 border-transparent"
            }`}
          >
            <Avatar className="h-8 w-8 shrink-0">
              {p.avatar_url && <AvatarImage src={p.avatar_url} />}
              <AvatarFallback className="text-xs bg-primary/10 text-primary">
                {getInitials(p.name)}
              </AvatarFallback>
            </Avatar>
            <span className="truncate uppercase text-xs">{p.nickname || p.name}</span>
            {p.user_id && masterEmail && p.email === masterEmail ? (
              <Badge variant="outline" className="ml-auto text-[10px] px-1 py-0 shrink-0 border-primary text-primary">MASTER</Badge>
            ) : p.user_id ? (
              <Badge variant="outline" className="ml-auto text-[10px] px-1 py-0 shrink-0">ACESSO</Badge>
            ) : null}
          </button>
        ))}
      </div>
      {inactiveCount > 0 && (
        <button
          onClick={onToggleInactive}
          className="p-3 text-xs text-primary hover:underline text-center border-t"
        >
          {showInactive ? "Ver ativos" : `Profissionais excluídos (${inactiveCount})`}
        </button>
      )}
    </div>
  );
}

// ===== MAIN FORM =====
function ProfessionalForm({ professional }: { professional: Professional }) {
  const { canDelete, isMaster, salonId } = useAuth();
  const { toast } = useToast();
  const { updateProfessional, isUpdating, deactivateProfessional, reactivateProfessional } = useProfessionals();
  const { schedules, upsertSchedule, deleteSchedule, isSaving: isSavingSchedule } = useProfessionalWorkSchedules(professional.id);
  const { bankDetails, saveBankDetails, deleteBankDetails, isSaving: isSavingBank } = useProfessionalBankDetails(professional.id);
  const { rules, saveRules, isSaving: isSavingRules } = useProfessionalCommissionRules(professional.id);
  const { accessLevels } = useAccessLevels();
  const { lookupCep, isLoading: isLookingUpCep } = useCepLookup();
  const [selectedAccessLevelId, setSelectedAccessLevelId] = useState<string | null>(null);
  const [newAccessPassword, setNewAccessPassword] = useState("");
  const [newAccessEmail, setNewAccessEmail] = useState("");
  const [isCreatingAccess, setIsCreatingAccess] = useState(false);

  // Professional data form
  const [form, setForm] = useState({
    name: "", nickname: "", cpf: "", rg: "", role: "", email: "", phone: "",
    specialty: "", commission_percent: 0, can_be_assistant: false, has_schedule: true,
    avatar_url: null as string | null, birth_date: "", description: "",
    agenda_color: "#000000", agenda_order: 0,
    mobile: "", site: "", facebook: "", instagram: "", twitter: "",
    cep: "", address: "", neighborhood: "", city: "", state: "",
  });

  // Work schedule form
  const [scheduleForm, setScheduleForm] = useState({
    start_time: "09:00", end_time: "19:00",
    monday: false, tuesday: true, wednesday: true, thursday: true,
    friday: true, saturday: true, sunday: false,
  });

  // Bank details form
  const [bankForm, setBankForm] = useState({
    person_type: "fisica", account_holder: "", holder_cpf: "",
    bank_name: "", account_type: "corrente", agency: "", account_number: "", account_digit: "",
    transfer_type: "ted", pix_key: "",
  });

  // Commission rules form
  const [rulesForm, setRulesForm] = useState({
    contract_type: "parceiro", contract_start: "", contract_end: "",
    payment_frequency: "mensal", card_payment_date: "sale_date",
    deduct_anticipation: true, deduct_card_fee: true,
    deduct_admin_fee: true, deduct_service_cost: true, deduct_product_cost: true,
  });

  // Load professional data
  useEffect(() => {
    const p = professional as any;
    setForm({
      name: p.name || "", nickname: p.nickname || "", cpf: p.cpf || "", rg: p.rg || "",
      role: p.role || "", email: p.email || "", phone: p.phone || "",
      specialty: p.specialty || "", commission_percent: Number(p.commission_percent) || 0,
      can_be_assistant: p.can_be_assistant || false, has_schedule: p.has_schedule ?? true,
      avatar_url: p.avatar_url || null, birth_date: p.birth_date || "",
      description: p.description || "", agenda_color: p.agenda_color || "#000000",
      agenda_order: p.agenda_order || 0,
      mobile: p.mobile || "", site: p.site || "", facebook: p.facebook || "",
      instagram: p.instagram || "", twitter: p.twitter || "",
      cep: p.cep || "", address: p.address || "", neighborhood: p.neighborhood || "",
      city: p.city || "", state: p.state || "",
    });
  }, [professional]);

  // Load schedule
  useEffect(() => {
    if (schedules.length > 0) {
      const s = schedules[0];
      setScheduleForm({
        start_time: s.start_time || "09:00", end_time: s.end_time || "19:00",
        monday: s.monday, tuesday: s.tuesday, wednesday: s.wednesday,
        thursday: s.thursday, friday: s.friday, saturday: s.saturday, sunday: s.sunday,
      });
    }
  }, [schedules]);

  // Load bank details
  useEffect(() => {
    if (bankDetails) {
      setBankForm({
        person_type: bankDetails.person_type || "fisica",
        account_holder: bankDetails.account_holder || "",
        holder_cpf: bankDetails.holder_cpf || "",
        bank_name: bankDetails.bank_name || "",
        account_type: bankDetails.account_type || "corrente",
        agency: bankDetails.agency || "",
        account_number: bankDetails.account_number || "",
        account_digit: bankDetails.account_digit || "",
        transfer_type: (bankDetails as any).transfer_type || "ted",
        pix_key: (bankDetails as any).pix_key || "",
      });
    }
  }, [bankDetails]);

  // Load commission rules
  useEffect(() => {
    if (rules) {
      setRulesForm({
        contract_type: rules.contract_type || "parceiro",
        contract_start: rules.contract_start || "",
        contract_end: rules.contract_end || "",
        payment_frequency: rules.payment_frequency || "mensal",
        card_payment_date: rules.card_payment_date || "sale_date",
        deduct_anticipation: rules.deduct_anticipation,
        deduct_card_fee: rules.deduct_card_fee,
        deduct_admin_fee: rules.deduct_admin_fee,
        deduct_service_cost: rules.deduct_service_cost,
        deduct_product_cost: rules.deduct_product_cost,
      });
    }
  }, [rules]);

  // Load access level for this professional
  useEffect(() => {
    if (professional.user_id && salonId) {
      supabase
        .from("user_roles")
        .select("access_level_id")
        .eq("user_id", professional.user_id)
        .eq("salon_id", salonId)
        .maybeSingle()
        .then(({ data }) => {
          setSelectedAccessLevelId(data?.access_level_id || null);
        });
    }
  }, [professional.user_id, salonId]);

  const handleAccessLevelChange = async (accessLevelId: string) => {
    if (!professional.user_id || !salonId) return;
    setSelectedAccessLevelId(accessLevelId);
    const { error } = await supabase.functions.invoke("update-user-role", {
      body: {
        userId: professional.user_id,
        salonId,
        newRole: "professional",
        accessLevelId,
      },
    });
    if (error) {
      toast({ title: "Erro ao atualizar nível de acesso", variant: "destructive" });
    } else {
      toast({ title: "Nível de acesso atualizado!" });
    }
  };

  const handleCreateAccess = async () => {
    const email = newAccessEmail || form.email;
    if (!email || !newAccessPassword || !salonId) {
      toast({ title: "Preencha o e-mail e a senha", variant: "destructive" });
      return;
    }
    if (newAccessPassword.length < 6) {
      toast({ title: "A senha deve ter pelo menos 6 caracteres", variant: "destructive" });
      return;
    }
    setIsCreatingAccess(true);
    try {
      const { error } = await supabase.functions.invoke("create-professional-access", {
        body: {
          email,
          password: newAccessPassword,
          fullName: professional.name,
          salonId,
          professionalId: professional.id,
          accessLevel: "professional",
          accessLevelId: selectedAccessLevelId || undefined,
        },
      });
      if (error) throw error;
      toast({ title: "Acesso criado com sucesso!", description: "O profissional pode fazer login com o email e senha definidos." });
      setNewAccessPassword("");
      setNewAccessEmail("");
    } catch (error: any) {
      toast({ title: "Erro ao criar acesso", description: error.message, variant: "destructive" });
    } finally {
      setIsCreatingAccess(false);
    }
  };

  const handleDeleteAccess = async () => {
    if (!salonId) {
      toast({ title: "Erro: salao nao identificado", variant: "destructive" });
      return;
    }
    if (!professional.user_id) {
      toast({ title: "Este profissional nao tem acesso criado ainda", variant: "destructive" });
      return;
    }
    if (!confirm("Tem certeza que deseja excluir o acesso deste profissional ao sistema?")) return;
    try {
      const { data, error } = await supabase.functions.invoke("delete-user-access", {
        body: { userId: professional.user_id, salonId },
      });
      if (error) {
        // Tenta extrair mensagem detalhada
        const msg = (error as any)?.context?.body || error.message || "Erro desconhecido";
        toast({ title: "Erro ao excluir acesso", description: String(msg).slice(0, 200), variant: "destructive" });
        return;
      }
      if ((data as any)?.error) {
        toast({ title: "Erro ao excluir acesso", description: (data as any).error, variant: "destructive" });
        return;
      }
      toast({ title: "Acesso excluído com sucesso!" });
      // Recarregar lista de profissionais
      window.location.reload();
    } catch (e: any) {
      toast({ title: "Erro inesperado", description: e?.message, variant: "destructive" });
    }
  };

  // Envia email de redefinicao de senha pro profissional
  const handleSendResetPassword = async () => {
    const email = newAccessEmail || form.email;
    if (!email) {
      toast({ title: "Profissional nao tem email cadastrado", variant: "destructive" });
      return;
    }
    if (!confirm(`Enviar link de redefinicao de senha para ${email}?`)) return;
    const redirectTo = `${window.location.origin}/auth`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) {
      toast({ title: "Erro ao enviar link", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Link enviado!", description: `Verifique a caixa de entrada de ${email}` });
    }
  };

  const handleSaveProfile = () => {
    if (!form.name.trim()) {
      toast({ title: "Nome é obrigatório", variant: "destructive" });
      return;
    }
    updateProfessional({ id: professional.id, ...form, is_active: professional.is_active } as any);
  };

  const handleSaveSchedule = () => {
    const existingId = schedules.length > 0 ? schedules[0].id : undefined;
    upsertSchedule({
      ...(existingId ? { id: existingId } : {}),
      professional_id: professional.id,
      ...scheduleForm,
    } as any);
  };

  const handleSaveBankDetails = () => {
    saveBankDetails({ professional_id: professional.id, ...bankForm });
  };

  const handleSaveRules = () => {
    saveRules({
      professional_id: professional.id,
      ...rulesForm,
      contract_start: rulesForm.contract_start || null,
      contract_end: rulesForm.contract_end || null,
    });
  };

  const handleCepLookup = async () => {
    const result = await lookupCep(form.cep);
    if (result) {
      setForm((prev) => ({
        ...prev,
        address: result.address,
        neighborhood: result.neighborhood,
        city: result.city,
        state: result.state,
      }));
    }
  };

  const DAYS = [
    { key: "monday" as const, label: "Seg" },
    { key: "tuesday" as const, label: "Ter" },
    { key: "wednesday" as const, label: "Qua" },
    { key: "thursday" as const, label: "Qui" },
    { key: "friday" as const, label: "Sex" },
    { key: "saturday" as const, label: "Sáb" },
    { key: "sunday" as const, label: "Dom" },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-2">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold tracking-tight">Profissionais</h1>
        <div className="flex gap-2">
          <Button onClick={handleSaveProfile} disabled={isUpdating} className="gap-2">
            <Save className="h-4 w-4" />
            {isUpdating ? "Salvando..." : "Salvar Alterações"}
          </Button>
          {canDelete && professional.is_active && (
            <Button variant="destructive" size="sm" onClick={() => {
              // Will be handled by parent via deactivation
            }}>
              Excluir
            </Button>
          )}
        </div>
      </div>

      {/* ===== DADOS PESSOAIS (always visible) ===== */}
      <div className="grid grid-cols-[auto_1fr_auto] gap-6 items-start">
        {/* Avatar */}
        <div className="space-y-1">
          <AvatarUpload
            currentAvatarUrl={form.avatar_url}
            name={form.name}
            onAvatarChange={(url) => setForm({ ...form, avatar_url: url })}
            folder="professionals"
            size="lg"
          />
          <p className="text-xs text-muted-foreground text-center">Tamanho máximo: 4 Mb</p>
        </div>

        {/* Main fields */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Nome conforme documento: <span className="text-muted-foreground">(Obrigatório)</span></Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Qual o CPF?</Label>
              <Input value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value })} placeholder="000.000.000-00" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Nome Social:</Label>
              <Input value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Qual o RG?</Label>
              <Input value={form.rg} onChange={(e) => setForm({ ...form, rg: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Cargo: <span className="text-muted-foreground">(Obrigatório)</span></Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {SPECIALTIES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Qual a data de nascimento?</Label>
              <Input type="date" value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Possui alguma especialidade?</Label>
              <Input value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Qual <strong>cor</strong> deverá aparecer na agenda?</Label>
              <div className="flex items-center gap-2">
                <Input value={form.agenda_color} onChange={(e) => setForm({ ...form, agenda_color: e.target.value })} className="flex-1" />
                <input type="color" value={form.agenda_color} onChange={(e) => setForm({ ...form, agenda_color: e.target.value })} className="h-9 w-9 rounded border cursor-pointer" />
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Escreva uma descrição sobre este profissional:</Label>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
          </div>
        </div>

        {/* Right side checkboxes */}
        <div className="space-y-3 border rounded-lg p-4 w-64">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="has_schedule"
              checked={form.has_schedule}
              onCheckedChange={(c) => setForm({ ...form, has_schedule: c as boolean })}
            />
            <Label htmlFor="has_schedule" className="text-sm cursor-pointer font-medium">
              Este profissional possui agenda
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="can_be_assistant"
              checked={form.can_be_assistant}
              onCheckedChange={(c) => setForm({ ...form, can_be_assistant: c as boolean })}
            />
            <Label htmlFor="can_be_assistant" className="text-sm cursor-pointer font-medium">
              Pode ser assistente
            </Label>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Qual <strong>ordem</strong> na Agenda?</Label>
            <Input type="number" min={0} value={form.agenda_order} onChange={(e) => setForm({ ...form, agenda_order: Number(e.target.value) })} className="w-20" />
          </div>
          <Button
            variant="default"
            size="sm"
            className="w-full mt-2"
            onClick={() => {
              const el = document.getElementById("accordion-commissions");
              el?.click();
            }}
          >
            Ver Comissão Profissional
          </Button>
        </div>
      </div>

      {/* ===== ACCORDION SECTIONS ===== */}
      <Accordion type="multiple" className="space-y-2 mt-6">
        {/* ACESSO */}
        <AccordionItem value="acesso" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              <span>Acesso</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pb-4">
            {professional.create_access || professional.user_id ? (
              <div className="space-y-4 max-w-2xl">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">E-mail de acesso:</Label>
                    <div className="flex items-center gap-2">
                      <Input value={form.email} readOnly className="bg-muted" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Nível de acesso:</Label>
                    <Select
                      value={selectedAccessLevelId || ""}
                      onValueChange={handleAccessLevelChange}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o nível de acesso" />
                      </SelectTrigger>
                      <SelectContent>
                        {accessLevels.map((level) => (
                          <SelectItem key={level.id} value={level.id}>
                            {level.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {isMaster && (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" className="gap-1" onClick={handleSendResetPassword}>
                      <KeyRound className="h-3.5 w-3.5" /> Trocar Senha
                    </Button>
                    <Button variant="destructive" size="sm" className="gap-1" onClick={handleDeleteAccess}>
                      <Trash2 className="h-3.5 w-3.5" /> Excluir Acesso
                    </Button>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  Não encontrou o acesso ideal? Configure os níveis em{" "}
                  <a href="/configuracoes?tab=usuarios" className="text-primary underline">Configurações → Usuários e Acessos</a>.
                </p>

                <div className="flex items-center gap-2 p-2.5 bg-accent/50 border border-border rounded-lg w-fit">
                  <div className="h-2 w-2 rounded-full bg-green-500" />
                  <span className="text-sm">Este profissional possui acesso ao sistema</span>
                </div>
              </div>
            ) : (
              <div className="space-y-4 max-w-2xl">
                <p className="text-sm text-muted-foreground">
                  Este profissional ainda não possui acesso ao sistema. Preencha os dados abaixo para criar o acesso.
                </p>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">E-mail para acesso:</Label>
                    <Input
                      value={newAccessEmail || form.email}
                      onChange={(e) => setNewAccessEmail(e.target.value)}
                      placeholder="email@exemplo.com"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Senha de acesso:</Label>
                    <Input
                      type="password"
                      value={newAccessPassword}
                      onChange={(e) => setNewAccessPassword(e.target.value)}
                      placeholder="Mínimo 6 caracteres"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Nível de acesso:</Label>
                    <Select
                      value={selectedAccessLevelId || ""}
                      onValueChange={(v) => setSelectedAccessLevelId(v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {accessLevels.map((level) => (
                          <SelectItem key={level.id} value={level.id}>
                            {level.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Não encontrou o acesso ideal? Configure em{" "}
                  <a href="/configuracoes/acessos" className="text-primary underline">Configurações → Grupos de Acessos</a>.
                </p>
                <Button
                  onClick={handleCreateAccess}
                  disabled={isCreatingAccess}
                  size="sm"
                  className="gap-2"
                >
                  {isCreatingAccess ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                  Criar Acesso ao Sistema
                </Button>
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* SERVIÇO E COMISSÃO */}
        <AccordionItem value="commissions" className="border rounded-lg px-4">
          <AccordionTrigger id="accordion-commissions" className="hover:no-underline">
            <div className="flex items-center gap-2">
              <Scissors className="h-4 w-4 text-muted-foreground" />
              <span>Serviço e Comissão</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            <ProfessionalCommissionsTab
              professionalId={professional.id}
              defaultCommission={professional.commission_percent || 0}
              packageCommission={professional.package_commission_percent || 0}
              onPackageCommissionChange={(value) => {
                updateProfessional({ id: professional.id, package_commission_percent: value } as any);
              }}
            />
          </AccordionContent>
        </AccordionItem>

        {/* REGRAS DE CONTRATO E COMISSÃO */}
        <AccordionItem value="contract-rules" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span>Regras de Contrato e Comissão</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-6 pb-4">
            <p className="text-sm text-muted-foreground">
              Preencha as informações de contrato e comissão dos seus funcionários.
            </p>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Tipo de contratação:</Label>
                <Select value={rulesForm.contract_type} onValueChange={(v) => setRulesForm({ ...rulesForm, contract_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CONTRACT_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Data de início do contrato:</Label>
                <Input type="date" value={rulesForm.contract_start} onChange={(e) => setRulesForm({ ...rulesForm, contract_start: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Data de encerramento do contrato:</Label>
                <Input type="date" value={rulesForm.contract_end} onChange={(e) => setRulesForm({ ...rulesForm, contract_end: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Repasse de pagamento:</Label>
                <Select value={rulesForm.payment_frequency} onValueChange={(v) => setRulesForm({ ...rulesForm, payment_frequency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_FREQUENCIES.map((f) => (
                      <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
              <p className="text-sm text-center text-muted-foreground">
                Gostaria de configurar <strong>condições de comissão</strong> especiais para este profissional?
              </p>

              {/* Card payment date */}
              <div className="flex items-center justify-between p-3 border rounded">
                <span className="text-sm">Se o cliente pagou o serviço com <strong>cartão</strong>, seu profissional receberá na:</span>
                <RadioGroup
                  value={rulesForm.card_payment_date}
                  onValueChange={(v) => setRulesForm({ ...rulesForm, card_payment_date: v })}
                  className="flex gap-4"
                >
                  <div className="flex items-center space-x-1.5">
                    <RadioGroupItem value="sale_date" id="sale_date" />
                    <Label htmlFor="sale_date" className="text-sm cursor-pointer">Data da venda</Label>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <RadioGroupItem value="settlement_date" id="settlement_date" />
                    <Label htmlFor="settlement_date" className="text-sm cursor-pointer">Data do recebimento</Label>
                  </div>
                </RadioGroup>
              </div>

              {/* Fee toggles */}
              {[
                { key: "deduct_anticipation" as const, label: "Taxa de antecipação" },
                { key: "deduct_card_fee" as const, label: "Taxa de cartão" },
                { key: "deduct_admin_fee" as const, label: "Taxa de administração do estabelecimento" },
                { key: "deduct_service_cost" as const, label: "Taxa de custo dos serviços" },
                { key: "deduct_product_cost" as const, label: "Taxa de produto" },
              ].map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between p-3 border rounded">
                  <span className="text-sm font-medium">{label}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant={rulesForm[key] ? "default" : "secondary"} className="text-xs">
                      {rulesForm[key] ? "Ativo" : "Inativo"}
                    </Badge>
                    <RadioGroup
                      value={rulesForm[key] ? "descontar" : "nao_descontar"}
                      onValueChange={(v) => setRulesForm({ ...rulesForm, [key]: v === "descontar" })}
                      className="flex gap-3"
                    >
                      <div className="flex items-center space-x-1.5">
                        <RadioGroupItem value="nao_descontar" id={`${key}_no`} />
                        <Label htmlFor={`${key}_no`} className="text-sm cursor-pointer">Não descontar</Label>
                      </div>
                      <div className="flex items-center space-x-1.5">
                        <RadioGroupItem value="descontar" id={`${key}_yes`} />
                        <Label htmlFor={`${key}_yes`} className="text-sm cursor-pointer">Descontar</Label>
                      </div>
                    </RadioGroup>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSaveRules} disabled={isSavingRules} className="gap-2">
                <Save className="h-4 w-4" />
                {isSavingRules ? "Salvando..." : "Salvar Regras"}
              </Button>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* HORÁRIO DE TRABALHO */}
        <AccordionItem value="work-schedule" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span>Horário de Trabalho</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pb-4">
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Horário de Entrada</TableHead>
                    <TableHead>Horário de Saída</TableHead>
                    {DAYS.map((d) => (
                      <TableHead key={d.key} className="text-center w-12">{d.label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>
                      <Input type="time" value={scheduleForm.start_time} onChange={(e) => setScheduleForm({ ...scheduleForm, start_time: e.target.value })} className="w-28" />
                    </TableCell>
                    <TableCell>
                      <Input type="time" value={scheduleForm.end_time} onChange={(e) => setScheduleForm({ ...scheduleForm, end_time: e.target.value })} className="w-28" />
                    </TableCell>
                    {DAYS.map((d) => (
                      <TableCell key={d.key} className="text-center">
                        <Checkbox
                          checked={scheduleForm[d.key]}
                          onCheckedChange={(c) => setScheduleForm({ ...scheduleForm, [d.key]: c as boolean })}
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-end">
              <Button onClick={handleSaveSchedule} disabled={isSavingSchedule} className="gap-2">
                <Save className="h-4 w-4" />
                {isSavingSchedule ? "Salvando..." : "Salvar Horário"}
              </Button>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* RECEBIMENTO DE COMISSÃO */}
        <AccordionItem value="bank-details" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              <span>Recebimento de Comissão (Dados Bancários)</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pb-4">
            <p className="text-sm text-muted-foreground">
              Preencha os campos com as informações bancárias do profissional para o pagamento das comissões.
            </p>

            {/* Person type */}
            <div className="space-y-1.5">
              <Label className="text-xs">Tipo de pessoa:</Label>
              <RadioGroup
                value={bankForm.person_type}
                onValueChange={(v) => setBankForm({ ...bankForm, person_type: v })}
                className="flex gap-4"
              >
                <div className="flex items-center space-x-1.5">
                  <RadioGroupItem value="fisica" id="pf" />
                  <Label htmlFor="pf" className="text-sm cursor-pointer">Pessoa Física</Label>
                </div>
                <div className="flex items-center space-x-1.5">
                  <RadioGroupItem value="juridica" id="pj" />
                  <Label htmlFor="pj" className="text-sm cursor-pointer">Pessoa Jurídica</Label>
                </div>
              </RadioGroup>
            </div>

            {/* Transfer type */}
            <div className="space-y-1.5">
              <Label className="text-xs">Forma de transferência:</Label>
              <RadioGroup
                value={bankForm.transfer_type}
                onValueChange={(v) => setBankForm({ ...bankForm, transfer_type: v })}
                className="flex gap-4"
              >
                <div className="flex items-center space-x-1.5">
                  <RadioGroupItem value="ted" id="transfer-ted" />
                  <Label htmlFor="transfer-ted" className="text-sm cursor-pointer">TED</Label>
                </div>
                <div className="flex items-center space-x-1.5">
                  <RadioGroupItem value="pix" id="transfer-pix" />
                  <Label htmlFor="transfer-pix" className="text-sm cursor-pointer">PIX</Label>
                </div>
              </RadioGroup>
            </div>

            {bankForm.transfer_type === "ted" ? (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Nome do titular: <span className="text-muted-foreground">(Obrigatório)</span></Label>
                    <Input value={bankForm.account_holder} onChange={(e) => setBankForm({ ...bankForm, account_holder: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">{bankForm.person_type === "fisica" ? "CPF" : "CNPJ"} do titular: <span className="text-muted-foreground">(Obrigatório)</span></Label>
                    <Input value={bankForm.holder_cpf} onChange={(e) => setBankForm({ ...bankForm, holder_cpf: e.target.value })} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Banco: <span className="text-muted-foreground">(Obrigatório)</span></Label>
                    <Select value={bankForm.bank_name} onValueChange={(v) => setBankForm({ ...bankForm, bank_name: v })}>
                      <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                      <SelectContent>
                        {BANKS.map((b) => (
                          <SelectItem key={b} value={b}>{b}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Modelo de conta: <span className="text-muted-foreground">(Obrigatório)</span></Label>
                    <RadioGroup
                      value={bankForm.account_type}
                      onValueChange={(v) => setBankForm({ ...bankForm, account_type: v })}
                      className="flex gap-4 mt-1"
                    >
                      <div className="flex items-center space-x-1.5">
                        <RadioGroupItem value="corrente" id="corrente" />
                        <Label htmlFor="corrente" className="text-sm cursor-pointer">Corrente</Label>
                      </div>
                      <div className="flex items-center space-x-1.5">
                        <RadioGroupItem value="poupanca" id="poupanca" />
                        <Label htmlFor="poupanca" className="text-sm cursor-pointer">Poupança</Label>
                      </div>
                    </RadioGroup>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Agência: <span className="text-muted-foreground">(Obrigatório)</span></Label>
                    <Input value={bankForm.agency} onChange={(e) => setBankForm({ ...bankForm, agency: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Conta:</Label>
                    <Input value={bankForm.account_number} onChange={(e) => setBankForm({ ...bankForm, account_number: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Dígito:</Label>
                    <Input value={bankForm.account_digit} onChange={(e) => setBankForm({ ...bankForm, account_digit: e.target.value })} className="w-20" />
                  </div>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Chave PIX: <span className="text-muted-foreground">(Obrigatório)</span></Label>
                  <Input
                    placeholder="CPF, e-mail, telefone ou chave aleatória"
                    value={bankForm.pix_key}
                    onChange={(e) => setBankForm({ ...bankForm, pix_key: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Banco: <span className="text-muted-foreground">(Obrigatório)</span></Label>
                  <Select value={bankForm.bank_name} onValueChange={(v) => setBankForm({ ...bankForm, bank_name: v })}>
                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>
                      {BANKS.map((b) => (
                        <SelectItem key={b} value={b}>{b}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <button onClick={() => deleteBankDetails()} className="text-sm text-destructive hover:underline">
                Remover dados bancários
              </button>
              <Button onClick={handleSaveBankDetails} disabled={isSavingBank} className="gap-2">
                <Save className="h-4 w-4" />
                {isSavingBank ? "Salvando..." : "Salvar Dados"}
              </Button>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* CONTATO PROFISSIONAL */}
        <AccordionItem value="contact" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span>Contato profissional</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pb-4">
            <div className="grid grid-cols-4 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Qual é o <strong>telefone</strong>?</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Qual é o <strong>celular</strong>?</Label>
                <Input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Qual é o <strong>site</strong>?</Label>
                <Input value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Qual é o <strong>e-mail</strong>?</Label>
                <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Qual é o <strong>Facebook</strong>?</Label>
                <Input value={form.facebook} onChange={(e) => setForm({ ...form, facebook: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Qual é o <strong>Instagram</strong>?</Label>
                <Input value={form.instagram} onChange={(e) => setForm({ ...form, instagram: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Qual é o <strong>Twitter</strong>?</Label>
                <Input value={form.twitter} onChange={(e) => setForm({ ...form, twitter: e.target.value })} />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* ENDEREÇO */}
        <AccordionItem value="address" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span>Endereço</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pb-4">
            <div className="grid grid-cols-4 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Qual é o <strong>CEP</strong>?</Label>
                <div className="flex gap-1">
                  <Input
                    value={form.cep}
                    onChange={(e) => setForm({ ...form, cep: e.target.value })}
                    onBlur={() => { if (form.cep.replace(/\D/g, "").length === 8) handleCepLookup(); }}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Qual é o <strong>endereço</strong>?</Label>
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Qual é o <strong>bairro</strong>?</Label>
                <Input value={form.neighborhood} onChange={(e) => setForm({ ...form, neighborhood: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Qual é a <strong>cidade</strong>?</Label>
                <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Qual é o <strong>estado</strong>?</Label>
                <Select value={form.state} onValueChange={(v) => setForm({ ...form, state: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {STATES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

// ===== MAIN PAGE =====
export function Profissionais() {
  const { professionals, isLoading, createProfessional, deactivateProfessional, isCreating, isDeactivating } = useProfessionals();
  const { canDelete } = useAuth();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [masterEmail, setMasterEmail] = useState<string | null>(null);

  // Fetch master email from system_config
  useEffect(() => {
    supabase
      .from("system_config")
      .select("value")
      .eq("key", "master_user_email")
      .maybeSingle()
      .then(({ data }) => {
        if (data?.value) setMasterEmail(data.value);
      });
  }, []);

  const activeProfessionals = professionals.filter((p) => p.is_active);
  const inactiveProfessionals = professionals.filter((p) => !p.is_active);
  const displayList = showInactive ? inactiveProfessionals : activeProfessionals;
  const filtered = displayList.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.email?.toLowerCase().includes(search.toLowerCase())
  );

  // Auto-select first professional
  useEffect(() => {
    if (!selectedId && filtered.length > 0) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  const selectedProfessional = professionals.find((p) => p.id === selectedId) || null;

  const handleSubmit = (data: ProfessionalInput & { id?: string }) => {
    createProfessional(data);
  };

  return (
    <AppLayoutNew>
      <div className="flex h-[calc(100vh-4rem)] -m-6">
        <ProfessionalSidebar
          professionals={filtered}
          selectedId={selectedId}
          onSelect={(p) => setSelectedId(p.id)}
          onAdd={() => setModalOpen(true)}
          search={search}
          onSearchChange={setSearch}
          showInactive={showInactive}
          onToggleInactive={() => setShowInactive(!showInactive)}
          inactiveCount={inactiveProfessionals.length}
          masterEmail={masterEmail}
        />

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : selectedProfessional ? (
          <ProfessionalForm professional={selectedProfessional} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center space-y-2">
              <UserCog className="h-12 w-12 mx-auto opacity-50" />
              <p>Selecione um profissional ou adicione um novo.</p>
              <Button onClick={() => setModalOpen(true)} className="gap-2 mt-2">
                <Plus className="h-4 w-4" /> Adicionar Profissional
              </Button>
            </div>
          </div>
        )}
      </div>

      <ProfessionalModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        professional={null}
        onSubmit={handleSubmit}
        isLoading={isCreating}
      />

      {selectedProfessional && (
        <TransferAppointmentsModal
          open={transferModalOpen}
          onOpenChange={setTransferModalOpen}
          professional={selectedProfessional}
          professionals={professionals}
          onConfirm={(targetId) => {
            deactivateProfessional({ id: selectedProfessional.id, targetProfessionalId: targetId || undefined });
            setTransferModalOpen(false);
            setSelectedId(null);
          }}
          isLoading={isDeactivating}
        />
      )}
    </AppLayoutNew>
  );
}
