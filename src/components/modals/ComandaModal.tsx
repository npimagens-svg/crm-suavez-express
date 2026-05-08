// @ts-nocheck
import React, { useState, useEffect, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Loader2, Receipt, CheckCircle, Calendar, Eye, Pencil, Trash2, 
  Printer, Clock, Plus, Minus, CreditCard, Banknote, Smartphone, X, Wallet, RefreshCw, Package, Gift, AlertTriangle
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { format, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useComandaItems, useComandas, ComandaItem, Comanda } from "@/hooks/useComandas";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { sendEmail } from "@/lib/sendEmail";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { ServiceSearchSelect } from "@/components/shared/ServiceSearchSelect";
import { CaixaSelectModal } from "@/components/caixa/CaixaSelectModal";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Caixa } from "@/hooks/useCaixas";
import { useAllServiceProducts } from "@/hooks/useServiceProducts";
import { useStockMovements } from "@/hooks/useStockMovements";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { useCardBrands, getCardFeePercent } from "@/hooks/useCardBrands";
import { useCommissionSettings } from "@/hooks/useCommissionSettings";
import { useCurrentUserPermissions } from "@/hooks/useCurrentUserPermissions";
import { ComandaServiceProducts } from "@/components/comanda/ComandaServiceProducts";
import { useClientNetBalance } from "@/hooks/useClientBalance";

interface ComandaModalProps {
  comanda: Comanda | null;
  open: boolean;
  onClose: () => void;
  professionals: any[];
  services: any[];
  isEditingClosed?: boolean;
  userCaixaId?: string | null;
  onDelete?: (comanda: Comanda) => void;
  openCaixas?: Caixa[];
  onViewClient?: (clientId: string) => void;
}

interface EditableItem extends ComandaItem {
  isEditing?: boolean;
  editQuantity?: number;
  editUnitPrice?: number;
  editDiscount?: number;
  editProfessionalId?: string | null;
  editServiceId?: string | null;
  editDescription?: string | null;
  isProductsExpanded?: boolean;
}

interface ProductUsage {
  id: string;
  product_id: string;
  product_name: string;
  quantity_units: number;
  quantity_fractional: number;
  unit_of_measure: string;
  unit_quantity: number;
  cost_per_unit: number;
  total_cost: number;
  isNew?: boolean;
}

interface Payment {
  id: string;
  method: string;
  amount: number;
  info?: string;
  bankAccountId?: string | null;
  cardBrandId?: string | null;
  installments?: number;
}

const PAYMENT_METHODS = [
  { value: "cash", label: "Dinheiro", icon: Banknote },
  { value: "pix", label: "PIX", icon: Smartphone },
  { value: "debit_card", label: "Cartão de Débito", icon: CreditCard },
  { value: "credit_card", label: "Cartão de Crédito", icon: CreditCard },
  { value: "other", label: "Outro", icon: Receipt },
];

const INSTALLMENT_OPTIONS = [
  { value: 1, label: "À vista" },
  { value: 2, label: "2x" }, { value: 3, label: "3x" }, { value: 4, label: "4x" },
  { value: 5, label: "5x" }, { value: 6, label: "6x" }, { value: 7, label: "7x" },
  { value: 8, label: "8x" }, { value: 9, label: "9x" }, { value: 10, label: "10x" },
  { value: 11, label: "11x" }, { value: 12, label: "12x" }, { value: 13, label: "13x" },
  { value: 14, label: "14x" }, { value: 15, label: "15x" }, { value: 16, label: "16x" },
  { value: 17, label: "17x" }, { value: 18, label: "18x" },
];

