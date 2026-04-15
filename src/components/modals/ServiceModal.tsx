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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Service, ServiceInput } from "@/hooks/useServices";
import { useProducts, Product } from "@/hooks/useProducts";
import { useServiceProducts, ServiceProduct } from "@/hooks/useServiceProducts";
import { Plus, Trash2, Package, Loader2, Search } from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface ServiceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service?: Service | null;
  onSubmit: (data: ServiceInput & { id?: string }) => void;
  isLoading?: boolean;
}

export function ServiceModal({ open, onOpenChange, service, onSubmit, isLoading }: ServiceModalProps) {
  const [formData, setFormData] = useState<ServiceInput>({
    name: "",
    description: "",
    duration_minutes: 30,
    price: 0,
    commission_percent: 0,
    category: "",
    is_active: true,
    queue_enabled: false,
    send_return_reminder: false,
    return_reminder_days: 30,
    return_reminder_message: "",
  });
  const [activeTab, setActiveTab] = useState("info");
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [productPopoverOpen, setProductPopoverOpen] = useState(false);
  const [quantityToAdd, setQuantityToAdd] = useState<number>(1);

  const { products } = useProducts();
  const { 
    serviceProducts, 
    isLoading: isLoadingProducts, 
    addProduct, 
    removeProduct, 
    updateQuantity,
    isAdding,
    isRemoving,
    calculateProductCost 
  } = useServiceProducts(service?.id);

  // Filter products that can be used in services (not just for resale)
  const availableProducts = products.filter(p => p.is_active);
  const linkedProductIds = serviceProducts.map(sp => sp.product_id);
  const unlinkedProducts = availableProducts.filter(p => !linkedProductIds.includes(p.id));

  useEffect(() => {
    if (service) {
      setFormData({
        name: service.name,
        description: service.description || "",
        duration_minutes: service.duration_minutes,
        price: Number(service.price),
        commission_percent: Number(service.commission_percent) || 0,
        category: service.category || "",
        is_active: service.is_active,
        queue_enabled: service.queue_enabled || false,
        send_return_reminder: service.send_return_reminder || false,
        return_reminder_days: service.return_reminder_days || 30,
        return_reminder_message: service.return_reminder_message || "",
      });
    } else {
      setFormData({
        name: "",
        description: "",
        duration_minutes: 30,
        price: 0,
        commission_percent: 0,
        category: "",
        is_active: true,
        queue_enabled: false,
        send_return_reminder: false,
        return_reminder_days: 30,
        return_reminder_message: "",
      });
    }
    setActiveTab("info");
    setSelectedProductId("");
    setQuantityToAdd(1);
  }, [service, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (service) {
      onSubmit({ ...formData, id: service.id });
    } else {
      onSubmit(formData);
    }
    onOpenChange(false);
  };

  const handleAddProduct = () => {
    if (!selectedProductId || !service?.id) return;
    addProduct({
      service_id: service.id,
      product_id: selectedProductId,
      quantity_per_use: quantityToAdd,
    });
    setSelectedProductId("");
    setQuantityToAdd(1);
  };

  const getUnitLabel = (unit: string) => {
    switch (unit) {
      case "ml": return "ml";
      case "g": return "g";
      case "kg": return "kg";
      case "l": return "L";
      default: return "un";
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
  };

  const totalProductCost = calculateProductCost(serviceProducts);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{service ? "Editar Serviço" : "Novo Serviço"}</DialogTitle>
        </DialogHeader>
        
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="info">Informações</TabsTrigger>
            <TabsTrigger value="products" disabled={!service}>
              <Package className="h-4 w-4 mr-2" />
              Produtos ({serviceProducts.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="info">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nome *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Descrição</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="duration">Duração (min) *</Label>
                  <Input
                    id="duration"
                    type="number"
                    min={5}
                    step={5}
                    value={formData.duration_minutes}
                    onChange={(e) => setFormData({ ...formData, duration_minutes: parseInt(e.target.value) || 30 })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="price">Preço (R$) *</Label>
                  <Input
                    id="price"
                    type="number"
                    min={0}
                    step={0.01}
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="commission">Comissão (%)</Label>
                  <Input
                    id="commission"
                    type="number"
                    min={0}
                    max={100}
                    value={formData.commission_percent}
                    onChange={(e) => setFormData({ ...formData, commission_percent: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="category">Categoria</Label>
                  <Input
                    id="category"
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="is_active">Serviço Ativo</Label>
                <Switch
                  id="is_active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="queue_enabled">Disponível na Fila Online</Label>
                  <p className="text-xs text-muted-foreground">Aparece na página pública para compra online</p>
                </div>
                <Switch
                  id="queue_enabled"
                  checked={formData.queue_enabled}
                  onCheckedChange={(checked) => setFormData({ ...formData, queue_enabled: checked })}
                />
              </div>

              {/* Return Reminder */}
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="send_return_reminder" className="font-medium">Lembrete de Retorno</Label>
                    <p className="text-xs text-muted-foreground">Enviar e-mail lembrando o cliente de retornar</p>
                  </div>
                  <Switch
                    id="send_return_reminder"
                    checked={formData.send_return_reminder}
                    onCheckedChange={(checked) => setFormData({ ...formData, send_return_reminder: checked })}
                  />
                </div>
                {formData.send_return_reminder && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="return_reminder_days">Dias após o serviço</Label>
                      <Input
                        id="return_reminder_days"
                        type="number"
                        min={1}
                        value={formData.return_reminder_days}
                        onChange={(e) => setFormData({ ...formData, return_reminder_days: parseInt(e.target.value) || 30 })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="return_reminder_message">Mensagem personalizada (opcional)</Label>
                      <Textarea
                        id="return_reminder_message"
                        value={formData.return_reminder_message}
                        onChange={(e) => setFormData({ ...formData, return_reminder_message: e.target.value })}
                        rows={2}
                        placeholder="Ex: Seu cabelo vai adorar! Agende já seu retorno."
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Product Cost Summary */}
              {service && serviceProducts.length > 0 && (
                <div className="rounded-lg bg-muted p-3 space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>Custo de Produtos:</span>
                    <span className="text-destructive font-medium">- {formatCurrency(totalProductCost)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Valor Líquido:</span>
                    <span className="font-medium">{formatCurrency(formData.price - totalProductCost)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Base para Comissão ({formData.commission_percent}%):</span>
                    <span>{formatCurrency((formData.price - totalProductCost) * (formData.commission_percent / 100))}</span>
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={isLoading}>
                  {isLoading ? "Salvando..." : "Salvar"}
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>

          <TabsContent value="products" className="space-y-4">
            {!service ? (
              <p className="text-center text-muted-foreground py-4">
                Salve o serviço primeiro para adicionar produtos
              </p>
            ) : (
              <>
                {/* Add Product */}
                <div className="flex gap-2">
                  <Popover open={productPopoverOpen} onOpenChange={(open) => { setProductPopoverOpen(open); if (open) setProductSearchQuery(""); }}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="flex-1 justify-start font-normal">
                        {selectedProductId ? (
                          <span>{unlinkedProducts.find(p => p.id === selectedProductId)?.name || products.find(p => p.id === selectedProductId)?.name || "Produto"}</span>
                        ) : (
                          <span className="text-muted-foreground">Buscar produto...</span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 p-0" align="start">
                      <Command shouldFilter={false}>
                        <div className="p-2">
                          <div className="relative">
                            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                            <input
                              className="w-full pl-8 pr-3 py-2 text-sm border rounded-md outline-none focus:ring-2 focus:ring-primary"
                              placeholder="Digite para buscar..."
                              value={productSearchQuery}
                              onChange={(e) => setProductSearchQuery(e.target.value)}
                              autoFocus
                            />
                          </div>
                        </div>
                        <CommandList>
                          {unlinkedProducts.filter(p => p.name.toLowerCase().includes(productSearchQuery.toLowerCase())).length === 0 ? (
                            <CommandEmpty>Nenhum produto encontrado</CommandEmpty>
                          ) : (
                            <CommandGroup>
                              {unlinkedProducts
                                .filter(p => p.name.toLowerCase().includes(productSearchQuery.toLowerCase()))
                                .map((product) => (
                                  <CommandItem
                                    key={product.id}
                                    onSelect={() => {
                                      setSelectedProductId(product.id);
                                      setProductPopoverOpen(false);
                                    }}
                                    className="cursor-pointer"
                                  >
                                    <span className="flex-1">{product.name}</span>
                                    <span className="text-xs text-muted-foreground">({product.unit_of_measure})</span>
                                  </CommandItem>
                                ))}
                            </CommandGroup>
                          )}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <Input
                    type="number"
                    min={0.01}
                    step={0.01}
                    value={quantityToAdd}
                    onChange={(e) => setQuantityToAdd(parseFloat(e.target.value) || 1)}
                    className="w-24"
                    placeholder="Qtd"
                  />
                  <Button 
                    type="button" 
                    onClick={handleAddProduct} 
                    disabled={!selectedProductId || isAdding}
                    size="icon"
                  >
                    {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  </Button>
                </div>

                {/* Product List */}
                {isLoadingProducts ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : serviceProducts.length === 0 ? (
                  <p className="text-center text-muted-foreground py-4">
                    Nenhum produto vinculado a este serviço
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Produto</TableHead>
                        <TableHead className="text-right">Qtd/Uso</TableHead>
                        <TableHead className="text-right">Custo</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {serviceProducts.map((sp) => {
                        const product = sp.product;
                        if (!product) return null;
                        const unitCost = Number(product.cost_price) / Number(product.unit_quantity);
                        const itemCost = unitCost * Number(sp.quantity_per_use);
                        return (
                          <TableRow key={sp.id}>
                            <TableCell>
                              <div>
                                <p className="font-medium">{product.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {formatCurrency(unitCost)}/{product.unit_of_measure}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                min={0.01}
                                step={0.01}
                                value={sp.quantity_per_use}
                                onChange={(e) => updateQuantity({ id: sp.id, quantity_per_use: parseFloat(e.target.value) || 1 })}
                                className="w-20 text-right inline-block"
                              />
                              <span className="ml-1 text-muted-foreground text-sm">
                                {getUnitLabel(product.unit_of_measure)}
                              </span>
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {formatCurrency(itemCost)}
                            </TableCell>
                            <TableCell>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => removeProduct(sp.id)}
                                disabled={isRemoving}
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}

                {/* Total */}
                {serviceProducts.length > 0 && (
                  <div className="rounded-lg bg-muted p-3 space-y-2">
                    <div className="flex justify-between font-medium">
                      <span>Custo Total de Produtos:</span>
                      <span className="text-destructive">{formatCurrency(totalProductCost)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>Valor do Serviço:</span>
                      <span>{formatCurrency(formData.price)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Lucro Bruto:</span>
                      <span className={formData.price - totalProductCost >= 0 ? "text-green-600" : "text-destructive"}>
                        {formatCurrency(formData.price - totalProductCost)}
                      </span>
                    </div>
                  </div>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
