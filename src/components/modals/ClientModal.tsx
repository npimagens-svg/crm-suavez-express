import { useState, useEffect } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Client, ClientInput } from "@/hooks/useClients";
import { useClientComandas } from "@/hooks/useComandas";
import { useProfessionals } from "@/hooks/useProfessionals";
import { useCepLookup } from "@/hooks/useCepLookup";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Loader2, Search, ChevronDown, ChevronUp, Eye } from "lucide-react";
import { AvatarUpload } from "@/components/shared/AvatarUpload";
import { ClientPackagesTab } from "@/components/clients/ClientPackagesTab";
import { ClientFinanceTab } from "@/components/clients/ClientFinanceTab";

const HOW_MET_OPTIONS = [
  { value: "indicacao", label: "Indicação" },
  { value: "google", label: "Google" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "localizacao", label: "Localização" },
  { value: "tiktok", label: "TikTok" },
  { value: "outro", label: "Outro" },
];

interface ClientModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client?: Client | null;
  onSubmit: (data: ClientInput & { id?: string }) => void;
  isLoading?: boolean;
  initialName?: string;
}

const BRAZILIAN_STATES = [
  { value: "AC", label: "Acre" },
  { value: "AL", label: "Alagoas" },
  { value: "AP", label: "Amapá" },
  { value: "AM", label: "Amazonas" },
  { value: "BA", label: "Bahia" },
  { value: "CE", label: "Ceará" },
  { value: "DF", label: "Distrito Federal" },
  { value: "ES", label: "Espírito Santo" },
  { value: "GO", label: "Goiás" },
  { value: "MA", label: "Maranhão" },
  { value: "MT", label: "Mato Grosso" },
  { value: "MS", label: "Mato Grosso do Sul" },
  { value: "MG", label: "Minas Gerais" },
  { value: "PA", label: "Pará" },
  { value: "PB", label: "Paraíba" },
  { value: "PR", label: "Paraná" },
  { value: "PE", label: "Pernambuco" },
  { value: "PI", label: "Piauí" },
  { value: "RJ", label: "Rio de Janeiro" },
  { value: "RN", label: "Rio Grande do Norte" },
  { value: "RS", label: "Rio Grande do Sul" },
  { value: "RO", label: "Rondônia" },
  { value: "RR", label: "Roraima" },
  { value: "SC", label: "Santa Catarina" },
  { value: "SP", label: "São Paulo" },
  { value: "SE", label: "Sergipe" },
  { value: "TO", label: "Tocantins" },
];

const initialFormData: ClientInput = {
  name: "",
  email: "",
  phone: "",
  phone_landline: "",
  birth_date: "",
  notes: "",
  tags: [],
  gender: "prefer_not_say",
  cpf: "",
  rg: "",
  cep: "",
  state: "",
  city: "",
  neighborhood: "",
  address: "",
  address_number: "",
  address_complement: "",
  how_met: "",
  profession: "",
  allow_email_campaigns: true,
  allow_sms_campaigns: true,
  allow_online_booking: true,
  add_cpf_invoice: true,
  allow_ai_service: true,
  allow_whatsapp_campaigns: true,
  avatar_url: null,
};