export function ComandaModal({ comanda, open, onClose, professionals, services, isEditingClosed = false, userCaixaId, onDelete, openCaixas = [], onViewClient }: ComandaModalProps) {
  const { toast } = useToast();
  const { salonId } = useAuth();
  const { hasPermission, professionalId: currentProfessionalId, isMaster } = useCurrentUserPermissions();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("itens");
  const { items, isLoading, addItem, removeItem, isAdding, isRemoving } = useComandaItems(comanda?.id || null);
  const { reopenComanda, isReopening } = useComandas();
  const { calculateServiceCost } = useAllServiceProducts();
  const { deductStockForServices } = useStockMovements();
  const { bankAccounts } = useBankAccounts();
  const { cardBrands } = useCardBrands();
  const { settings: commissionSettings } = useCommissionSettings();
  const { netBalance: clientNetBalance, isLoading: isLoadingBalance } = useClientNetBalance(comanda?.client_id || null);

  const [editableItems, setEditableItems] = useState<EditableItem[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [isClosing, setIsClosing] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [selectedCaixaId, setSelectedCaixaId] = useState<string | null>(null);
  const [caixaSelectModalOpen, setCaixaSelectModalOpen] = useState(false);
  const [serviceProductUsages, setServiceProductUsages] = useState<Record<string, ProductUsage[]>>({});
  const [saveOverpaymentAsCredit, setSaveOverpaymentAsCredit] = useState(false);
  const [saveUnderpaymentAsDebt, setSaveUnderpaymentAsDebt] = useState(false);
  // Cashback: opt-in (default false) — profissional decide quando dar
  const [enableCashback, setEnableCashback] = useState(false);
  // Cashback config carregada do system_config
  const [cashbackConfig, setCashbackConfig] = useState({
    enabled: true,
    percent: "3",
    validityDays: 15,
    minPurchase: 100,
  });
  // % digitada pelo profissional na hora do fechamento (default = config.percent)
  const [cashbackPercentInput, setCashbackPercentInput] = useState("3");
  // Creditos disponiveis do cliente (cashback acumulado de comandas anteriores)
  const [availableCredits, setAvailableCredits] = useState<Array<{
    id: string;
    credit_amount: number;
    expires_at: string;
    min_purchase_amount: number;
  }>>([]);
  // Creditos selecionados pra aplicar nesta comanda
  const [appliedCreditIds, setAppliedCreditIds] = useState<string[]>([]);
  const [packagePopoverOpen, setPackagePopoverOpen] = useState(false);
  const [availablePackages, setAvailablePackages] = useState<any[]>([]);
  const [isLoadingPackages, setIsLoadingPackages] = useState(false);
  const [productPopoverOpen, setProductPopoverOpen] = useState(false);
  const [availableProducts, setAvailableProducts] = useState<any[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [productSearch, setProductSearch] = useState("");

  // Load packages when popover opens
  const loadPackages = async () => {
    if (!salonId) return;
    setIsLoadingPackages(true);
    const { data } = await supabase
      .from("packages")
      .select("*, package_items(*, service:services(id, name, price))")
      .eq("salon_id", salonId)
      .eq("is_active", true)
      .order("name");
    setAvailablePackages(data || []);
    setIsLoadingPackages(false);
  };

  const handleAddPackage = async (pkg: any) => {
    if (!comanda?.id || !salonId) return;
    setPackagePopoverOpen(false);

    try {
      // 1. Create client_package record
      if (comanda.client_id) {
        await supabase.from("client_packages").insert({
          salon_id: salonId,
          client_id: comanda.client_id,
          package_id: pkg.id,
          total_paid: Number(pkg.price),
          status: "active",
          notes: `Vendido via comanda #${comandaRef}`,
        });
      }

      // 2. Add package as item in comanda — use comanda's professional so commission is attributed
      await addItem({
        comanda_id: comanda.id,
        service_id: null,
        product_id: null,
        professional_id: comanda.professional_id || null,
        description: `📦 Pacote: ${pkg.name}`,
        item_type: "package",
        quantity: 1,
        unit_price: Number(pkg.price),
        total_price: Number(pkg.price),
        product_cost: 0,
      });

      toast({ title: `Pacote "${pkg.name}" adicionado!` });
      queryClient.invalidateQueries({ queryKey: ["client_packages"] });
    } catch (e: any) {
      toast({ title: "Erro ao adicionar pacote", description: e.message, variant: "destructive" });
    }
  };

  // Load products for sale when popover opens
  const loadProducts = async () => {
    if (!salonId) return;
    setIsLoadingProducts(true);
    const { data } = await supabase
      .from("products")
      .select("*")
      .eq("salon_id", salonId)
      .eq("is_active", true)
      .gt("current_stock", 0)
      .order("name");
    setAvailableProducts(data || []);
    setIsLoadingProducts(false);
  };

  const handleAddProduct = async (product: any) => {
    if (!comanda?.id || !salonId) return;
    setProductPopoverOpen(false);
    setProductSearch("");

    try {
      // 1. Add product as item in comanda
      await addItem({
        comanda_id: comanda.id,
        service_id: null,
        product_id: product.id,
        professional_id: null,
        description: product.name,
        item_type: "product",
        quantity: 1,
        unit_price: Number(product.sale_price),
        total_price: Number(product.sale_price),
        product_cost: Number(product.cost_price) || 0,
      });

      // 2. Deduct from stock
      await supabase
        .from("products")
        .update({ current_stock: product.current_stock - 1 })
        .eq("id", product.id);

      // 3. Register stock movement
      await supabase.from("stock_movements").insert({
        salon_id: salonId,
        product_id: product.id,
        movement_type: "exit",
        quantity: 1,
        previous_stock: product.current_stock,
        new_stock: product.current_stock - 1,
        notes: `Venda comanda #${comandaRef}`,
      });

      toast({ title: `Produto "${product.name}" adicionado!` });
      queryClient.invalidateQueries({ queryKey: ["products", salonId] });
    } catch (e: any) {
      toast({ title: "Erro ao adicionar produto", description: e.message, variant: "destructive" });
    }
  };

  // Determine if comanda is from today (comandaDate is editable by master)
  const [comandaDateOverride, setComandaDateOverride] = useState<Date | null>(null);
  const comandaDate = comandaDateOverride || (comanda ? new Date(comanda.created_at) : new Date());
  const today = new Date();
  const isFromToday = isSameDay(comandaDate, today);

  // Reset override when comanda changes
  useEffect(() => {
    setComandaDateOverride(null);
  }, [comanda?.id]);

  // Load cashback config (enabled, percent, validity_days, min_purchase) when modal opens
  useEffect(() => {
    if (!open) return;
    supabase
      .from("system_config")
      .select("key, value")
      .in("key", ["cashback_enabled", "cashback_percent", "cashback_validity_days", "cashback_min_purchase"])
      .then(({ data }) => {
        if (!data) return;
        const cfg = { enabled: true, percent: "3", validityDays: 15, minPurchase: 100 };
        for (const row of data) {
          if (row.key === "cashback_enabled") cfg.enabled = row.value !== "false";
          else if (row.key === "cashback_percent" && row.value) cfg.percent = row.value;
          else if (row.key === "cashback_validity_days" && row.value) cfg.validityDays = parseInt(row.value) || 15;
          else if (row.key === "cashback_min_purchase" && row.value) cfg.minPurchase = parseFloat(row.value) || 100;
        }
        setCashbackConfig(cfg);
        setCashbackPercentInput(cfg.percent);
      });
  }, [open]);

  // Load available credits (cashback ainda nao usado e nao expirado) do cliente
  useEffect(() => {
    if (!open || !comanda?.client_id) {
      setAvailableCredits([]);
      setAppliedCreditIds([]);
      return;
    }
    const nowIso = new Date().toISOString();
    supabase
      .from("client_credits")
      .select("id, credit_amount, expires_at, min_purchase_amount")
      .eq("client_id", comanda.client_id)
      .eq("is_used", false)
      .eq("is_expired", false)
      .gt("expires_at", nowIso)
      .order("expires_at", { ascending: true })
      .then(({ data }) => {
        setAvailableCredits((data as any) || []);
      });
  }, [open, comanda?.client_id]);

  // Check if comanda's caixa is closed (locked state)
  const comandaCaixa = comanda?.caixa_id ? openCaixas.find(c => c.id === comanda.caixa_id) : null;
  const isCaixaClosed = comanda?.caixa_id ? !comandaCaixa : false;
  // Comanda is locked if closed — any edit requires reopening first
  const isComandaLocked = !!comanda?.closed_at;

  // Check if user can close this comanda (own comanda or has permission to close others)
  const isOwnComanda = !comanda?.professional_id || comanda.professional_id === currentProfessionalId;
  const canCloseOthers = hasPermission("comandas.view_others");
  const canFinalizeComanda = isMaster || isOwnComanda || canCloseOthers;

  // Get available caixas - users with permission see all, others see only their own
  const canViewAllCaixas = isMaster || hasPermission("caixas.view_others");
  const availableCaixas = openCaixas.filter(c => {
    if (c.closed_at) return false;
    if (canViewAllCaixas) return true;
    // Normal users: only their own caixa on the same day
    const caixaDate = new Date(c.opened_at);
    return isSameDay(caixaDate, comandaDate);
  });

  // Set initial caixa - prefer user's caixa if from today, otherwise require selection
  useEffect(() => {
    if (isFromToday && userCaixaId) {
      setSelectedCaixaId(userCaixaId);
    } else if (availableCaixas.length === 1) {
      setSelectedCaixaId(availableCaixas[0].id);
    } else {
      setSelectedCaixaId(null);
    }
  }, [isFromToday, userCaixaId, availableCaixas.length]);

  // Get selected caixa info
  const selectedCaixa = openCaixas.find(c => c.id === selectedCaixaId);

  // Sync items to editable state (preserve expansion state)
  useEffect(() => {
    if (items) {
      setEditableItems(prev => {
        const expandedMap = new Map(prev.map(i => [i.id, i.isProductsExpanded]));
        const costMap = new Map(prev.map(i => [i.id, i.product_cost]));
        return items.map(item => ({
          ...item,
          product_cost: costMap.get(item.id) ?? item.product_cost,
          isEditing: false,
          editQuantity: item.quantity,
          editUnitPrice: item.unit_price,
          editDiscount: 0,
          editProfessionalId: (item as any).professional_id || comanda?.professional_id || null,
          isProductsExpanded: expandedMap.get(item.id) || false,
        }));
      });
    }
  }, [items, comanda?.professional_id]);

  // Ref to access latest items without recreating callback
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Handler for product usage changes in service items — persists product_cost + individual products to DB
  const handleProductUsageChange = useCallback(async (serviceId: string, products: ProductUsage[]) => {
    setServiceProductUsages(prev => ({
      ...prev,
      [serviceId]: products,
    }));

    const totalCost = products.reduce((sum, p) => sum + p.total_cost, 0);
    const item = itemsRef.current.find(i => i.service_id === serviceId);
    if (!item) return;

    // Update product_cost in the database
    await supabase
      .from("comanda_items")
      .update({ product_cost: totalCost })
      .eq("id", item.id);

    // Persist individual product rows: delete old + insert new
    await supabase.from("comanda_item_products").delete().eq("comanda_item_id", item.id);
    if (products.length > 0) {
      await supabase.from("comanda_item_products").insert(
        products.map(p => ({
          comanda_item_id: item.id,
          product_id: p.product_id,
          product_name: p.product_name,
          quantity_units: p.quantity_units,
          quantity_fractional: p.quantity_fractional,
          unit_of_measure: p.unit_of_measure,
          unit_quantity: p.unit_quantity,
          cost_per_unit: p.cost_per_unit,
          total_cost: p.total_cost,
        }))
      );
    }

    // Update local state without triggering full sync
    setEditableItems(prev => prev.map(i =>
      i.id === item.id ? { ...i, product_cost: totalCost } : i
    ));
  }, []);

  // Toggle product section expansion for an item
  const toggleProductsExpanded = (itemId: string) => {
    setEditableItems(prev => prev.map(item => 
      item.id === itemId ? { ...item, isProductsExpanded: !item.isProductsExpanded } : item
    ));
  };

  // Load existing payments
  useEffect(() => {
    if (comanda?.id) {
      loadPayments();
    }
  }, [comanda?.id]);

  const loadPayments = async () => {
    if (!comanda?.id) return;
    const { data } = await supabase
      .from("payments")
      .select("*")
      .eq("comanda_id", comanda.id);
    if (data) {
      setPayments(data.map(p => ({
        id: p.id,
        method: p.payment_method,
        amount: Number(p.amount),
        info: p.notes || "",
        bankAccountId: p.bank_account_id || null,
        cardBrandId: p.card_brand_id || null,
        installments: p.installments || 1,
      })));
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
  };

  const getComandaNumber = () => {
    if (!comanda) return "";
    return comanda.comanda_number ? String(comanda.comanda_number).padStart(4, "0") : comandaRef;
  };
  const comandaRef = getComandaNumber();

  const handleAddService = async (serviceId: string) => {
    if (!comanda || !salonId) return;
    const service = services.find((s: any) => s.id === serviceId);
    if (!service) return;

    // Calculate product cost for this service
    const productCost = calculateServiceCost(serviceId);

    // Check if client has an active package with credits for this service
    let usedPackageCredit = false;
    let packageLabel = "";
    if (comanda.client_id) {
      try {
        // Step 1: Get active client packages
        const { data: clientPackages } = await supabase
          .from("client_packages")
          .select("id, package_id")
          .eq("client_id", comanda.client_id)
          .eq("salon_id", salonId)
          .eq("status", "active");

        if (clientPackages && clientPackages.length > 0) {
          for (const cp of clientPackages) {
            // Step 2: Get package name
            const { data: pkg } = await supabase
              .from("packages")
              .select("name")
              .eq("id", cp.package_id)
              .single();

            // Step 3: Check if this package contains the service
            const { data: pkgItem } = await supabase
              .from("package_items")
              .select("quantity")
              .eq("package_id", cp.package_id)
              .eq("service_id", serviceId)
              .maybeSingle();

            if (!pkgItem) continue;
            const totalCredits = pkgItem.quantity;

            // Step 4: Count existing usage
            const { count: usageCount } = await supabase
              .from("client_package_usage")
              .select("id", { count: "exact", head: true })
              .eq("client_package_id", cp.id)
              .eq("service_id", serviceId);

            const used = usageCount || 0;
            if (used < totalCredits) {
              // Has remaining credits — register usage
              await supabase.from("client_package_usage").insert({
                client_package_id: cp.id,
                service_id: serviceId,
                comanda_id: comanda.id,
                professional_id: comanda.professional_id || null,
                notes: `Uso automático via comanda #${comandaRef}`,
              });

              const pkgName = pkg?.name || "Pacote";
              packageLabel = `📦 ${pkgName} (${used + 1}/${totalCredits})`;
              usedPackageCredit = true;
              break;
            }
          }
        }
      } catch (e) {
        console.error("Erro ao verificar pacotes do cliente:", e);
      }
    }

    const finalPrice = usedPackageCredit ? 0 : Number(service.price);
    const description = usedPackageCredit ? `${service.name} — ${packageLabel}` : service.name;

    // Add item to comanda with product cost and professional
    addItem({
      comanda_id: comanda.id,
      service_id: serviceId,
      professional_id: comanda.professional_id || null,
      description: description,
      item_type: "service",
      quantity: 1,
      unit_price: finalPrice,
      total_price: finalPrice,
      product_cost: productCost,
    });

    if (usedPackageCredit) {
      toast({ title: "Crédito de pacote utilizado", description: packageLabel });
    }

    // Create appointment for this service if comanda has a professional
    const professionalId = comanda.professional_id;
    if (professionalId) {
      try {
        // Schedule for current time today
        const now = new Date();
        
        const { error } = await supabase
          .from("appointments")
          .insert({
            salon_id: salonId,
            client_id: comanda.client_id,
            professional_id: professionalId,
            service_id: serviceId,
            scheduled_at: now.toISOString(),
            duration_minutes: service.duration_minutes || 30,
            price: finalPrice,
            status: "in_progress",
            notes: usedPackageCredit
              ? `Criado via comanda ${comandaRef} — ${packageLabel}`
              : `Criado via comanda ${comandaRef}`,
          });

        if (error) {
          console.error("Error creating appointment:", error);
        } else {
          queryClient.invalidateQueries({ queryKey: ["appointments", salonId] });
        }
      } catch (error) {
        console.error("Error creating appointment:", error);
      }
    }
  };

  const toggleEditItem = (itemId: string) => {
    setEditableItems(prev => prev.map(item => 
      item.id === itemId ? { ...item, isEditing: !item.isEditing } : item
    ));
  };

  const updateItemProfessional = async (itemId: string, professionalId: string) => {
    // Update local state immediately
    setEditableItems(prev => prev.map(item => 
      item.id === itemId ? { ...item, editProfessionalId: professionalId, professional_id: professionalId } : item
    ));

    // Save to database
    const { error } = await supabase
      .from("comanda_items")
      .update({ professional_id: professionalId })
      .eq("id", itemId);

    if (error) {
      toast({ title: "Erro ao atualizar profissional", variant: "destructive" });
      return;
    }

    // Record in client history
    if (comanda?.client_id && salonId) {
      const user = (await supabase.auth.getUser()).data.user;
      const professional = professionals.find(p => p.id === professionalId);
      const item = editableItems.find(i => i.id === itemId);
      if (user && professional && item) {
        await supabase.from("client_history").insert({
          client_id: comanda.client_id,
          salon_id: salonId,
          action_type: "professional_change",
          description: `Profissional alterado para "${professional.name}" no serviço "${item.description}"`,
          new_value: { professional_id: professionalId, professional_name: professional.name },
          performed_by: user.id,
        });
      }
    }

    queryClient.invalidateQueries({ queryKey: ["comanda_items", comanda?.id] });
    toast({ title: "Profissional atualizado!" });
  };

  const updateItemField = (itemId: string, field: string, value: number) => {
    setEditableItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      const updated = { ...item, [field]: value };
      // Recalculate total
      const quantity = field === 'editQuantity' ? value : item.editQuantity || item.quantity;
      const unitPrice = field === 'editUnitPrice' ? value : item.editUnitPrice || item.unit_price;
      const discount = field === 'editDiscount' ? value : item.editDiscount || 0;
      updated.total_price = (quantity * unitPrice) * (1 - discount / 100);
      return updated;
    }));
  };

  const saveItemChanges = async (item: EditableItem) => {
    const newQuantity = item.editQuantity || item.quantity;
    const newUnitPrice = item.editUnitPrice || item.unit_price;
    const discount = item.editDiscount || 0;
    const newTotalPrice = (newQuantity * newUnitPrice) * (1 - discount / 100);

    const oldValues = {
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: item.total_price,
    };

    const updateData: any = {
      quantity: newQuantity,
      unit_price: newUnitPrice,
      total_price: newTotalPrice,
    };
    // Update service if changed
    if (item.editServiceId && item.editServiceId !== item.service_id) {
      updateData.service_id = item.editServiceId;
      updateData.description = item.editDescription || item.description;
    }

    const { error } = await supabase
      .from("comanda_items")
      .update(updateData)
      .eq("id", item.id);

    if (error) {
      toast({ title: "Erro ao atualizar item", variant: "destructive" });
      return;
    }

    // Record change in client history if editing closed comanda
    if (isEditingClosed && comanda?.client_id && salonId) {
      const user = (await supabase.auth.getUser()).data.user;
      if (user) {
        await supabase.from("client_history").insert({
          client_id: comanda.client_id,
          salon_id: salonId,
          action_type: "comanda_edit",
          description: `Item "${item.description}" editado na comanda ${comandaRef}`,
          old_value: oldValues,
          new_value: { quantity: newQuantity, unit_price: newUnitPrice, total_price: newTotalPrice },
          performed_by: user.id,
        });
      }
    }

    // Update comanda totals
    await updateComandaTotals();
    toggleEditItem(item.id);
    toast({ title: "Item atualizado!" });
  };

  const updateComandaTotals = async () => {
    if (!comanda) return;
    const newSubtotal = editableItems.reduce((acc, item) => acc + Number(item.total_price), 0);
    await supabase
      .from("comandas")
      .update({
        subtotal: newSubtotal,
        total: newSubtotal - (comanda.discount || 0),
      })
      .eq("id", comanda.id);
    queryClient.invalidateQueries({ queryKey: ["comandas", salonId] });
    queryClient.invalidateQueries({ queryKey: ["comanda_items", comanda.id] });
  };

  // Sync comanda with appointments from agenda
  const handleSyncComanda = async () => {
    if (!comanda || !salonId) return;
    
    setIsUpdating(true);
    try {
      // Get the comanda's original date range (start to end of that day)
      const comandaDate = new Date(comanda.created_at);
      const startOfDay = new Date(comandaDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(comandaDate);
      endOfDay.setHours(23, 59, 59, 999);

      // Fetch all appointments for this client on the comanda's date
      const { data: appointments, error: appointmentsError } = await supabase
        .from("appointments")
        .select(`
          *,
          services(name, price, duration_minutes)
        `)
        .eq("salon_id", salonId)
        .eq("client_id", comanda.client_id)
        .gte("scheduled_at", startOfDay.toISOString())
        .lte("scheduled_at", endOfDay.toISOString())
        .neq("status", "cancelled");

      if (appointmentsError) throw appointmentsError;

      // Get current comanda items (including source_appointment_id for robust matching)
      const { data: currentItems } = await supabase
        .from("comanda_items")
        .select("*")
        .eq("comanda_id", comanda.id);

      // Create a mutable copy to track items added during this sync
      const itemsInComanda = [...(currentItems || [])];

      // Track changes made
      let itemsAdded = 0;
      let itemsUpdated = 0;

      // Check each appointment
      for (const appointment of appointments || []) {
        if (!appointment.service_id || !appointment.services) continue;

        // First try to find by source_appointment_id (robust way)
        let existingItem = itemsInComanda.find(
          item => item.source_appointment_id === appointment.id
        );

        // Fallback: find by service_id + professional_id (for legacy items without source_appointment_id)
        if (!existingItem) {
          existingItem = itemsInComanda.find(
            item => item.service_id === appointment.service_id && 
                    !item.source_appointment_id &&
                    (item.professional_id === appointment.professional_id || !item.professional_id)
          );
        }

        if (existingItem) {
          // Update existing item with appointment data (price, professional, and set source_appointment_id)
          const newPrice = appointment.price ?? appointment.services.price ?? 0;
          const needsSourceUpdate = !existingItem.source_appointment_id;
          const shouldUpdate = existingItem.unit_price !== newPrice || 
                               existingItem.professional_id !== appointment.professional_id ||
                               needsSourceUpdate;
          
          if (shouldUpdate) {
            await supabase
              .from("comanda_items")
              .update({
                unit_price: newPrice,
                total_price: newPrice * existingItem.quantity,
                professional_id: appointment.professional_id,
                source_appointment_id: appointment.id,
              })
              .eq("id", existingItem.id);
            
            // Update local reference to prevent re-matching
            existingItem.source_appointment_id = appointment.id;
            itemsUpdated++;
          }
        } else {
          // Add new item from appointment (only if no matching item found)
          const newItemPrice = appointment.price ?? appointment.services.price ?? 0;
          const { data: insertedItem } = await supabase
            .from("comanda_items")
            .insert({
              comanda_id: comanda.id,
              service_id: appointment.service_id,
              professional_id: appointment.professional_id,
              source_appointment_id: appointment.id,
              description: appointment.services.name,
              item_type: "service",
              quantity: 1,
              unit_price: newItemPrice,
              total_price: newItemPrice,
            })
            .select()
            .single();
          
          // Add to local list to prevent duplicate inserts within this loop
          if (insertedItem) {
            itemsInComanda.push(insertedItem);
          }
          itemsAdded++;
        }
      }

      // Update comanda date to today
      const now = new Date();
      await supabase
        .from("comandas")
        .update({ 
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq("id", comanda.id);

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ["comandas", salonId] });
      queryClient.invalidateQueries({ queryKey: ["comanda_items", comanda.id] });

      const messages = [];
      if (itemsAdded > 0) messages.push(`${itemsAdded} serviço(s) adicionado(s)`);
      if (itemsUpdated > 0) messages.push(`${itemsUpdated} serviço(s) atualizado(s)`);
      messages.push("Data atualizada para hoje");

      toast({ 
        title: "Comanda atualizada!", 
        description: messages.join(". ") 
      });
    } catch (error: any) {
      console.error("Error syncing comanda:", error);
      toast({ 
        title: "Erro ao atualizar comanda", 
        description: error.message, 
        variant: "destructive" 
      });
    } finally {
      setIsUpdating(false);
    }
  };

  // Payment functions
  const addPaymentRow = () => {
    setPayments(prev => [...prev, {
      id: `temp_${Date.now()}`,
      method: "cash",
      amount: 0,
      info: "",
    }]);
  };

  const removePaymentRow = (paymentId: string) => {
    setPayments(prev => prev.filter(p => p.id !== paymentId));
  };

  const updatePayment = (paymentId: string, field: string, value: string | number) => {
    setPayments(prev => prev.map(p => {
      if (p.id !== paymentId) return p;
      const updated = { ...p, [field]: value };
      // Auto-select card brand when switching to card payment and only one brand exists
      if (field === 'method' && (value === 'credit_card' || value === 'debit_card')) {
        const activeBrands = cardBrands.filter(b => b.is_active);
        if (activeBrands.length === 1 && !updated.cardBrandId) {
          updated.cardBrandId = activeBrands[0].id;
        }
      }
      return updated;
    }));
  };

  const subtotal = editableItems.reduce((acc, item) => acc + Number(item.total_price), 0);
  const totalPayments = payments.reduce((acc, p) => acc + p.amount, 0);
  // Total efetivo a cobrar — abate o discount da comanda (cashback aplicado, etc)
  const totalACobrar = Math.max(0, subtotal - Number(comanda?.discount || 0));
  const difference = totalACobrar - totalPayments;

  const handlePrintReceipt = () => {
    if (!comanda) return;
    const comandaNumber = comandaRef;
    const dateStr = comanda.created_at
      ? format(new Date(comanda.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })
      : "";
    const clientName = comanda.client?.name || "Cliente não informado";
    const professionalName = comanda.professional?.name || "Profissional não informado";

    const methodLabel = (m: string) => {
      const found = PAYMENT_METHODS.find(pm => pm.value === m);
      return found ? found.label : m;
    };

    const fmtCurr = (v: number) =>
      new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

    const itemsHtml = editableItems
      .map(
        (item) =>
          `<tr>
            <td style="text-align:left;padding:2px 0;">${item.description}</td>
            <td style="text-align:center;padding:2px 4px;">${item.quantity}</td>
            <td style="text-align:right;padding:2px 0;">${fmtCurr(item.unit_price)}</td>
            <td style="text-align:right;padding:2px 0;">${fmtCurr(item.total_price)}</td>
          </tr>`
      )
      .join("");

    const paymentsHtml = payments
      .map(
        (p) =>
          `<tr>
            <td style="text-align:left;padding:2px 0;">${methodLabel(p.method)}</td>
            <td style="text-align:right;padding:2px 0;">${fmtCurr(p.amount)}</td>
          </tr>`
      )
      .join("");

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>Recibo #${comandaNumber}</title>
<style>
  @page { size: 80mm auto; margin: 2mm; }
  body { font-family: 'Courier New', monospace; font-size: 12px; width: 280px; margin: 0 auto; padding: 8px; }
  h2 { text-align: center; margin: 0 0 4px; font-size: 14px; }
  .divider { border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  .info { font-size: 11px; }
  .total-row td { font-weight: bold; padding-top: 4px; }
  .footer { text-align: center; margin-top: 10px; font-size: 11px; }
</style></head><body>
  <h2>Recibo</h2>
  <div class="divider"></div>
  <div class="info">
    <div><strong>Comanda:</strong> #${comandaNumber}</div>
    <div><strong>Data:</strong> ${dateStr}</div>
    <div><strong>Cliente:</strong> ${clientName}</div>
    <div><strong>Profissional:</strong> ${professionalName}</div>
  </div>
  <div class="divider"></div>
  <table>
    <thead><tr>
      <th style="text-align:left;">Item</th>
      <th style="text-align:center;">Qtd</th>
      <th style="text-align:right;">Unit.</th>
      <th style="text-align:right;">Total</th>
    </tr></thead>
    <tbody>${itemsHtml}</tbody>
  </table>
  <div class="divider"></div>
  <table>
    <tr class="total-row">
      <td style="text-align:left;">Subtotal</td>
      <td style="text-align:right;">${fmtCurr(subtotal)}</td>
    </tr>
  </table>
  ${payments.length > 0 ? `
  <div class="divider"></div>
  <table>
    <thead><tr>
      <th style="text-align:left;">Pagamento</th>
      <th style="text-align:right;">Valor</th>
    </tr></thead>
    <tbody>${paymentsHtml}</tbody>
  </table>
  <div class="divider"></div>
  <table>
    <tr class="total-row">
      <td style="text-align:left;">Total Pago</td>
      <td style="text-align:right;">${fmtCurr(totalPayments)}</td>
    </tr>
  </table>` : ""}
  <div class="divider"></div>
  <div class="footer">Obrigado pela preferência!</div>
</body></html>`;

    const printWindow = window.open("", "_blank", "width=350,height=600");
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    }
  };

  const handleReopenComanda = async () => {
    if (!comanda) return;

    try {
      if (comanda.caixa_id) {
        // Check if the linked caixa is open — if so, subtract values from it
        const linkedCaixa = openCaixas.find(c => c.id === comanda.caixa_id && !c.closed_at);
        if (linkedCaixa) {
          await reopenComanda({ comandaId: comanda.id, caixaId: comanda.caixa_id });
        } else {
          // Caixa already closed — just reopen the comanda without adjusting caixa values
          const { error } = await supabase
            .from("comandas")
            .update({ closed_at: null, is_paid: false, caixa_id: null })
            .eq("id", comanda.id);
          if (error) throw error;

          queryClient.invalidateQueries({ queryKey: ["comandas"] });
          // Reload payments so they appear in the reopened comanda
          loadPayments();
          toast({ title: "Comanda reaberta com sucesso!", description: "O caixa original já estava fechado. Pagamentos mantidos. Ao finalizar, vincule a um caixa aberto." });
        }
      } else {
        // No caixa linked — just reopen
        const { error } = await supabase
          .from("comandas")
          .update({ closed_at: null, is_paid: false })
          .eq("id", comanda.id);
        if (error) throw error;

        queryClient.invalidateQueries({ queryKey: ["comandas"] });
        toast({ title: "Comanda reaberta com sucesso!" });
      }

      queryClient.invalidateQueries({ queryKey: ["comanda_items", comanda.id] });
      onClose();
    } catch (err: any) {
      toast({ title: "Erro ao reabrir comanda", description: err?.message || "Tente novamente.", variant: "destructive" });
    }
  };

  const handleFinalizeComanda = async () => {
    if (!comanda || !salonId) return;

    // Determine which caixa to use
    const caixaToUse = selectedCaixaId;
    
    // Validate caixa is selected
    if (!caixaToUse) {
      // Show caixa selection modal if there are available caixas
      if (availableCaixas.length > 0) {
        toast({ 
          title: "Selecione um caixa", 
          description: "Escolha um caixa aberto para finalizar esta comanda.",
          variant: "destructive" 
        });
        setCaixaSelectModalOpen(true);
        return;
      } else {
        toast({ 
          title: "Nenhum caixa disponível", 
          description: `Não há caixas abertos para a data ${format(comandaDate, "dd/MM/yyyy")}. Contate um gerente.`,
          variant: "destructive" 
        });
        return;
      }
    }

    // Validate caixa date matches comanda date
    const selectedCaixaObj = openCaixas.find(c => c.id === caixaToUse);
    if (selectedCaixaObj && !isSameDay(new Date(selectedCaixaObj.opened_at), comandaDate)) {
      const caixaDateStr = format(new Date(selectedCaixaObj.opened_at), "dd/MM/yyyy");
      const comandaDateStr = format(comandaDate, "dd/MM/yyyy");
      toast({
        title: "Data do caixa não corresponde",
        description: `A comanda é do dia ${comandaDateStr}, mas o caixa selecionado é do dia ${caixaDateStr}. Selecione ou abra um caixa do mesmo dia.`,
        variant: "destructive",
      });
      setActiveTab("pagamento");
      return;
    }

    // Validate card payments have brand selected
    const cardWithoutBrand = payments.find(
      p => (p.method === 'credit_card' || p.method === 'debit_card') && !p.cardBrandId && p.amount > 0
    );
    if (cardWithoutBrand) {
      toast({
        title: "Bandeira não selecionada",
        description: "Selecione a bandeira do cartão para calcular a taxa da maquininha.",
        variant: "destructive",
      });
      setActiveTab("pagamento");
      return;
    }

    // Validate payments
    if (difference > 0.01 && !saveUnderpaymentAsDebt) {
      toast({ 
        title: "Pagamento incompleto", 
        description: `Falta pagar ${formatCurrency(difference)}. Marque a opção de salvar como dívida ou ajuste o valor.`,
        variant: "destructive" 
      });
      setActiveTab("pagamento");
      return;
    }

    if (difference < -0.01 && !saveOverpaymentAsCredit) {
      toast({ 
        title: "Pagamento excede o total", 
        description: `Marque a opção de salvar ${formatCurrency(Math.abs(difference))} como crédito do cliente ou ajuste o valor.`,
        variant: "destructive" 
      });
      setActiveTab("pagamento");
      return;
    }

    setIsClosing(true);

    try {
      // Calculate payment totals by method for caixa update
      const paymentTotals = {
        cash: 0,
        pix: 0,
        credit_card: 0,
        debit_card: 0,
        other: 0,
      };

      // Save new payments and track totals
      for (const payment of payments) {
        if (payment.id.startsWith("temp_")) {
          // Calculate fee for payments (card, PIX)
          let feeAmount = 0;
          let netAmount = payment.amount;

          if ((payment.method === 'credit_card' || payment.method === 'debit_card') && payment.cardBrandId) {
            const brand = cardBrands.find(b => b.id === payment.cardBrandId);
            if (brand) {
              const feePercent = getCardFeePercent(brand, payment.method as 'credit_card' | 'debit_card', payment.installments || 1);
              feeAmount = payment.amount * (feePercent / 100);
              netAmount = payment.amount - feeAmount;
            }
          } else if (payment.method === 'pix' && commissionSettings.pix_fee_percent > 0) {
            feeAmount = payment.amount * (commissionSettings.pix_fee_percent / 100);
            netAmount = payment.amount - feeAmount;
          }

          await supabase.from("payments").insert({
            comanda_id: comanda.id,
            salon_id: salonId,
            payment_method: payment.method as any,
            amount: payment.amount,
            notes: payment.info,
            bank_account_id: payment.method === 'pix' ? payment.bankAccountId : null,
            card_brand_id: (payment.method === 'credit_card' || payment.method === 'debit_card') ? payment.cardBrandId : null,
            installments: payment.method === 'credit_card' ? (payment.installments || 1) : 1,
            fee_amount: feeAmount,
            net_amount: netAmount,
          });

          // Track totals only for NEW payments to avoid double-counting
          if (payment.method in paymentTotals) {
            paymentTotals[payment.method as keyof typeof paymentTotals] += payment.amount;
          }
        }
      }

      // Update caixa totals
      const { data: currentCaixa } = await supabase
        .from("caixas")
        .select("*")
        .eq("id", caixaToUse)
        .single();

      if (currentCaixa) {
        await supabase
          .from("caixas")
          .update({
            total_cash: (currentCaixa.total_cash || 0) + paymentTotals.cash,
            total_pix: (currentCaixa.total_pix || 0) + paymentTotals.pix,
            total_credit_card: (currentCaixa.total_credit_card || 0) + paymentTotals.credit_card,
            total_debit_card: (currentCaixa.total_debit_card || 0) + paymentTotals.debit_card,
            total_other: (currentCaixa.total_other || 0) + paymentTotals.other,
          })
          .eq("id", caixaToUse);
      }

      // Close comanda and link to caixa
      const { error: closeError } = await supabase
        .from("comandas")
        .update({
          closed_at: new Date().toISOString(),
          is_paid: true,
          subtotal: subtotal,
          total: subtotal,
          caixa_id: caixaToUse,
        })
        .eq("id", comanda.id);

      if (closeError) {
        throw new Error(`Erro ao fechar comanda: ${closeError.message}`);
      }

      // Update linked appointments to "paid" status
      if (comanda.appointment_id) {
        await supabase
          .from("appointments")
          .update({ status: "paid" })
          .eq("id", comanda.appointment_id);
      }
      // Also update appointments linked via comanda_items.source_appointment_id
      const appointmentIds = editableItems
        .map(item => (item as any).source_appointment_id)
        .filter(Boolean);
      if (appointmentIds.length > 0) {
        await supabase
          .from("appointments")
          .update({ status: "paid" })
          .in("id", appointmentIds);
      }

      // Deduct stock for all services in the comanda
      const serviceItems = editableItems
        .filter(item => item.service_id)
        .map(item => ({
          serviceId: item.service_id!,
          quantity: item.quantity,
        }));

      if (serviceItems.length > 0) {
        try {
          const movements = await deductStockForServices(serviceItems);
          if (movements.length > 0) {
            console.log("Estoque deduzido:", movements);
          }
        } catch (stockError) {
          console.error("Erro na baixa de estoque:", stockError);
          // Don't fail the comanda closure, just log the error
        }
      }

      // Generate loyalty credit — opt-in (profissional marca) + % editavel + configs do system_config
      if (enableCashback && cashbackConfig.enabled && comanda.client_id) {
        try {
          const servicesTotal = editableItems
            .filter(item => {
              // Only regular services
              if (item.item_type !== "service") return false;
              // Exclude package credits (price = 0 or description has 📦)
              if ((item.total_price || 0) === 0) return false;
              if (item.description?.includes("📦")) return false;
              // Exclude items with discount applied
              if ((item.editDiscount || 0) > 0) return false;
              // Exclude items where price was manually reduced
              const originalService = services.find((s: any) => s.id === item.service_id);
              if (originalService && item.unit_price < Number(originalService.price)) return false;
              return true;
            })
            .reduce((sum, item) => sum + (item.total_price || 0), 0);

          // % digitada pelo profissional (fallback config padrao)
          const inputPct = parseFloat(cashbackPercentInput);
          const cashbackPercent = (isNaN(inputPct) ? parseFloat(cashbackConfig.percent) : inputPct) / 100;
          const creditAmount = Math.round(servicesTotal * cashbackPercent * 100) / 100;

          // So gera credito se houver servico de preco cheio E % > 0
          if (servicesTotal > 0 && creditAmount > 0) {
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + cashbackConfig.validityDays);
            await supabase.from("client_credits").insert({
              salon_id: salonId,
              client_id: comanda.client_id,
              comanda_id: comanda.id,
              credit_amount: creditAmount,
              min_purchase_amount: cashbackConfig.minPurchase,
              expires_at: expiresAt.toISOString(),
            });

            // Send cashback email if client has email
            if (comanda.client?.name && salonId) {
              const { data: clientData } = await supabase
                .from("clients")
                .select("email")
                .eq("id", comanda.client_id)
                .single();

              if (clientData?.email) {
                sendEmail({
                  type: "cashback",
                  salon_id: salonId,
                  to_email: clientData.email,
                  to_name: comanda.client.name,
                  client_id: comanda.client_id,
                  variables: {
                    credit_amount: creditAmount.toFixed(2),
                    expires_at: `${expiresAt.getDate().toString().padStart(2, "0")}/${(expiresAt.getMonth() + 1).toString().padStart(2, "0")}/${expiresAt.getFullYear()}`,
                  },
                }).catch(() => {});
              }
            }
          }
        } catch (creditError) {
          console.error("Erro ao gerar crédito de fidelidade:", creditError);
        }
      }

      // Save overpayment as client credit
      if (saveOverpaymentAsCredit && difference < -0.01 && comanda.client_id) {
        try {
          const overpayment = Math.abs(difference);
          const expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + 90); // 90 days expiry
          await supabase.from("client_credits").insert({
            salon_id: salonId,
            client_id: comanda.client_id,
            comanda_id: comanda.id,
            credit_amount: Math.round(overpayment * 100) / 100,
            min_purchase_amount: 0,
            expires_at: expiresAt.toISOString(),
          });
        } catch (creditError) {
          console.error("Erro ao salvar crédito de troco:", creditError);
        }
      }

      // Save underpayment as client debt
      if (saveUnderpaymentAsDebt && difference > 0.01 && comanda.client_id) {
        try {
          await supabase.from("client_debts" as any).insert({
            salon_id: salonId,
            client_id: comanda.client_id,
            comanda_id: comanda.id,
            debt_amount: Math.round(difference * 100) / 100,
            notes: `Dívida da comanda ${comandaRef}`,
          });
        } catch (debtError) {
          console.error("Erro ao salvar dívida:", debtError);
        }
      }

      // If client had existing debt and payment covers it, create credit entry to zero out
      if (comanda.client_id && clientNetBalance < 0) {
        const debtAmount = Math.abs(clientNetBalance);
        // If the total payments cover services + debt, record a credit to offset the debt
        if (totalPayments >= subtotal + debtAmount - 0.01) {
          try {
            await supabase.from("client_balance").insert({
              salon_id: salonId,
              client_id: comanda.client_id,
              type: "credit",
              amount: Math.round(debtAmount * 100) / 100,
              description: `Pagamento de divida anterior via comanda ${comandaRef}`,
              comanda_id: comanda.id,
            });
          } catch (balanceError) {
            console.error("Erro ao registrar pagamento de divida:", balanceError);
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ["comandas"] });
      queryClient.invalidateQueries({ queryKey: ["comanda_items", comanda.id] });
      queryClient.invalidateQueries({ queryKey: ["caixas", salonId] });
      queryClient.invalidateQueries({ queryKey: ["products", salonId] });
      queryClient.invalidateQueries({ queryKey: ["client-credits"] });
      queryClient.invalidateQueries({ queryKey: ["client_comandas"] });
      queryClient.invalidateQueries({ queryKey: ["client_balance"] });
      toast({ title: "Comanda finalizada com sucesso!" });
      onClose();
    } catch (error: any) {
      toast({ title: "Erro ao finalizar comanda", description: error.message, variant: "destructive" });
    } finally {
      setIsClosing(false);
    }
  };

  if (!comanda) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[95vw] lg:max-w-6xl max-h-[95vh] overflow-hidden flex flex-col p-0">
        {/* Avec-style Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b bg-background">
          <div className="flex items-center gap-4">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="bg-transparent h-auto p-0 gap-6">
                <TabsTrigger value="itens" className="bg-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-2 text-sm font-medium text-muted-foreground hover:text-foreground">Itens</TabsTrigger>
                <TabsTrigger value="pagamento" className="bg-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-2 text-sm font-medium text-muted-foreground hover:text-foreground">Pagamento</TabsTrigger>
                <TabsTrigger value="prontuario" className="bg-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-2 text-sm font-medium text-muted-foreground hover:text-foreground">Prontuário</TabsTrigger>
                <TabsTrigger value="informacoes" className="bg-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-2 text-sm font-medium text-muted-foreground hover:text-foreground">Informações</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-primary">
              Comanda {getComandaNumber()} - {comanda.client?.name || "Cliente"}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsContent value="itens" className="space-y-4 mt-4">
              {/* Locked Comanda Warning */}
              {isComandaLocked && (
                <div className="flex items-center gap-3 p-3 rounded-md border border-destructive bg-destructive/10">
                  <X className="h-5 w-5 text-destructive shrink-0" />
                  <div>
                    <p className="font-medium text-destructive text-sm">Comanda Bloqueada</p>
                    <p className="text-xs text-muted-foreground">Reabra o caixa para editar.</p>
                  </div>
                </div>
              )}

              {/* Client Info + Date + Number — Avec inline style */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 py-2 border-b">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-muted-foreground">Cliente:</span>
                  <span className="font-medium">{comanda.client?.name || "Não definido"}</span>
                  {onViewClient && comanda.client_id && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onViewClient(comanda.client_id!)} title="Ver cadastro">
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-muted-foreground">Data da Comanda:</span>
                  {isMaster && !comanda.closed_at ? (
                    <Input
                      type="date"
                      className="h-7 w-36 text-sm"
                      value={format(comandaDate, "yyyy-MM-dd")}
                      max={format(today, "yyyy-MM-dd")}
                      onChange={async (e) => {
                        if (!e.target.value || !comanda) return;
                        const newDate = new Date(e.target.value + "T12:00:00");
                        setComandaDateOverride(newDate);
                        await supabase.from("comandas").update({ created_at: newDate.toISOString() }).eq("id", comanda.id);
                        queryClient.invalidateQueries({ queryKey: ["comandas", salonId] });
                      }}
                    />
                  ) : (
                    <span className="text-sm">{format(comandaDate, "dd/MM/yyyy", { locale: ptBR })}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-muted-foreground">Nº:</span>
                  <span className="text-sm font-medium">{getComandaNumber()}</span>
                </div>
                {/* Debt/Credit inline badge */}
                {comanda.client_id && clientNetBalance < 0 && (
                  <Badge variant="destructive" className="text-xs gap-1">
                    <AlertTriangle className="h-3 w-3" /> Divida {formatCurrency(Math.abs(clientNetBalance))}
                  </Badge>
                )}
                {comanda.client_id && clientNetBalance > 0 && (
                  <Badge className="bg-green-600 text-xs gap-1">
                    <Wallet className="h-3 w-3" /> Credito {formatCurrency(clientNetBalance)}
                  </Badge>
                )}
              </div>

              {/* Items Table */}
              <Card>
                <CardContent className="p-0 overflow-x-auto">
                  <Table className="min-w-0">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[120px]">Item</TableHead>
                        <TableHead className="min-w-[100px]">Profissional</TableHead>
                        <TableHead className="text-center w-16">Qtd</TableHead>
                        <TableHead className="text-right w-24">Valor</TableHead>
                        <TableHead className="text-right w-16">Desc%</TableHead>
                        <TableHead className="text-right w-24">Final</TableHead>
                        <TableHead className="w-16"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isLoading ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-4">
                            <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                          </TableCell>
                        </TableRow>
                      ) : editableItems.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                            Nenhum item adicionado
                          </TableCell>
                        </TableRow>
                      ) : (
                        editableItems.map((item) => (
                          <React.Fragment key={item.id}>
                            <TableRow className="border-b-0">
                              <TableCell className="font-medium">
                                {item.isEditing && item.service_id ? (
                                  <Select
                                    value={item.editServiceId || item.service_id || ""}
                                    onValueChange={(value) => {
                                      const svc = services.find(s => s.id === value);
                                      setEditableItems(prev => prev.map(i => {
                                        if (i.id !== item.id) return i;
                                        return {
                                          ...i,
                                          editServiceId: value,
                                          editDescription: svc?.name || i.description,
                                          editUnitPrice: Number(svc?.price) || i.editUnitPrice || i.unit_price,
                                          total_price: ((i.editQuantity || i.quantity) * (Number(svc?.price) || i.editUnitPrice || i.unit_price)) * (1 - (i.editDiscount || 0) / 100),
                                        };
                                      }));
                                    }}
                                  >
                                    <SelectTrigger className="h-8 text-xs min-w-[140px]">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {services.filter(s => s.is_active).map(svc => (
                                        <SelectItem key={svc.id} value={svc.id}>{svc.name}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <span>{item.description?.includes("📦") ? item.description.split(" — ")[0] : item.description}</span>
                                    {item.description?.includes("📦") && (
                                      <Badge variant="secondary" className="text-xs whitespace-nowrap bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">
                                        {item.description.split(" — ")[1]}
                                      </Badge>
                                    )}
                                    {item.service_id && (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 text-muted-foreground hover:text-primary"
                                        onClick={() => toggleProductsExpanded(item.id)}
                                        title="Ver/editar produtos consumidos"
                                      >
                                        <Package className="h-4 w-4" />
                                      </Button>
                                    )}
                                    {item.product_cost > 0 && (
                                      <span className="text-xs text-muted-foreground">
                                        Custo prod.: {formatCurrency(item.product_cost)}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell>
                                <Select 
                                  value={item.editProfessionalId || item.professional_id || comanda.professional_id || ""}
                                  onValueChange={(value) => updateItemProfessional(item.id, value)}
                                >
                                  <SelectTrigger className="w-28 h-8 text-xs">
                                    <SelectValue placeholder="Selecionar" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {professionals.filter(p => p.is_active).map((prof) => (
                                      <SelectItem key={prof.id} value={prof.id}>{prof.name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                {item.isEditing ? (
                                  <Input 
                                    type="number" 
                                    min="1"
                                    className="w-16 h-8 text-center"
                                    value={item.editQuantity}
                                    onChange={(e) => updateItemField(item.id, 'editQuantity', parseInt(e.target.value) || 1)}
                                  />
                                ) : (
                                  <div className="text-center">{item.quantity}</div>
                                )}
                              </TableCell>
                              <TableCell>
                                {item.isEditing ? (
                                  <Input 
                                    type="number" 
                                    step="0.01"
                                    className="w-24 h-8 text-right"
                                    value={item.editUnitPrice}
                                    onChange={(e) => updateItemField(item.id, 'editUnitPrice', parseFloat(e.target.value) || 0)}
                                  />
                                ) : (
                                  <div className="text-right">{formatCurrency(item.unit_price)}</div>
                                )}
                              </TableCell>
                              <TableCell>
                                {item.isEditing ? (
                                  <Input 
                                    type="number" 
                                    min="0"
                                    max="100"
                                    className="w-20 h-8 text-right"
                                    value={item.editDiscount || 0}
                                    onChange={(e) => updateItemField(item.id, 'editDiscount', parseFloat(e.target.value) || 0)}
                                  />
                                ) : (
                                  <div className="text-right">{item.editDiscount || 0}%</div>
                                )}
                              </TableCell>
                              <TableCell className="text-right font-medium">
                                {formatCurrency(item.total_price)}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1">
                                  {item.isEditing ? (
                                    <>
                                      <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        className="h-8 w-8 text-green-600"
                                        onClick={() => saveItemChanges(item)}
                                      >
                                        <CheckCircle className="h-4 w-4" />
                                      </Button>
                                      <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        className="h-8 w-8"
                                        onClick={() => toggleEditItem(item.id)}
                                      >
                                        <X className="h-4 w-4" />
                                      </Button>
                                    </>
                                  ) : (
                                    <>
                                      <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        className="h-8 w-8 text-primary"
                                        onClick={() => toggleEditItem(item.id)}
                                        disabled={isComandaLocked}
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                      <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        className="h-8 w-8 text-destructive"
                                        onClick={() => removeItem(item.id)}
                                        disabled={isRemoving || isComandaLocked}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                            {/* Product consumption section for services */}
                            {item.service_id && (
                              <TableRow className={item.isProductsExpanded ? "" : "hidden"}>
                                <TableCell colSpan={7} className="p-0 border-b">
                                  <ComandaServiceProducts
                                    serviceId={item.service_id}
                                    comandaItemId={item.id}
                                    serviceName={item.description}
                                    quantity={item.quantity}
                                    isExpanded={!!item.isProductsExpanded}
                                    onToggleExpand={() => toggleProductsExpanded(item.id)}
                                    onProductUsageChange={handleProductUsageChange}
                                    disabled={!!isComandaLocked}
                                    savedProductCost={item.product_cost || 0}
                                  />
                                </TableCell>
                              </TableRow>
                            )}
                          </React.Fragment>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* Add Item Section — Avec inline style */}
              {!isComandaLocked && (
                <div className="space-y-3 pt-2">
                  <ServiceSearchSelect
                    services={services}
                    value={null}
                    onSelect={(serviceId, service) => {
                      if (serviceId && service) {
                        handleAddService(serviceId);
                      }
                    }}
                    placeholder="Buscar serviço..."
                    showPrice
                  />
                  <div className="flex flex-wrap items-center gap-2">
                      <Popover open={productPopoverOpen} onOpenChange={(open) => { setProductPopoverOpen(open); if (open) { loadProducts(); setProductSearch(""); } }}>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="gap-2">
                            <Receipt className="h-4 w-4" />
                            Produto
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80 p-0" align="start">
                          <Command shouldFilter={false}>
                            <div className="p-2">
                              <input
                                className="w-full px-3 py-2 text-sm border rounded-md outline-none focus:ring-2 focus:ring-primary"
                                placeholder="Buscar produto..."
                                value={productSearch}
                                onChange={(e) => setProductSearch(e.target.value)}
                              />
                            </div>
                            <CommandList>
                              {isLoadingProducts ? (
                                <div className="flex items-center justify-center py-6">
                                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                </div>
                              ) : availableProducts.filter(p => p.name.toLowerCase().includes(productSearch.toLowerCase())).length === 0 ? (
                                <CommandEmpty>Nenhum produto com estoque</CommandEmpty>
                              ) : (
                                <CommandGroup heading="Produtos disponíveis">
                                  <ScrollArea className="max-h-60">
                                    {availableProducts
                                      .filter(p => p.name.toLowerCase().includes(productSearch.toLowerCase()))
                                      .map((product: any) => (
                                        <CommandItem
                                          key={product.id}
                                          onSelect={() => handleAddProduct(product)}
                                          className="flex flex-col items-start gap-1 cursor-pointer py-3"
                                        >
                                          <div className="flex items-center justify-between w-full">
                                            <span className="font-medium">{product.name}</span>
                                            <span className="font-bold text-primary">R$ {Number(product.sale_price).toFixed(2)}</span>
                                          </div>
                                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <span>Estoque: {product.current_stock}</span>
                                            {product.brand && <span>• {product.brand}</span>}
                                          </div>
                                        </CommandItem>
                                      ))}
                                  </ScrollArea>
                                </CommandGroup>
                              )}
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      <Popover open={packagePopoverOpen} onOpenChange={(open) => { setPackagePopoverOpen(open); if (open) loadPackages(); }}>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="gap-2">
                            <Gift className="h-4 w-4" />
                            Pacote
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80 p-0" align="start">
                          <Command shouldFilter={false}>
                            <CommandList>
                              {isLoadingPackages ? (
                                <div className="flex items-center justify-center py-6">
                                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                </div>
                              ) : availablePackages.length === 0 ? (
                                <CommandEmpty>Nenhum pacote cadastrado</CommandEmpty>
                              ) : (
                                <CommandGroup heading="Pacotes disponíveis">
                                  <ScrollArea className="max-h-60">
                                    {availablePackages.map((pkg: any) => {
                                      const itemCount = pkg.package_items?.length || 0;
                                      const discount = Number(pkg.discount_percent) || 0;
                                      return (
                                        <CommandItem
                                          key={pkg.id}
                                          onSelect={() => handleAddPackage(pkg)}
                                          className="flex flex-col items-start gap-1 cursor-pointer py-3"
                                        >
                                          <div className="flex items-center justify-between w-full">
                                            <span className="font-medium">{pkg.name}</span>
                                            <span className="font-bold text-primary">R$ {Number(pkg.price).toFixed(2)}</span>
                                          </div>
                                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <span>{itemCount} serviço{itemCount !== 1 ? "s" : ""}</span>
                                            {discount > 0 && (
                                              <Badge variant="secondary" className="text-[10px]">{discount.toFixed(0)}% desc.</Badge>
                                            )}
                                            {Number(pkg.original_price) > 0 && (
                                              <span className="line-through">R$ {Number(pkg.original_price).toFixed(2)}</span>
                                            )}
                                          </div>
                                        </CommandItem>
                                      );
                                    })}
                                  </ScrollArea>
                                </CommandGroup>
                              )}
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      <Button variant="outline" size="sm">Caixinha</Button>
                    </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="pagamento" className="space-y-4 mt-4">
              {/* Avec-style Summary Cards — 5 columns */}
              <div className="grid grid-cols-5 gap-3">
                <Card className="border">
                  <CardContent className="p-3">
                    <Label className="text-xs text-muted-foreground block mb-1">Caixa Responsável:</Label>
                    <Select value={selectedCaixaId || ""} onValueChange={(v) => setSelectedCaixaId(v || null)}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Selecione um caixa" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableCaixas.map((c) => {
                          const caixaDate = new Date(c.opened_at);
                          const sameDay = isSameDay(caixaDate, comandaDate);
                          const name = c.profile?.full_name || "Usuário";
                          const dateStr = format(caixaDate, "dd/MM", { locale: ptBR });
                          return (
                            <SelectItem key={c.id} value={c.id} disabled={!sameDay}>
                              {name} ({dateStr}){!sameDay ? " — data diferente" : ""}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </CardContent>
                </Card>
                <Card className="border">
                  <CardContent className="p-3">
                    <Label className="text-xs text-muted-foreground">Total do Serviço:</Label>
                    <p className="text-lg font-semibold">{formatCurrency(subtotal)}</p>
                  </CardContent>
                </Card>
                <Card className="border">
                  <CardContent className="p-3">
                    <Label className="text-xs text-muted-foreground">Total do Produto:</Label>
                    <p className="text-lg font-semibold">{formatCurrency(0)}</p>
                  </CardContent>
                </Card>
                <Card className="border">
                  <CardContent className="p-3">
                    <Label className="text-xs text-muted-foreground">Saldo do Cliente:</Label>
                    <p className={`text-lg font-semibold ${clientNetBalance > 0 ? 'text-green-600' : clientNetBalance < 0 ? 'text-destructive' : ''}`}>
                      {clientNetBalance !== 0 ? formatCurrency(clientNetBalance) : '0'}
                    </p>
                  </CardContent>
                </Card>
                <Card className="border">
                  <CardContent className="p-3">
                    <Label className="text-xs text-muted-foreground">Diferença:</Label>
                    <p className={`text-lg font-semibold ${difference > 0 ? 'text-destructive' : difference < 0 ? 'text-green-600' : ''}`}>
                      {difference !== 0 ? formatCurrency(-difference) : '0'}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Creditos disponiveis do cliente (cashback acumulado) */}
              {comanda?.client_id && availableCredits.length > 0 && !isComandaLocked && (
                <Card className="border-primary/40 bg-primary/5">
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Gift className="h-4 w-4 text-primary" />
                      Cashback disponivel deste cliente
                    </div>
                    {availableCredits.map((credit) => {
                      const minOk = (subtotal || 0) >= Number(credit.min_purchase_amount);
                      const expDate = new Date(credit.expires_at);
                      const expFormatted = `${expDate.getDate().toString().padStart(2, "0")}/${(expDate.getMonth() + 1).toString().padStart(2, "0")}`;
                      return (
                        <div key={credit.id} className="flex items-center justify-between gap-2 text-sm">
                          <div className="flex-1">
                            <span className="font-semibold text-primary">R$ {Number(credit.credit_amount).toFixed(2)}</span>
                            <span className="text-muted-foreground"> · expira {expFormatted}</span>
                            {!minOk && <span className="text-destructive"> · compra min. R$ {Number(credit.min_purchase_amount).toFixed(2)}</span>}
                          </div>
                          <Button
                            size="sm"
                            variant={minOk ? "default" : "outline"}
                            disabled={!minOk}
                            onClick={async () => {
                              try {
                                const creditAmt = Number(credit.credit_amount);
                                const currentDiscount = Number(comanda?.discount || 0);
                                const currentTotal = Number(comanda?.total || subtotal);
                                // Marca o credito como usado
                                const { error: errCredit } = await supabase
                                  .from("client_credits")
                                  .update({
                                    is_used: true,
                                    used_at: new Date().toISOString(),
                                    used_in_comanda_id: comanda.id,
                                  })
                                  .eq("id", credit.id);
                                if (errCredit) throw errCredit;
                                // Atualiza desconto e total da comanda
                                const { error: errCom } = await supabase
                                  .from("comandas")
                                  .update({
                                    discount: currentDiscount + creditAmt,
                                    total: Math.max(0, currentTotal - creditAmt),
                                  })
                                  .eq("id", comanda.id);
                                if (errCom) throw errCom;
                                // Remove da lista local
                                setAvailableCredits((prev) => prev.filter((c) => c.id !== credit.id));
                                // Refresh comandas
                                queryClient.invalidateQueries({ queryKey: ["comandas"] });
                                queryClient.invalidateQueries({ queryKey: ["client-credits"] });
                                toast({ title: `Cashback de R$ ${creditAmt.toFixed(2)} aplicado!` });
                              } catch (e: any) {
                                toast({ title: "Erro ao aplicar cashback", description: e?.message, variant: "destructive" });
                              }
                            }}
                          >
                            Aplicar
                          </Button>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              )}

              {/* Total a Cobrar — desconto da comanda (cashback aplicado etc) */}
              <div className="text-center py-2">
                {Number(comanda?.discount || 0) > 0 ? (
                  <>
                    <div className="flex justify-center items-baseline gap-3 text-sm text-muted-foreground">
                      <span>Subtotal: {formatCurrency(subtotal)}</span>
                      <span className="text-green-600">- Desconto cashback: {formatCurrency(Number(comanda?.discount || 0))}</span>
                    </div>
                    <Label className="text-xs text-muted-foreground">Total a Cobrar:</Label>
                    <p className="text-3xl font-bold text-destructive">{formatCurrency(Math.max(0, subtotal - Number(comanda?.discount || 0)))}</p>
                  </>
                ) : (
                  <>
                    <Label className="text-xs text-muted-foreground">Total a Cobrar:</Label>
                    <p className="text-3xl font-bold text-destructive">{formatCurrency(subtotal)}</p>
                  </>
                )}
              </div>

              {/* Options row: cashback, credit, debt */}
              <div className="flex flex-wrap gap-4 text-sm">
                {comanda?.client_id && cashbackConfig.enabled && (
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox id="enable-cashback" checked={enableCashback} onCheckedChange={(checked) => setEnableCashback(!!checked)} />
                      <Gift className="h-3.5 w-3.5 text-primary" />
                      Cashback
                    </label>
                    {enableCashback && (
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          step="0.5"
                          min="0"
                          max="50"
                          value={cashbackPercentInput}
                          onChange={(e) => setCashbackPercentInput(e.target.value)}
                          className="h-7 w-16 text-sm"
                          title={`Padrao: ${cashbackConfig.percent}% — ajuste por cliente`}
                        />
                        <span className="text-muted-foreground">%</span>
                      </div>
                    )}
                  </div>
                )}
                {difference < -0.01 && comanda?.client_id && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox id="save-credit" checked={saveOverpaymentAsCredit} onCheckedChange={(checked) => setSaveOverpaymentAsCredit(!!checked)} />
                    Salvar troco como crédito
                  </label>
                )}
                {difference > 0.01 && comanda?.client_id && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox id="save-debt" checked={saveUnderpaymentAsDebt} onCheckedChange={(checked) => setSaveUnderpaymentAsDebt(!!checked)} />
                    Salvar como dívida
                  </label>
                )}

              </div>

              {/* Payment Methods */}
              <Card>
                <CardContent className="p-4 space-y-4">
                  <div className="flex gap-2 text-sm font-medium text-muted-foreground border-b pb-2">
                    <span className="w-8 shrink-0"></span>
                    <span className="w-[140px] shrink-0">Forma de Pagamento</span>
                    <span className="flex-1 min-w-0">Banco/Bandeira</span>
                    <span className="w-[100px] shrink-0">Observações</span>
                    <span className="w-[100px] shrink-0">Valor (R$)</span>
                    <span className="w-10 shrink-0"></span>
                  </div>
                  
                  {payments.map((payment, index) => (
                    <div key={payment.id} className="flex gap-2 items-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-destructive"
                        onClick={() => removePaymentRow(payment.id)}
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <Select
                        value={payment.method}
                        onValueChange={(v: string) => {
                          updatePayment(payment.id, 'method', v);
                          // Clear bank account/card brand when changing method
                          if (v !== 'pix') {
                            updatePayment(payment.id, 'bankAccountId', null);
                          }
                          if (v !== 'credit_card' && v !== 'debit_card') {
                            updatePayment(payment.id, 'cardBrandId', null);
                          }
                          if (v !== 'credit_card') {
                            updatePayment(payment.id, 'installments', 1);
                          }
                        }}
                      >
                        <SelectTrigger className="w-[140px] shrink-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PAYMENT_METHODS.map((method) => (
                            <SelectItem key={method.value} value={method.value}>
                              {method.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {/* Bank/Card Brand Selection */}
                      <div className="flex-1 min-w-0 flex gap-2">
                        {payment.method === 'pix' ? (
                          <Select
                            value={payment.bankAccountId || ""}
                            onValueChange={(v) => updatePayment(payment.id, 'bankAccountId', v || null)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Selecione o banco" />
                            </SelectTrigger>
                            <SelectContent>
                              {bankAccounts.filter(b => b.is_active).map((bank) => (
                                <SelectItem key={bank.id} value={bank.id}>
                                  {bank.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (payment.method === 'credit_card' || payment.method === 'debit_card') ? (
                          <>
                            <Select
                              value={payment.cardBrandId || ""}
                              onValueChange={(v) => updatePayment(payment.id, 'cardBrandId', v || null)}
                            >
                              <SelectTrigger className="min-w-0">
                                <SelectValue placeholder="Bandeira" />
                              </SelectTrigger>
                              <SelectContent>
                                {cardBrands.filter(b => b.is_active).map((brand) => {
                                  const feePercent = getCardFeePercent(brand, payment.method as 'credit_card' | 'debit_card', payment.installments || 1);
                                  return (
                                    <SelectItem key={brand.id} value={brand.id}>
                                      {brand.name} ({feePercent}%)
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                            {payment.method === 'credit_card' && (
                              <Select
                                value={String(payment.installments || 1)}
                                onValueChange={(v) => updatePayment(payment.id, 'installments', parseInt(v))}
                              >
                                <SelectTrigger className="w-[80px] shrink-0">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {INSTALLMENT_OPTIONS.map((opt) => (
                                    <SelectItem key={opt.value} value={String(opt.value)}>
                                      {opt.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </>
                        ) : (
                          <div className="flex-1" />
                        )}
                      </div>

                      <Input
                        placeholder="Observações"
                        value={payment.info}
                        onChange={(e) => updatePayment(payment.id, 'info', e.target.value)}
                        className="w-[100px] shrink-0"
                      />

                      <Input
                        type="number"
                        step="0.01"
                        value={payment.amount || ""}
                        onChange={(e) => updatePayment(payment.id, 'amount', parseFloat(e.target.value) || 0)}
                        className="w-[100px] shrink-0 text-right"
                      />

                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() => updatePayment(payment.id, 'amount', subtotal - totalPayments + payment.amount)}
                      >
                        Dif
                      </Button>
                    </div>
                  ))}

                  <Button variant="outline" size="sm" className="gap-2" onClick={addPaymentRow}>
                    <Plus className="h-4 w-4" />
                    Adicionar Forma de Pagamento
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="prontuario">
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground">
                  Prontuário do cliente em desenvolvimento
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="informacoes">
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground">
                  Informações adicionais em desenvolvimento
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Avec-style Footer */}
        <div className="flex items-center justify-between border-t px-6 py-3 flex-shrink-0 bg-background">
          <Button
            variant="outline"
            className="gap-2 text-sm"
            onClick={handleSyncComanda}
            disabled={isUpdating}
          >
            <RefreshCw className={`h-4 w-4 ${isUpdating ? "animate-spin" : ""}`} />
            {isUpdating ? "Atualizando..." : "Atualizar Comanda"}
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={handlePrintReceipt} title="Imprimir">
              <Printer className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="text-destructive hover:text-destructive"
              onClick={() => { if (comanda && onDelete) onDelete(comanda); }}
              title="Excluir"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={onClose}>Confirmar</Button>
            {comanda?.closed_at ? (
              <Button
                variant="outline"
                className="gap-2 border-orange-500 text-orange-600 hover:bg-orange-50"
                onClick={handleReopenComanda}
                disabled={isReopening}
              >
                <RefreshCw className={`h-4 w-4 ${isReopening ? "animate-spin" : ""}`} />
                {isReopening ? "Reabrindo..." : "Reabrir Comanda"}
              </Button>
            ) : (
              <Button
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
                onClick={handleFinalizeComanda}
                disabled={isClosing || !canFinalizeComanda}
                title={!canFinalizeComanda ? "Você só pode finalizar suas próprias comandas" : undefined}
              >
                {isClosing ? "Finalizando..." : !canFinalizeComanda ? "Sem permissão" : "Finalizar Comanda"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>

      {/* Caixa Selection Modal */}
      <CaixaSelectModal
        open={caixaSelectModalOpen}
        onClose={() => setCaixaSelectModalOpen(false)}
        onSelect={setSelectedCaixaId}
        caixas={openCaixas}
        comandaDate={comandaDate}
        selectedCaixaId={selectedCaixaId}
      />
    </Dialog>
  );
}
