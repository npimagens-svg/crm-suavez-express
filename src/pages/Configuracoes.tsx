// @ts-nocheck
import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { AppLayoutNew } from "@/components/layout/AppLayoutNew";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Shield, Users, Settings, MoreHorizontal, Trash2, Loader2, Building2,
  CreditCard, Plus, Pencil, Landmark, ArrowRightLeft, Lock, Cog, UserCog,
  Save, Calendar, Clock, ToggleLeft, ChevronRight, Home, DollarSign, Percent, Package, Webhook, Globe, Mail, ShieldAlert, ListOrdered
} from "lucide-react";
import { CommissionSettingsPage } from "@/components/settings/CommissionSettingsPage";
import { useAuth, AppRole } from "@/contexts/AuthContext";
import { useUserAccess, UserWithAccess } from "@/hooks/useUserAccess";
import { useCardBrands, CardBrand, CardBrandInput } from "@/hooks/useCardBrands";
import { useBankAccounts, BankAccount, BankAccountInput } from "@/hooks/useBankAccounts";
import { useAccessLevels, AccessLevelWithPermissions } from "@/hooks/useAccessLevels";
import { useProfessionals } from "@/hooks/useProfessionals";
import { DeleteConfirmModal } from "@/components/modals/DeleteConfirmModal";
import { CardBrandModal } from "@/components/modals/CardBrandModal";
import { BankAccountModal } from "@/components/modals/BankAccountModal";
import { TransferMasterModal } from "@/components/modals/TransferMasterModal";
import { AccessLevelConfigModal } from "@/components/settings/AccessLevelConfigModal";
import { CreateAccessLevelModal } from "@/components/settings/CreateAccessLevelModal";
import { AvatarUpload } from "@/components/shared/AvatarUpload";
import { SalonInfoForm } from "@/components/settings/SalonInfoForm";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { useQueryClient } from "@tanstack/react-query";
import { useSchedulingSettings, SchedulingSettings } from "@/hooks/useSchedulingSettings";
import { useCommissionSettings } from "@/hooks/useCommissionSettings";
import { WebhookSettingsSection } from "@/components/settings/WebhookSettingsSection";
import { ApiGatewaySettingsSection } from "@/components/settings/ApiGatewaySettingsSection";
import { ResendSettingsSection } from "@/components/settings/ResendSettingsSection";
import { AuditLogSection } from "@/components/settings/AuditLogSection";
import { QueueSettingsSection } from "@/components/settings/QueueSettingsSection";

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