export function ClientModal({ open, onOpenChange, client, onSubmit, isLoading, initialName }: ClientModalProps) {
  const [formData, setFormData] = useState<ClientInput>({ ...initialFormData, name: initialName || "" });

  useEffect(() => {
    if (client) {
      setFormData({
        name: client.name,
        email: client.email || "",
        phone: client.phone || "",
        phone_landline: client.phone_landline || "",
        birth_date: client.birth_date || "",
        notes: client.notes || "",
        tags: client.tags || [],
        gender: client.gender || "prefer_not_say",
        cpf: client.cpf || "",
        rg: client.rg || "",
        cep: client.cep || "",
        state: client.state || "",
        city: client.city || "",
        neighborhood: client.neighborhood || "",
        address: client.address || "",
        address_number: client.address_number || "",
        address_complement: client.address_complement || "",
        how_met: client.how_met || "",
        profession: client.profession || "",
        allow_email_campaigns: client.allow_email_campaigns ?? true,
        allow_sms_campaigns: client.allow_sms_campaigns ?? true,
        allow_online_booking: client.allow_online_booking ?? true,
        add_cpf_invoice: client.add_cpf_invoice ?? true,
        allow_ai_service: client.allow_ai_service ?? true,
        allow_whatsapp_campaigns: client.allow_whatsapp_campaigns ?? true,
        avatar_url: client.avatar_url || null,
      });
    } else {
      setFormData({ ...initialFormData, name: initialName || "" });
    }
  }, [client, open, initialName]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name?.trim() || !formData.phone?.trim()) {
      return;
    }

    if (client) {
      onSubmit({ ...formData, id: client.id });
    } else {
      onSubmit(formData);
    }
    onOpenChange(false);
  };

  const updateField = (field: keyof ClientInput, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const { lookupCep, isLoading: isLoadingCep } = useCepLookup();

  const handleCepLookup = async () => {
    const addressData = await lookupCep(formData.cep || "");
    if (addressData) {
      setFormData((prev) => ({
        ...prev,
        address: addressData.address,
        neighborhood: addressData.neighborhood,
        city: addressData.city,
        state: addressData.state,
        address_complement: addressData.address_complement || prev.address_complement,
      }));
    }
  };

  const handleCepChange = (value: string) => {
    // Format CEP as user types (00000-000)
    const cleaned = value.replace(/\D/g, "");
    let formatted = cleaned;
    if (cleaned.length > 5) {
      formatted = `${cleaned.slice(0, 5)}-${cleaned.slice(5, 8)}`;
    }
    updateField("cep", formatted);
    
    // Auto-lookup when CEP is complete
    if (cleaned.length === 8) {
      lookupCep(cleaned).then((addressData) => {
        if (addressData) {
          setFormData((prev) => ({
            ...prev,
            address: addressData.address,
            neighborhood: addressData.neighborhood,
            city: addressData.city,
            state: addressData.state,
            address_complement: addressData.address_complement || prev.address_complement,
          }));
        }
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{client ? "Editar Cliente" : "Cadastre um novo cliente"}</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="cadastro" className="w-full">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="cadastro">Cadastro</TabsTrigger>
            <TabsTrigger value="comandas" disabled={!client}>Comandas</TabsTrigger>
            <TabsTrigger value="pacotes" disabled={!client}>Pacotes</TabsTrigger>
            <TabsTrigger value="financeiro" disabled={!client}>Financeiro</TabsTrigger>
            <TabsTrigger value="anamnese">Anamnese</TabsTrigger>
          </TabsList>
          <form onSubmit={handleSubmit}>
            <ScrollArea className="h-[60vh] pr-4">
              <TabsContent value="cadastro" className="space-y-6 mt-4">
                {/* Avatar Upload */}
                <div className="flex justify-center">
                  <AvatarUpload
                    currentAvatarUrl={formData.avatar_url}
                    name={formData.name}
                    onAvatarChange={(url) => updateField("avatar_url", url)}
                    folder="clients"
                    size="lg"
                  />
                </div>

                {/* Nome e Data de Aniversário */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Nome conforme documento (Obrigatório):</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => updateField("name", e.target.value.toUpperCase())}
                      className="uppercase"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="birth_date">Data de Aniversário:</Label>
                    <Input
                      id="birth_date"
                      type="date"
                      value={formData.birth_date}
                      onChange={(e) => updateField("birth_date", e.target.value)}
                    />
                  </div>
                </div>

                {/* Celular e Telefone */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="phone">Celular / WhatsApp (Obrigatório):</Label>
                    <div className="flex gap-2">
                      <Input className="w-20" value="+55" disabled />
                      <Input
                        id="phone"
                        placeholder="(11) 99999-9999"
                        value={formData.phone}
                        onChange={(e) => updateField("phone", e.target.value)}
                        className="flex-1"
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone_landline">Telefone:</Label>
                    <div className="flex gap-2">
                      <Input className="w-20" value="+55" disabled />
                      <Input
                        id="phone_landline"
                        placeholder="(11) 99999-9999"
                        value={formData.phone_landline}
                        onChange={(e) => updateField("phone_landline", e.target.value)}
                        className="flex-1"
                      />
                    </div>
                  </div>
                </div>

                {/* Gênero */}
                <div className="space-y-2">
                  <Label>Gênero:</Label>
                  <RadioGroup
                    value={formData.gender}
                    onValueChange={(value) => updateField("gender", value)}
                    className="flex flex-wrap gap-4"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="male" id="male" />
                      <Label htmlFor="male" className="font-normal">Masculino</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="female" id="female" />
                      <Label htmlFor="female" className="font-normal">Feminino</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="other" id="other" />
                      <Label htmlFor="other" className="font-normal">Outro</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="prefer_not_say" id="prefer_not_say" />
                      <Label htmlFor="prefer_not_say" className="font-normal">Prefiro não dizer</Label>
                    </div>
                  </RadioGroup>
                </div>

                {/* CPF e RG */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="cpf">CPF:</Label>
                    <Input
                      id="cpf"
                      value={formData.cpf}
                      onChange={(e) => updateField("cpf", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rg">RG:</Label>
                    <Input
                      id="rg"
                      value={formData.rg}
                      onChange={(e) => updateField("rg", e.target.value)}
                    />
                  </div>
                </div>

                {/* Email e CEP */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">E-mail (Opcional):</Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => updateField("email", e.target.value.toLowerCase())}
                      className="lowercase"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cep">CEP:</Label>
                    <div className="flex gap-2">
                      <Input
                        id="cep"
                        value={formData.cep}
                        onChange={(e) => handleCepChange(e.target.value)}
                        maxLength={9}
                        placeholder="00000-000"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={handleCepLookup}
                        disabled={isLoadingCep || !formData.cep}
                        title="Buscar endereço"
                      >
                        {isLoadingCep ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Search className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Estado, Cidade, Bairro */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="state">Estado:</Label>
                    <Select value={formData.state} onValueChange={(value) => updateField("state", value)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um estado" />
                      </SelectTrigger>
                      <SelectContent>
                        {BRAZILIAN_STATES.map((state) => (
                          <SelectItem key={state.value} value={state.value}>
                            {state.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="city">Cidade:</Label>
                    <Input
                      id="city"
                      value={formData.city}
                      onChange={(e) => updateField("city", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="neighborhood">Bairro:</Label>
                    <Input
                      id="neighborhood"
                      value={formData.neighborhood}
                      onChange={(e) => updateField("neighborhood", e.target.value)}
                    />
                  </div>
                </div>

                {/* Endereço, Número, Complemento */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="address">Endereço:</Label>
                    <Input
                      id="address"
                      value={formData.address}
                      onChange={(e) => updateField("address", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="address_number">Número:</Label>
                    <Input
                      id="address_number"
                      value={formData.address_number}
                      onChange={(e) => updateField("address_number", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="address_complement">Complemento:</Label>
                    <Input
                      id="address_complement"
                      value={formData.address_complement}
                      onChange={(e) => updateField("address_complement", e.target.value)}
                    />
                  </div>
                </div>

                {/* Observação e Como conheceu + Profissão */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="notes">Observação:</Label>
                    <Textarea
                      id="notes"
                      value={formData.notes}
                      onChange={(e) => updateField("notes", e.target.value)}
                      rows={4}
                    />
                  </div>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="how_met">Como conheceu?</Label>
                      <Select value={formData.how_met} onValueChange={(value) => updateField("how_met", value)}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione uma opção" />
                        </SelectTrigger>
                        <SelectContent>
                          {HOW_MET_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="profession">Profissão:</Label>
                      <Input
                        id="profession"
                        value={formData.profession}
                        onChange={(e) => updateField("profession", e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {/* Permissões */}
                <div className="space-y-3">
                  <Label className="text-base font-medium">Permissões:</Label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="allow_email_campaigns"
                        checked={formData.allow_email_campaigns}
                        onCheckedChange={(checked) => updateField("allow_email_campaigns", checked)}
                      />
                      <Label htmlFor="allow_email_campaigns" className="font-normal text-sm">
                        Campanhas de <strong>e-mail</strong>
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="allow_sms_campaigns"
                        checked={formData.allow_sms_campaigns}
                        onCheckedChange={(checked) => updateField("allow_sms_campaigns", checked)}
                      />
                      <Label htmlFor="allow_sms_campaigns" className="font-normal text-sm">
                        Campanhas de <strong>sms</strong>
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="allow_online_booking"
                        checked={formData.allow_online_booking}
                        onCheckedChange={(checked) => updateField("allow_online_booking", checked)}
                      />
                      <Label htmlFor="allow_online_booking" className="font-normal text-sm">
                        Agendamento online
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="add_cpf_invoice"
                        checked={formData.add_cpf_invoice}
                        onCheckedChange={(checked) => updateField("add_cpf_invoice", checked)}
                      />
                      <Label htmlFor="add_cpf_invoice" className="font-normal text-sm">
                        Adicionar CPF na Nota Fiscal
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="allow_ai_service"
                        checked={formData.allow_ai_service}
                        onCheckedChange={(checked) => updateField("allow_ai_service", checked)}
                      />
                      <Label htmlFor="allow_ai_service" className="font-normal text-sm">
                        Atendimento por <strong>IA</strong>
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="allow_whatsapp_campaigns"
                        checked={formData.allow_whatsapp_campaigns}
                        onCheckedChange={(checked) => updateField("allow_whatsapp_campaigns", checked)}
                      />
                      <Label htmlFor="allow_whatsapp_campaigns" className="font-normal text-sm">
                        Campanhas de <strong>WhatsApp</strong>
                      </Label>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="comandas" className="space-y-4 mt-4">
                <ClientComandasTab clientId={client?.id || null} />
              </TabsContent>

              <TabsContent value="pacotes" className="space-y-4 mt-4">
                {client ? (
                  <ClientPackagesTab clientId={client.id} clientName={client.name} />
                ) : (
                  <div className="flex items-center justify-center h-40 text-muted-foreground">
                    <p>Salve o cliente primeiro para ver pacotes.</p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="financeiro" className="space-y-4 mt-4">
                {client ? (
                  <ClientFinanceTab clientId={client.id} clientName={client.name} />
                ) : (
                  <div className="flex items-center justify-center h-40 text-muted-foreground">
                    <p>Salve o cliente primeiro para acessar o financeiro.</p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="anamnese" className="space-y-4 mt-4">
                <div className="flex items-center justify-center h-40 text-muted-foreground">
                  <p>Funcionalidade de anamnese em breve.</p>
                </div>
              </TabsContent>
            </ScrollArea>

            <DialogFooter className="mt-4 pt-4 border-t">
              <Button 
                type="button" 
                variant="outline" 
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onOpenChange(false);
                }}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? "Salvando..." : "Salvar"}
              </Button>
            </DialogFooter>
          </form>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

interface ClientComandasTabProps {
  clientId: string | null;
}

function ClientComandasTab({ clientId }: ClientComandasTabProps) {
  const { comandas, isLoading } = useClientComandas(clientId);
  const { professionals } = useProfessionals();
  const [expandedComanda, setExpandedComanda] = useState<string | null>(null);

  const getProfessionalName = (professionalId: string | null) => {
    if (!professionalId) return "—";
    const professional = professionals.find((p) => p.id === professionalId);
    return professional?.name || "—";
  };

  const formatPaymentMethod = (method: string) => {
    const methods: Record<string, string> = {
      cash: "Dinheiro",
      pix: "PIX",
      credit_card: "Cartão de Crédito",
      debit_card: "Cartão de Débito",
      transfer: "Transferência",
      voucher: "Voucher",
      other: "Outro",
    };
    return methods[method] || method;
  };

  const formatCurrency = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (comandas.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground">
        <p>Nenhuma comanda encontrada para este cliente.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Histórico de atendimentos e compras do cliente.</p>
      {comandas.map((comanda: any) => {
        const isExpanded = expandedComanda === comanda.id;
        const date = format(new Date(comanda.created_at), "dd/MM/yyyy", { locale: ptBR });
        const profName = comanda.professional?.name || getProfessionalName(comanda.professional_id);
        const items = comanda.items || [];
        const payments = comanda.payments || [];

        return (
          <div key={comanda.id} className="border rounded-lg overflow-hidden">
            {/* Summary row */}
            <button
              type="button"
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
              onClick={() => setExpandedComanda(isExpanded ? null : comanda.id)}
            >
              <span className="font-semibold text-primary whitespace-nowrap">{date}</span>
              <span className="text-sm text-muted-foreground truncate">{profName}</span>
              <div className="flex-1 min-w-0 flex gap-1 flex-wrap">
                {items.slice(0, 2).map((item: any) => (
                  <Badge key={item.id} variant="outline" className="text-xs truncate max-w-[150px]">
                    {item.description}
                  </Badge>
                ))}
                {items.length > 2 && (
                  <Badge variant="secondary" className="text-xs">+{items.length - 2}</Badge>
                )}
              </div>
              <span className="font-semibold whitespace-nowrap">{formatCurrency(comanda.total || 0)}</span>
              <Badge variant={comanda.is_paid ? "default" : "secondary"} className="text-xs shrink-0">
                {comanda.is_paid ? "Pago" : "Aberto"}
              </Badge>
              {isExpanded ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
            </button>

            {/* Expanded details */}
            {isExpanded && (
              <div className="border-t bg-muted/20 px-4 py-3 space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <span className="text-xs text-muted-foreground block">Comanda</span>
                    <span className="font-medium">Nº {String(comanda.comanda_number || "—").padStart(4, "0")}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Profissional</span>
                    <span className="font-medium">{profName}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Total</span>
                    <span className="font-medium">{formatCurrency(comanda.total || 0)}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Status</span>
                    <Badge variant={comanda.is_paid ? "default" : "secondary"}>
                      {comanda.is_paid ? "Pago" : "Em aberto"}
                    </Badge>
                  </div>
                </div>

                {/* Services/Items */}
                <div>
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Itens</span>
                  <div className="mt-1 divide-y">
                    {items.map((item: any) => (
                      <div key={item.id} className="flex items-center justify-between py-1.5 text-sm">
                        <div className="flex-1">
                          <span>{item.quantity > 1 ? `${item.quantity}x ` : ""}{item.description}</span>
                          {item.professional?.name && item.professional_id !== comanda.professional_id && (
                            <span className="text-xs text-muted-foreground ml-2">({item.professional.name})</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          {item.product_cost > 0 && (
                            <span className="text-xs text-destructive">Prod: -{formatCurrency(item.product_cost)}</span>
                          )}
                          <span className="font-medium">{formatCurrency(item.total_price || 0)}</span>
                        </div>
                      </div>
                    ))}
                    {items.length === 0 && (
                      <p className="text-sm text-muted-foreground py-2">Nenhum item registrado</p>
                    )}
                  </div>
                </div>

                {/* Payments */}
                {payments.length > 0 && (
                  <div>
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Pagamentos</span>
                    <div className="mt-1 divide-y">
                      {payments.map((p: any) => (
                        <div key={p.id} className="flex items-center justify-between py-1.5 text-sm">
                          <span>{formatPaymentMethod(p.payment_method)}</span>
                          <div className="flex items-center gap-2">
                            {p.fee_amount > 0 && (
                              <span className="text-xs text-destructive">Taxa: -{formatCurrency(p.fee_amount)}</span>
                            )}
                            <span className="font-medium">{formatCurrency(Number(p.amount) || 0)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
