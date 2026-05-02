import { useState } from "react";
import { AppLayoutNew } from "@/components/layout/AppLayoutNew";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, Clock, DollarSign, MoreHorizontal, Loader2, Upload, Search, FileText, FileSpreadsheet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { useServices, Service, ServiceInput } from "@/hooks/useServices";
import { ServiceModal } from "@/components/modals/ServiceModal";
import { DeleteConfirmModal } from "@/components/modals/DeleteConfirmModal";
import { ImportModal, ImportField } from "@/components/modals/ImportModal";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export default function Servicos() {
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const { services, isLoading, createService, updateService, deleteService, restoreService, isCreating, isUpdating, isDeleting } = useServices({ includeArchived: showArchived });
  const { isMaster, salonId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const serviceImportFields: ImportField[] = [
    { key: "name", label: "Nome", required: true },
    { key: "description", label: "Descrição" },
    { key: "duration_minutes", label: "Duração (minutos)", required: true },
    { key: "price", label: "Preço", required: true },
    { key: "category", label: "Categoria" },
    { key: "commission_percent", label: "Comissão (%)" },
  ];

  const handleImportServices = async (records: Record<string, any>[]) => {
    if (!salonId) throw new Error("Salão não encontrado");
    const rows = records.map(r => ({
      salon_id: salonId,
      name: String(r.name),
      description: r.description ? String(r.description) : null,
      duration_minutes: parseInt(String(r.duration_minutes)) || 30,
      price: parseFloat(String(r.price).replace(",", ".")) || 0,
      category: r.category ? String(r.category) : null,
      commission_percent: r.commission_percent ? parseFloat(String(r.commission_percent).replace(",", ".")) : 0,
      is_active: true,
    }));

    for (let i = 0; i < rows.length; i += 50) {
      const batch = rows.slice(i, i + 50);
      const { error } = await supabase.from("services").insert(batch);
      if (error) throw error;
    }

    queryClient.invalidateQueries({ queryKey: ["services"] });
    toast({ title: `${rows.length} serviços importados com sucesso!` });
  };

  const handleEdit = (service: Service) => { setSelectedService(service); setModalOpen(true); };
  const handleDelete = (service: Service) => { setSelectedService(service); setDeleteOpen(true); };

  const handleSubmit = (data: ServiceInput & { id?: string }) => {
    if (data.id) updateService(data as ServiceInput & { id: string });
    else createService(data);
  };

  const formatDuration = (min: number) => min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}min` : ""}` : `${min}min`;

  const filteredServices = services.filter(s => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return s.name.toLowerCase().includes(q) || (s.category || "").toLowerCase().includes(q);
  });

  const handleExportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Lista de Serviços", 14, 15);
    doc.setFontSize(9);
    doc.text(`Gerado em ${new Date().toLocaleDateString("pt-BR")}`, 14, 22);

    autoTable(doc, {
      startY: 28,
      head: [["Serviço", "Categoria", "Duração", "Preço (R$)", "Comissão (%)"]],
      body: filteredServices.map(s => [
        s.name,
        s.category || "-",
        formatDuration(s.duration_minutes),
        `R$ ${Number(s.price).toFixed(2)}`,
        `${Number(s.commission_percent) || 0}%`,
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [234, 88, 12] },
    });
    doc.save("Servicos.pdf");
  };

  const handleExportXLS = () => {
    const data = filteredServices.map(s => ({
      "Serviço": s.name,
      "Categoria": s.category || "",
      "Duração (min)": s.duration_minutes,
      "Preço (R$)": Number(s.price),
      "Comissão (%)": Number(s.commission_percent) || 0,
      "Ativo": s.is_active ? "Sim" : "Não",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Serviços");
    XLSX.writeFile(wb, "Servicos.xlsx");
  };

  if (isLoading) {
    return <AppLayoutNew><div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div></AppLayoutNew>;
  }

  return (
    <AppLayoutNew>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <p className="text-muted-foreground">Gerencie os serviços oferecidos pelo salão</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-2" onClick={handleExportPDF}>
              <FileText className="h-4 w-4" />
              PDF
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={handleExportXLS}>
              <FileSpreadsheet className="h-4 w-4" />
              XLS
            </Button>
            {isMaster && (
              <Button variant="outline" className="gap-2" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" />
                Importar
              </Button>
            )}
            <Button className="gap-2" onClick={() => { setSelectedService(null); setModalOpen(true); }}><Plus className="h-4 w-4" />Novo Serviço</Button>
          </div>
        </div>
        {services.length === 0 ? (
          <Card className="flex items-center justify-center py-12">
            <div className="text-center text-muted-foreground">
              <p>Nenhum serviço cadastrado</p>
              <Button variant="link" onClick={() => { setSelectedService(null); setModalOpen(true); }}>Adicionar primeiro serviço</Button>
            </div>
          </Card>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar serviço por nome ou categoria..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Switch id="show-archived" checked={showArchived} onCheckedChange={setShowArchived} />
                <Label htmlFor="show-archived" className="cursor-pointer text-sm">Mostrar arquivados</Label>
              </div>
            </div>
            <Card>
              <CardContent className="p-0">
                <div className="flex items-center gap-4 px-4 py-2 border-b bg-muted/50 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  <span className="flex-1">Serviço</span>
                  <span className="w-16 text-center">Duração</span>
                  <span className="w-24 text-right">Preço</span>
                  <span className="w-16 text-right">Comissão</span>
                  <span className="w-8"></span>
                </div>
                <div className="divide-y">
                  {filteredServices.map((service) => (
                      <div
                        key={service.id}
                        className={`flex items-center gap-4 px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer ${!service.is_active ? "opacity-50" : ""}`}
                        onClick={() => handleEdit(service)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">{service.name}</span>
                            {service.category && <Badge variant="outline" className="text-xs shrink-0">{service.category}</Badge>}
                            {!service.is_active && <Badge variant="secondary" className="text-xs shrink-0 bg-amber-100 text-amber-800">Arquivado</Badge>}
                          </div>
                        </div>
                        <div className="flex items-center gap-4 shrink-0 text-sm">
                          <span className="flex items-center gap-1 text-muted-foreground w-16 justify-center">
                            <Clock className="h-3.5 w-3.5" />
                            {formatDuration(service.duration_minutes)}
                          </span>
                          <span className="font-medium w-24 text-right">
                            R$ {Number(service.price).toFixed(2)}
                          </span>
                          <span className="text-muted-foreground w-16 text-right">
                            {Number(service.commission_percent) || 0}%
                          </span>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleEdit(service); }}>Editar</DropdownMenuItem>
                              {service.is_active ? (
                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleDelete(service); }} className="text-destructive">Excluir</DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); restoreService(service.id); }} className="text-emerald-700">Reativar</DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    ))}
                  {filteredServices.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      Nenhum serviço encontrado para "{searchQuery}"
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
      <ServiceModal open={modalOpen} onOpenChange={setModalOpen} service={selectedService} onSubmit={handleSubmit} isLoading={isCreating || isUpdating} />
      <DeleteConfirmModal open={deleteOpen} onOpenChange={setDeleteOpen} title="Excluir Serviço" description={`Tem certeza que deseja excluir "${selectedService?.name}"?`} onConfirm={() => { if (selectedService) { deleteService(selectedService.id); setDeleteOpen(false); } }} isLoading={isDeleting} />
      <ImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Importar Serviços"
        description="Importe serviços de uma planilha XLS, XLSX ou CSV exportada de outro sistema."
        fields={serviceImportFields}
        onImport={handleImportServices}
      />
    </AppLayoutNew>
  );
}