// ===== MASTER PROFESSIONAL PROFILE COMPONENT =====
function MasterProfessionalProfile() {
  const { user, salonId } = useAuth();
  const { professionals, createProfessional, updateProfessional, isCreating, isUpdating } = useProfessionals();
  const { toast } = useToast();

  const masterProfessional = professionals.find(
    (p) => p.user_id === user?.id || p.email === user?.email
  );

  const [formData, setFormData] = useState({
    name: "",
    nickname: "",
    cpf: "",
    role: "",
    phone: "",
    specialty: "",
    commission_percent: 0,
    can_be_assistant: false,
    has_schedule: true,
    avatar_url: null as string | null,
  });

  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (masterProfessional) {
      setFormData({
        name: masterProfessional.name,
        nickname: masterProfessional.nickname || "",
        cpf: masterProfessional.cpf || "",
        role: masterProfessional.role || "",
        phone: masterProfessional.phone || "",
        specialty: masterProfessional.specialty || "",
        commission_percent: Number(masterProfessional.commission_percent) || 0,
        can_be_assistant: masterProfessional.can_be_assistant || false,
        has_schedule: masterProfessional.has_schedule ?? true,
        avatar_url: masterProfessional.avatar_url || null,
      });
    }
  }, [masterProfessional]);

  const handleSave = () => {
    if (!formData.name.trim()) {
      toast({ title: "Nome é obrigatório", variant: "destructive" });
      return;
    }

    if (masterProfessional) {
      updateProfessional({
        id: masterProfessional.id,
        ...formData,
        email: user?.email || "",
        is_active: true,
      });
    } else {
      createProfessional({
        ...formData,
        email: user?.email || "",
        is_active: true,
        create_access: false,
        user_id: user?.id || null,
      });
    }
    setIsEditing(false);
  };

  const showForm = isEditing || !masterProfessional;

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <div className="flex items-center gap-2">
          <UserCog className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Meu Perfil Profissional</CardTitle>
        </div>
        <CardDescription>
          Configure seus dados como profissional do salão.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!masterProfessional && !isEditing ? (
          <div className="text-center py-6 space-y-4">
            <UserCog className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
            <div>
              <p className="text-muted-foreground">Você ainda não está cadastrado como profissional.</p>
              <p className="text-sm text-muted-foreground">Cadastre-se para aparecer na agenda.</p>
            </div>
            <Button onClick={() => {
              setFormData(prev => ({ ...prev, name: user?.user_metadata?.full_name || user?.email?.split("@")[0] || "" }));
              setIsEditing(true);
            }} className="gap-2">
              <Plus className="h-4 w-4" />
              Cadastrar como Profissional
            </Button>
          </div>
        ) : showForm ? (
          <div className="space-y-6">
            <div className="flex justify-center">
              <AvatarUpload
                currentAvatarUrl={formData.avatar_url}
                name={formData.name}
                onAvatarChange={(url) => setFormData({ ...formData, avatar_url: url })}
                folder="professionals"
                size="lg"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nome Completo <span className="text-destructive">*</span></Label>
                <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label>Apelido</Label>
                <Input value={formData.nickname} onChange={(e) => setFormData({ ...formData, nickname: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>CPF</Label>
                <Input value={formData.cpf} onChange={(e) => setFormData({ ...formData, cpf: e.target.value })} placeholder="000.000.000-00" />
              </div>
              <div className="space-y-2">
                <Label>Especialidade <span className="text-destructive">*</span></Label>
                <Select value={formData.role} onValueChange={(value) => setFormData({ ...formData, role: value })}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {SPECIALTIES.map((spec) => (
                      <SelectItem key={spec.value} value={spec.value}>{spec.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Telefone</Label>
                <Input value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Comissão Padrão (%)</Label>
                <Input type="number" min="0" max="100" value={formData.commission_percent} onChange={(e) => setFormData({ ...formData, commission_percent: Number(e.target.value) })} />
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox id="master_has_schedule" checked={formData.has_schedule} onCheckedChange={(checked) => setFormData({ ...formData, has_schedule: checked as boolean })} />
                <Label htmlFor="master_has_schedule" className="cursor-pointer">Possuo agenda</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox id="master_can_be_assistant" checked={formData.can_be_assistant} onCheckedChange={(checked) => setFormData({ ...formData, can_be_assistant: checked as boolean })} />
                <Label htmlFor="master_can_be_assistant" className="cursor-pointer">Posso ser assistente</Label>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              {masterProfessional && <Button variant="outline" onClick={() => setIsEditing(false)}>Cancelar</Button>}
              <Button onClick={handleSave} disabled={isCreating || isUpdating} className="gap-2">
                <Save className="h-4 w-4" />
                {isCreating || isUpdating ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarFallback className="bg-primary/10 text-primary text-xl">
                  {masterProfessional.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <h3 className="text-lg font-semibold">{masterProfessional.name}</h3>
                {masterProfessional.nickname && <p className="text-sm text-muted-foreground">"{masterProfessional.nickname}"</p>}
                <div className="flex items-center gap-2 mt-1">
                  {masterProfessional.role && (
                    <Badge variant="secondary">{SPECIALTIES.find(s => s.value === masterProfessional.role)?.label || masterProfessional.role}</Badge>
                  )}
                  <Badge variant={masterProfessional.has_schedule ? "default" : "outline"}>{masterProfessional.has_schedule ? "Com agenda" : "Sem agenda"}</Badge>
                  <Badge variant="outline">{masterProfessional.commission_percent || 0}% comissão</Badge>
                </div>
              </div>
              <Button variant="outline" onClick={() => setIsEditing(true)} className="gap-2">
                <Pencil className="h-4 w-4" /><span className="hidden sm:inline">Editar</span>
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const ROLE_LABELS: Record<AppRole, { label: string; description: string; color: string }> = {
  admin: { label: "Administrador", description: "Acesso total ao sistema", color: "bg-red-500" },
  manager: { label: "Gerente", description: "Acesso completo exceto configurações do salão", color: "bg-orange-500" },
  receptionist: { label: "Recepcionista", description: "Agenda, clientes, comandas e caixa", color: "bg-blue-500" },
  financial: { label: "Financeiro", description: "Relatórios financeiros, caixa e comandas", color: "bg-green-500" },
  professional: { label: "Profissional", description: "Visualiza agenda pessoal e comandas", color: "bg-purple-500" },
};

// ===== SETTINGS HUB CARD =====
interface SettingsCardProps {
  icon: React.ElementType;
  title: string;
  description: string;
  onClick: () => void;
}

function SettingsCard({ icon: Icon, title, description, onClick }: SettingsCardProps) {
  return (
    <Card
      className="cursor-pointer hover:shadow-md hover:border-primary/30 transition-all duration-200 group"
      onClick={onClick}
    >
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <Icon className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <h3 className="font-medium text-foreground group-hover:text-primary transition-colors">{title}</h3>
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground/50 group-hover:text-primary transition-colors shrink-0 mt-0.5" />
        </div>
      </CardContent>
    </Card>
  );
}

// ===== BREADCRUMB =====
function SettingsBreadcrumb({ label }: { label: string }) {
  const navigate = useNavigate();
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
      <button onClick={() => navigate("/configuracoes")} className="hover:text-primary transition-colors">
        Configurações
      </button>
      <ChevronRight className="h-3 w-3" />
      <span className="text-foreground font-medium">{label}</span>
    </div>
  );
}

// ===== SCHEDULING SETTINGS SECTION =====
function SchedulingSettingsSection() {
  const { settings, isLoading: isLoadingSchedule, saveSettings, isSaving } = useSchedulingSettings();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    opening_time: "08:00",
    closing_time: "20:00",
    slot_interval_minutes: 30,
    default_columns: 6,
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true,
    saturday: true,
    sunday: false,
    min_advance_hours: 0,
    max_advance_days: 90,
    allow_simultaneous: true,
    auto_confirm: false,
  });

  useEffect(() => {
    if (settings && settings.id !== "") {
      setForm({
        opening_time: settings.opening_time?.slice(0, 5) || "08:00",
        closing_time: settings.closing_time?.slice(0, 5) || "20:00",
        slot_interval_minutes: settings.slot_interval_minutes,
        default_columns: settings.default_columns,
        monday: settings.monday,
        tuesday: settings.tuesday,
        wednesday: settings.wednesday,
        thursday: settings.thursday,
        friday: settings.friday,
        saturday: settings.saturday,
        sunday: settings.sunday,
        min_advance_hours: settings.min_advance_hours,
        max_advance_days: settings.max_advance_days,
        allow_simultaneous: settings.allow_simultaneous,
        auto_confirm: settings.auto_confirm,
      });
    }
  }, [settings]);

  const handleSave = () => {
    saveSettings(form);
  };

  const dayKeys = [
    { key: "monday" as const, label: "Segunda" },
    { key: "tuesday" as const, label: "Terça" },
    { key: "wednesday" as const, label: "Quarta" },
    { key: "thursday" as const, label: "Quinta" },
    { key: "friday" as const, label: "Sexta" },
    { key: "saturday" as const, label: "Sábado" },
    { key: "sunday" as const, label: "Domingo" },
  ];

  if (isLoadingSchedule) {
    return (
      <>
        <SettingsBreadcrumb label="Agendamento" />
        <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      </>
    );
  }

  return (
    <>
      <SettingsBreadcrumb label="Agendamento" />
      <h1 className="text-2xl font-bold tracking-tight">Agendamento</h1>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Horário de Funcionamento</CardTitle>
            </div>
            <CardDescription>Defina os horários de abertura e fechamento do salão.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Horário de Abertura</Label>
                <Input
                  type="time"
                  value={form.opening_time}
                  onChange={(e) => setForm({ ...form, opening_time: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Horário de Fechamento</Label>
                <Input
                  type="time"
                  value={form.closing_time}
                  onChange={(e) => setForm({ ...form, closing_time: e.target.value })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Intervalo de Horários</CardTitle>
            </div>
            <CardDescription>Defina o intervalo de tempo entre os horários na agenda.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Intervalo entre horários</Label>
                <Select
                  value={String(form.slot_interval_minutes)}
                  onValueChange={(v) => setForm({ ...form, slot_interval_minutes: Number(v) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">15 minutos</SelectItem>
                    <SelectItem value="30">30 minutos</SelectItem>
                    <SelectItem value="45">45 minutos</SelectItem>
                    <SelectItem value="60">1 hora</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Colunas padrão na agenda</Label>
                <Select
                  value={String(form.default_columns)}
                  onValueChange={(v) => setForm({ ...form, default_columns: Number(v) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3">3 colunas</SelectItem>
                    <SelectItem value="4">4 colunas</SelectItem>
                    <SelectItem value="5">5 colunas</SelectItem>
                    <SelectItem value="6">6 colunas</SelectItem>
                    <SelectItem value="8">8 colunas</SelectItem>
                    <SelectItem value="10">10 colunas</SelectItem>
                    <SelectItem value="12">12 colunas</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ToggleLeft className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Dias de Funcionamento</CardTitle>
            </div>
            <CardDescription>Selecione os dias em que o salão funciona.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {dayKeys.map(({ key, label }) => (
                <div key={key} className="flex items-center space-x-2">
                  <Checkbox
                    id={key}
                    checked={form[key]}
                    onCheckedChange={(checked) => setForm({ ...form, [key]: checked as boolean })}
                  />
                  <Label htmlFor={key} className="cursor-pointer">{label}</Label>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Regras de Agendamento</CardTitle>
            </div>
            <CardDescription>Configure restrições e preferências para os agendamentos.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Antecedência mínima para agendar</Label>
                <Select
                  value={String(form.min_advance_hours)}
                  onValueChange={(v) => setForm({ ...form, min_advance_hours: Number(v) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Sem restrição</SelectItem>
                    <SelectItem value="1">1 hora antes</SelectItem>
                    <SelectItem value="2">2 horas antes</SelectItem>
                    <SelectItem value="24">1 dia antes</SelectItem>
                    <SelectItem value="48">2 dias antes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Antecedência máxima para agendar</Label>
                <Select
                  value={String(form.max_advance_days)}
                  onValueChange={(v) => setForm({ ...form, max_advance_days: Number(v) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">7 dias</SelectItem>
                    <SelectItem value="15">15 dias</SelectItem>
                    <SelectItem value="30">30 dias</SelectItem>
                    <SelectItem value="60">60 dias</SelectItem>
                    <SelectItem value="90">90 dias</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-3 pt-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="allow_simultaneous"
                  checked={form.allow_simultaneous}
                  onCheckedChange={(checked) => setForm({ ...form, allow_simultaneous: checked as boolean })}
                />
                <Label htmlFor="allow_simultaneous" className="cursor-pointer">Permitir agendamentos simultâneos no mesmo horário</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="auto_confirm"
                  checked={form.auto_confirm}
                  onCheckedChange={(checked) => setForm({ ...form, auto_confirm: checked as boolean })}
                />
                <Label htmlFor="auto_confirm" className="cursor-pointer">Confirmar agendamentos automaticamente</Label>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button className="gap-2" onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isSaving ? "Salvando..." : "Salvar Configurações"}
          </Button>
        </div>
      </div>
    </>
  );
}

// ===== MAIN COMPONENT =====
export default function Configuracoes() {
  const { isMaster, user, userRole } = useAuth();
  const canManageAccess = isMaster || userRole === "admin";
  console.log("[Configuracoes] isMaster:", isMaster, "userRole:", userRole, "email:", user?.email, "canManageAccess:", canManageAccess);
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Determine which sub-page to show
  const subPage = (() => {
    const path = location.pathname;
    if (path === "/configuracoes") return "hub";
    if (path.startsWith("/configuracoes/estabelecimento")) return "estabelecimento";
    if (path.startsWith("/configuracoes/agendamento")) return "agendamento";
    if (path.startsWith("/configuracoes/comissoes")) return "comissoes";
    if (path.startsWith("/configuracoes/financeiro")) return "financeiro";
    if (path.startsWith("/configuracoes/acessos")) return "acessos";
    if (path.startsWith("/configuracoes/profissionais")) return "profissionais";
    if (path.startsWith("/configuracoes/sistema")) return "sistema";
    if (path.startsWith("/configuracoes/webhook")) return "webhook";
    if (path.startsWith("/configuracoes/api")) return "api";
    if (path.startsWith("/configuracoes/email")) return "email";
    if (path.startsWith("/configuracoes/auditoria")) return "auditoria";
    if (path.startsWith("/configuracoes/fila")) return "fila";
    if (path.startsWith("/configuracoes/salao")) return "hub";
    return "hub";
  })();

  // Hooks
  const { users, isLoading, updateRole, updateCanOpenCaixa, deleteAccess, isUpdating, isDeleting } = useUserAccess();
  const { cardBrands, isLoading: isLoadingBrands, createCardBrand, updateCardBrand, deleteCardBrand, isCreating: isCreatingBrand, isUpdating: isUpdatingBrand, isDeleting: isDeletingBrand } = useCardBrands();
  const { bankAccounts, isLoading: isLoadingBankAccounts, createBankAccount, updateBankAccount, deleteBankAccount } = useBankAccounts();
  const { settings: commissionSettings, save: saveCommissionSettings } = useCommissionSettings();
  const { accessLevels, isLoading: isLoadingAccessLevels, error: accessLevelsError, createAccessLevel, updateAccessLevel, updatePermission, deleteAccessLevel, isCreating: isCreatingAccessLevel, isUpdating: isUpdatingAccessLevel, isDeleting: isDeletingAccessLevel } = useAccessLevels();

  // Modal states
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserWithAccess | null>(null);
  const [cardBrandModalOpen, setCardBrandModalOpen] = useState(false);
  const [selectedCardBrand, setSelectedCardBrand] = useState<CardBrand | null>(null);
  const [deleteCardBrandModalOpen, setDeleteCardBrandModalOpen] = useState(false);
  const [cardBrandToDelete, setCardBrandToDelete] = useState<CardBrand | null>(null);
  const [bankAccountModalOpen, setBankAccountModalOpen] = useState(false);
  const [selectedBankAccount, setSelectedBankAccount] = useState<BankAccount | null>(null);
  const [deleteBankAccountModalOpen, setDeleteBankAccountModalOpen] = useState(false);
  const [bankAccountToDelete, setBankAccountToDelete] = useState<BankAccount | null>(null);
  const [transferMasterModalOpen, setTransferMasterModalOpen] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [accessLevelConfigModalOpen, setAccessLevelConfigModalOpen] = useState(false);
  const [selectedAccessLevelId, setSelectedAccessLevelId] = useState<string | null>(null);
  const selectedAccessLevel = accessLevels.find(l => l.id === selectedAccessLevelId) ?? null;
  const [createAccessLevelModalOpen, setCreateAccessLevelModalOpen] = useState(false);
  const [deleteAccessLevelModalOpen, setDeleteAccessLevelModalOpen] = useState(false);
  const [accessLevelToDelete, setAccessLevelToDelete] = useState<AccessLevelWithPermissions | null>(null);

  // Handlers
  const handleRoleChange = (userId: string, newRole: AppRole) => {
    if (!canManageAccess) { toast({ title: "Acesso negado", description: "Apenas o usuário master pode alterar permissões.", variant: "destructive" }); return; }
    const matchingAccessLevel = accessLevels.find((level) => level.system_key === newRole) ?? null;
    updateRole({ userId, newRole, accessLevelId: matchingAccessLevel?.id ?? null });
  };

  const handleToggleCanOpenCaixa = (userId: string, currentValue: boolean) => {
    if (!canManageAccess) { toast({ title: "Acesso negado", variant: "destructive" }); return; }
    updateCanOpenCaixa({ userId, canOpenCaixa: !currentValue });
  };

  const handleDeleteAccess = (userAccess: UserWithAccess) => {
    if (!canManageAccess) { toast({ title: "Acesso negado", variant: "destructive" }); return; }
    setSelectedUser(userAccess);
    setDeleteModalOpen(true);
  };

  const confirmDelete = () => {
    if (selectedUser) { deleteAccess(selectedUser.user_id); setDeleteModalOpen(false); setSelectedUser(null); }
  };

  const handleSaveCardBrand = (data: CardBrandInput) => {
    if (selectedCardBrand) { updateCardBrand({ id: selectedCardBrand.id, ...data }); } else { createCardBrand(data); }
    setCardBrandModalOpen(false); setSelectedCardBrand(null);
  };

  const handleSaveBankAccount = (data: BankAccountInput) => {
    if (selectedBankAccount) { updateBankAccount.mutate({ id: selectedBankAccount.id, ...data }); } else { createBankAccount.mutate(data); }
    setBankAccountModalOpen(false); setSelectedBankAccount(null);
  };

  const handleTransferMaster = async (newMasterUserId: string) => {
    setIsTransferring(true);
    try {
      const { error } = await supabase.functions.invoke("transfer-master-access", { body: { newMasterUserId } });
      if (error) throw error;
      toast({ title: "Acesso master transferido!", description: "Faça login novamente para aplicar as alterações." });
      queryClient.invalidateQueries({ queryKey: ["master-email"] });
      setTransferMasterModalOpen(false);
      setTimeout(async () => { await supabase.auth.signOut(); window.location.reload(); }, 2000);
    } catch (error: any) {
      toast({ title: "Erro ao transferir acesso", description: error.message, variant: "destructive" });
    } finally { setIsTransferring(false); }
  };

  const eligibleUsersForMaster = users.filter(u => u.user_id !== user?.id && u.role !== "admin");

  const getInitials = (name: string) => name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);

  return (
    <AppLayoutNew>
      <div className="space-y-6">
        {/* ===== HUB - GRID OF CARDS ===== */}
        {subPage === "hub" && (
          <>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
              <p className="text-muted-foreground">Gerencie as configurações do seu estabelecimento.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <SettingsCard
                icon={Home}
                title="Informações do Estabelecimento"
                description="Configure o nome, endereço e contato do seu estabelecimento"
                onClick={() => navigate("/configuracoes/estabelecimento")}
              />
              <SettingsCard
                icon={Calendar}
                title="Agendamento"
                description="Configure as regras de agendamento do seu estabelecimento"
                onClick={() => navigate("/configuracoes/agendamento")}
              />
              <SettingsCard
                icon={Percent}
                title="Comissões"
                description="Defina as regras de comissões do seu estabelecimento"
                onClick={() => navigate("/configuracoes/comissoes")}
              />
              <SettingsCard
                icon={UserCog}
                title="Profissionais"
                description="Cadastre e gerencie informações, comissões e regras de acesso dos seus profissionais"
                onClick={() => navigate("/profissionais")}
              />
              <SettingsCard
                icon={DollarSign}
                title="Financeiro"
                description="Configure categorias financeiras, dados bancários e regras de taxas"
                onClick={() => navigate("/configuracoes/financeiro")}
              />
              <SettingsCard
                icon={Shield}
                title="Grupos de Acessos"
                description="Gerencie as regras de acesso dos seus profissionais"
                onClick={() => navigate("/configuracoes/acessos")}
              />
              <SettingsCard
                icon={Webhook}
                title="Webhook / Agente IA"
                description="Conecte seu agente de IA para agendar, cadastrar clientes e mais"
                onClick={() => navigate("/configuracoes/webhook")}
              />
              <SettingsCard
                icon={Globe}
                title="API REST"
                description="API completa para integração com ERPs, apps mobile e dashboards"
                onClick={() => navigate("/configuracoes/api")}
              />
              <SettingsCard
                icon={Mail}
                title="E-mails Automáticos"
                description="Configure o Resend para envio de e-mails automáticos aos clientes"
                onClick={() => navigate("/configuracoes/email")}
              />
              <SettingsCard
                icon={ListOrdered}
                title="Fila Digital"
                description="Configure fila online, pagamentos, notificações e integrações"
                onClick={() => navigate("/configuracoes/fila")}
              />
              {isMaster && (
                <SettingsCard
                  icon={ShieldAlert}
                  title="Auditoria"
                  description="Registros de exclusões, alterações e ações críticas do sistema"
                  onClick={() => navigate("/configuracoes/auditoria")}
                />
              )}
            </div>
          </>
        )}

        {/* ===== INFORMAÇÕES DO ESTABELECIMENTO ===== */}
        {subPage === "estabelecimento" && (
          <>
            <SettingsBreadcrumb label="Informações do Estabelecimento" />
            <h1 className="text-2xl font-bold tracking-tight">Informações do Estabelecimento</h1>
            <MasterProfessionalProfile />
            <SalonInfoForm />
          </>
        )}

        {/* ===== AGENDAMENTO ===== */}
        {subPage === "agendamento" && (
          <SchedulingSettingsSection />
        )}

        {/* ===== COMISSÕES ===== */}
        {subPage === "comissoes" && (
          <>
            <SettingsBreadcrumb label="Comissões" />
            <CommissionSettingsPage />
          </>
        )}

        {/* ===== FINANCEIRO ===== */}
        {subPage === "financeiro" && (
          <>
            <SettingsBreadcrumb label="Financeiro" />
            <h1 className="text-2xl font-bold tracking-tight">Financeiro</h1>
            <div className="space-y-4">
              {/* Card Brands */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">Bandeiras de Cartão</CardTitle>
                      <CardDescription>Cadastre as bandeiras e suas taxas para descontar do valor pago.</CardDescription>
                    </div>
                    <Button onClick={() => { setSelectedCardBrand(null); setCardBrandModalOpen(true); }} className="gap-2">
                      <Plus className="h-4 w-4" />Nova Bandeira
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {isLoadingBrands ? (
                    <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                  ) : cardBrands.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <CreditCard className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>Nenhuma bandeira cadastrada.</p>
                      <p className="text-sm">Adicione bandeiras para controlar as taxas.</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Bandeira</TableHead>
                          <TableHead className="text-center">Débito</TableHead>
                          <TableHead className="text-center">Crédito</TableHead>
                          <TableHead className="text-center">2-6x</TableHead>
                          <TableHead className="text-center">7-12x</TableHead>
                          <TableHead className="text-center">13-18x</TableHead>
                          <TableHead className="text-center">Status</TableHead>
                          <TableHead className="w-[100px]">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {cardBrands.map((brand) => (
                          <TableRow key={brand.id}>
                            <TableCell className="font-medium">{brand.name}</TableCell>
                            <TableCell className="text-center"><Badge variant="outline">{brand.debit_fee_percent.toFixed(2)}%</Badge></TableCell>
                            <TableCell className="text-center"><Badge variant="outline">{brand.credit_fee_percent.toFixed(2)}%</Badge></TableCell>
                            <TableCell className="text-center"><Badge variant="outline">{(brand.credit_2_6_fee_percent || 0).toFixed(2)}%</Badge></TableCell>
                            <TableCell className="text-center"><Badge variant="outline">{(brand.credit_7_12_fee_percent || 0).toFixed(2)}%</Badge></TableCell>
                            <TableCell className="text-center"><Badge variant="outline">{(brand.credit_13_18_fee_percent || 0).toFixed(2)}%</Badge></TableCell>
                            <TableCell className="text-center"><Badge variant={brand.is_active ? "default" : "secondary"}>{brand.is_active ? "Ativa" : "Inativa"}</Badge></TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button variant="ghost" size="icon" onClick={() => { setSelectedCardBrand(brand); setCardBrandModalOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                                <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => { setCardBrandToDelete(brand); setDeleteCardBrandModalOpen(true); }}><Trash2 className="h-4 w-4" /></Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <CreditCard className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-amber-900 dark:text-amber-100">Como funcionam as taxas</h4>
                      <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                        Ao finalizar uma comanda, o sistema descontará automaticamente a taxa correspondente ao método de pagamento (débito, crédito, parcelamento ou PIX). A comissão será calculada sobre o valor líquido.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* PIX Fee */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Percent className="h-5 w-5" />Taxa de PIX
                  </CardTitle>
                  <CardDescription>Defina a taxa cobrada pela maquininha ou banco nos pagamentos via PIX.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-3">
                    <Label className="text-sm whitespace-nowrap">Taxa PIX:</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={commissionSettings.pix_fee_percent || 0}
                      onChange={(e) => saveCommissionSettings({ pix_fee_percent: parseFloat(e.target.value) || 0 })}
                      className="w-24 text-center"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                </CardContent>
              </Card>

              {/* Bank Accounts */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2"><Landmark className="h-5 w-5" />Contas Bancárias (PIX)</CardTitle>
                      <CardDescription>Cadastre as contas bancárias para destinar pagamentos via PIX.</CardDescription>
                    </div>
                    <Button onClick={() => { setSelectedBankAccount(null); setBankAccountModalOpen(true); }} className="gap-2">
                      <Plus className="h-4 w-4" />Nova Conta
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {isLoadingBankAccounts ? (
                    <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                  ) : bankAccounts.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Landmark className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>Nenhuma conta bancária cadastrada.</p>
                      <p className="text-sm">Adicione contas para selecionar o destino dos pagamentos PIX.</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Banco</TableHead>
                          <TableHead className="text-center">Status</TableHead>
                          <TableHead className="w-[100px]">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bankAccounts.map((account) => (
                          <TableRow key={account.id}>
                            <TableCell className="font-medium">{account.name}</TableCell>
                            <TableCell className="text-center"><Badge variant={account.is_active ? "default" : "secondary"}>{account.is_active ? "Ativa" : "Inativa"}</Badge></TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button variant="ghost" size="icon" onClick={() => { setSelectedBankAccount(account); setBankAccountModalOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                                <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => { setBankAccountToDelete(account); setDeleteBankAccountModalOpen(true); }}><Trash2 className="h-4 w-4" /></Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              <Card className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Landmark className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-green-900 dark:text-green-100">Como funcionam as contas</h4>
                      <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                        Ao receber um pagamento via PIX, você poderá selecionar para qual conta bancária o valor está sendo destinado.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        )}

        {/* ===== GRUPOS DE ACESSOS ===== */}
        {subPage === "acessos" && (
          <>
            <SettingsBreadcrumb label="Grupos de Acessos" />
            <h1 className="text-2xl font-bold tracking-tight">Grupos de Acessos</h1>
            <div className="space-y-4">
              {/* Info Card */}
              <Card className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Shield className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-blue-900 dark:text-blue-100">Sobre os níveis de acesso</h4>
                      <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                        Os acessos são criados ao cadastrar um profissional com "Criar acesso ao sistema" habilitado. 
                        Aqui você pode alterar o nível de permissão de cada usuário.
                      </p>
                      {!canManageAccess && (
                        <p className="text-sm text-orange-600 dark:text-orange-400 mt-2 font-medium">
                          ⚠️ Apenas o usuário master pode alterar permissões.
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Users Table */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Usuários com Acesso ao Sistema</CardTitle>
                  <CardDescription>Lista de todos os usuários que podem acessar o sistema.</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  {isLoading ? (
                    <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                  ) : users.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">Nenhum usuário cadastrado.</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Usuário</TableHead>
                          <TableHead>Nível de Acesso</TableHead>
                          <TableHead className="text-center">Abrir Caixa</TableHead>
                          <TableHead className="w-[80px]">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {users.map((userAccess) => {
                          const roleInfo = ROLE_LABELS[userAccess.role];
                          const isCurrentUser = userAccess.user_id === user?.id;
                          const isAdmin = userAccess.role === "admin";
                          return (
                            <TableRow key={userAccess.id}>
                              <TableCell>
                                <div className="flex items-center gap-3">
                                  <Avatar><AvatarFallback className="bg-primary/10 text-primary">{getInitials(userAccess.full_name)}</AvatarFallback></Avatar>
                                  <div>
                                    <p className="font-medium">
                                      {userAccess.full_name}
                                      {isCurrentUser && <Badge variant="outline" className="ml-2 text-xs">Você</Badge>}
                                    </p>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell>
                                {canManageAccess && !isAdmin ? (
                                  <Select value={userAccess.role} onValueChange={(value) => handleRoleChange(userAccess.user_id, value as AppRole)} disabled={isUpdating}>
                                    <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      {/* admin incluído: só o admin atual vê este seletor e pode
                                          promover qualquer usuário a Administrador (pedido do Cleiton). */}
                                      {Object.entries(ROLE_LABELS).map(([key, value]) => (
                                        <SelectItem key={key} value={key}>
                                          <div className="flex items-center gap-2">
                                            <div className={`h-2 w-2 rounded-full ${value.color}`} />
                                            {value.label}
                                          </div>
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <div className={`h-2 w-2 rounded-full ${roleInfo.color}`} />
                                    <span>{roleInfo.label}</span>
                                    {isAdmin && <Badge variant="destructive" className="text-xs">Master</Badge>}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="text-center">
                                {canManageAccess && !isAdmin ? (
                                  <Switch checked={userAccess.can_open_caixa} onCheckedChange={() => handleToggleCanOpenCaixa(userAccess.user_id, userAccess.can_open_caixa)} disabled={isUpdating} />
                                ) : (
                                  <Badge variant={userAccess.can_open_caixa ? "default" : "secondary"}>{userAccess.can_open_caixa ? "Sim" : "Não"}</Badge>
                                )}
                              </TableCell>
                              <TableCell>
                                {canManageAccess && !isAdmin && !isCurrentUser && (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem onClick={() => handleDeleteAccess(userAccess)} className="text-destructive">
                                        <Trash2 className="h-4 w-4 mr-2" />Remover Acesso
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              {/* Access Levels - AVEC Style */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">Grupos de Acessos</CardTitle>
                      <CardDescription>Configure os grupos de acesso e suas permissões para os profissionais.</CardDescription>
                    </div>
                    {canManageAccess && (
                      <Button onClick={() => setCreateAccessLevelModalOpen(true)} className="gap-2">
                        <Plus className="h-4 w-4" /> Adicionar grupo
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {accessLevelsError ? (
                    <div className="text-center py-8 text-destructive">
                      Erro ao carregar grupos: {(accessLevelsError as Error).message}
                      <br />
                      <Button variant="outline" size="sm" className="mt-2" onClick={() => queryClient.invalidateQueries({ queryKey: ["access-levels"] })}>
                        Tentar novamente
                      </Button>
                    </div>
                  ) : isLoadingAccessLevels ? (
                    <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                  ) : accessLevels.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      Nenhum grupo de acesso configurado.
                      <br />
                      <Button variant="outline" size="sm" className="mt-2" onClick={() => queryClient.invalidateQueries({ queryKey: ["access-levels"] })}>
                        Recarregar
                      </Button>
                    </div>
                  ) : (
                    <div className="border rounded-lg overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Grupo</TableHead>
                            <TableHead>Profissionais com este acesso</TableHead>
                            <TableHead className="text-right">Ação</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {accessLevels.map((level) => {
                            const profCount = users.filter((u) => {
                              if (u.access_level_id === level.id) return true;
                              if (!u.access_level_id && level.system_key && level.system_key === u.role) return true;
                              return false;
                            }).length;

                            return (
                              <TableRow key={level.id}>
                                <TableCell className="font-medium">{level.name}</TableCell>
                                <TableCell>{profCount}</TableCell>
                                <TableCell className="text-right">
                                  {level.system_key === "admin" ? (
                                    <span className="text-sm text-muted-foreground">Acesso completo</span>
                                  ) : (
                                    <div className="flex items-center justify-end gap-1">
                                      <Button
                                        variant="outline"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={() => { setSelectedAccessLevelId(level.id); setAccessLevelConfigModalOpen(true); }}
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                      {!level.is_system && canManageAccess && (
                                        <Button
                                          variant="destructive"
                                          size="icon"
                                          className="h-8 w-8"
                                          onClick={() => { setAccessLevelToDelete(level); setDeleteAccessLevelModalOpen(true); }}
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      )}
                                    </div>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Master Transfer */}
              {isMaster && (
                <Card className="border-red-200 dark:border-red-800">
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <ArrowRightLeft className="h-5 w-5 text-red-600 dark:text-red-400" />
                      <CardTitle className="text-lg text-red-600 dark:text-red-400">Transferir Acesso Master</CardTitle>
                    </div>
                    <CardDescription>Transfira seu acesso master para outro usuário. Esta ação é irreversível.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-4 rounded-lg">
                        <p className="text-sm text-red-700 dark:text-red-300">
                          <strong>Atenção:</strong> Ao transferir o acesso master, você perderá as permissões exclusivas de:
                        </p>
                        <ul className="mt-2 text-sm text-red-600 dark:text-red-400 list-disc list-inside">
                          <li>Excluir registros do sistema</li>
                          <li>Alterar permissões de outros usuários</li>
                          <li>Remover acessos de usuários</li>
                          <li>Transferir acesso master novamente</li>
                        </ul>
                      </div>
                      {eligibleUsersForMaster.length > 0 ? (
                        <Button variant="destructive" onClick={() => setTransferMasterModalOpen(true)} className="gap-2">
                          <ArrowRightLeft className="h-4 w-4" />Transferir Acesso Master
                        </Button>
                      ) : (
                        <p className="text-sm text-muted-foreground">Não há outros usuários disponíveis para receber o acesso master.</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </>
        )}

        {/* ===== WEBHOOK / AGENTE IA ===== */}
        {subPage === "webhook" && (
          <>
            <SettingsBreadcrumb label="Webhook / Agente IA" />
            <h1 className="text-2xl font-bold tracking-tight">Webhook / Agente IA</h1>
            <WebhookSettingsSection />
          </>
        )}

        {/* ===== API REST ===== */}
        {subPage === "api" && (
          <>
            <SettingsBreadcrumb label="API REST" />
            <h1 className="text-2xl font-bold tracking-tight">API REST Gateway</h1>
            <ApiGatewaySettingsSection />
          </>
        )}

        {/* ===== E-MAILS AUTOMÁTICOS ===== */}
        {subPage === "email" && (
          <>
            <SettingsBreadcrumb label="E-mails Automáticos" />
            <h1 className="text-2xl font-bold tracking-tight">E-mails Automáticos</h1>
            <ResendSettingsSection />
          </>
        )}

        {/* ===== AUDITORIA ===== */}
        {subPage === "auditoria" && isMaster && (
          <>
            <SettingsBreadcrumb label="Auditoria" />
            <AuditLogSection />
          </>
        )}

        {/* ===== FILA DIGITAL ===== */}
        {subPage === "fila" && (
          <>
            <SettingsBreadcrumb label="Fila Digital" />
            <h1 className="text-2xl font-bold tracking-tight">Fila Digital</h1>
            <QueueSettingsSection />
          </>
        )}
      </div>

      {/* Modals */}
      <DeleteConfirmModal open={deleteModalOpen} onOpenChange={setDeleteModalOpen} onConfirm={confirmDelete} title="Remover Acesso" description={`Tem certeza que deseja remover o acesso de "${selectedUser?.full_name}"?`} isLoading={isDeleting} />
      <DeleteConfirmModal open={deleteCardBrandModalOpen} onOpenChange={setDeleteCardBrandModalOpen} onConfirm={() => { if (cardBrandToDelete) { deleteCardBrand(cardBrandToDelete.id); setDeleteCardBrandModalOpen(false); setCardBrandToDelete(null); } }} title="Excluir Bandeira" description={`Excluir a bandeira "${cardBrandToDelete?.name}"?`} isLoading={isDeletingBrand} />
      <CardBrandModal open={cardBrandModalOpen} onClose={() => { setCardBrandModalOpen(false); setSelectedCardBrand(null); }} onSave={handleSaveCardBrand} cardBrand={selectedCardBrand} isLoading={isCreatingBrand || isUpdatingBrand} />
      <BankAccountModal isOpen={bankAccountModalOpen} onClose={() => { setBankAccountModalOpen(false); setSelectedBankAccount(null); }} onSave={handleSaveBankAccount} bankAccount={selectedBankAccount} isLoading={createBankAccount.isPending || updateBankAccount.isPending} />
      <DeleteConfirmModal open={deleteBankAccountModalOpen} onOpenChange={setDeleteBankAccountModalOpen} onConfirm={() => { if (bankAccountToDelete) { deleteBankAccount.mutate(bankAccountToDelete.id); setDeleteBankAccountModalOpen(false); setBankAccountToDelete(null); } }} title="Excluir Conta" description={`Excluir a conta "${bankAccountToDelete?.name}"?`} isLoading={deleteBankAccount.isPending} />
      <TransferMasterModal open={transferMasterModalOpen} onOpenChange={setTransferMasterModalOpen} users={eligibleUsersForMaster} onConfirm={handleTransferMaster} isLoading={isTransferring} />
      <AccessLevelConfigModal open={accessLevelConfigModalOpen} onOpenChange={setAccessLevelConfigModalOpen} accessLevel={selectedAccessLevel} onUpdatePermission={updatePermission} onUpdateAccessLevel={updateAccessLevel} isUpdating={isUpdatingAccessLevel} />
      <CreateAccessLevelModal open={createAccessLevelModalOpen} onOpenChange={setCreateAccessLevelModalOpen} onCreate={createAccessLevel} isCreating={isCreatingAccessLevel} />
      <DeleteConfirmModal open={deleteAccessLevelModalOpen} onOpenChange={setDeleteAccessLevelModalOpen} onConfirm={() => { if (accessLevelToDelete) { deleteAccessLevel(accessLevelToDelete.id); setDeleteAccessLevelModalOpen(false); setAccessLevelToDelete(null); } }} title="Excluir Nível" description={`Excluir o nível "${accessLevelToDelete?.name}"?`} isLoading={isDeletingAccessLevel} />
    </AppLayoutNew>
  );
}
