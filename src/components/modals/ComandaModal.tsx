// @ts-nocheck
import React, { useState, useEffect, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent } from "@/components/ui/tabs";
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
import { recalcComandaTotals } from "@/lib/comandaTotals";
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
import { useCurrentUserPermissions } from "@/hooks/useCurrentUserPermissions";
import { useSalonPermissions } from "@/hooks/useSalonPermissions";
import { ComandaServiceProducts } from "@/components/comanda/ComandaServiceProducts";
import { useClientNetBalance } from "@/hooks/useClientBalance";
import { NavTabs, DiffField, Receipt as NpReceipt, Badge as NpBadge } from "@design-system";

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
  provider?: string | null;
  // Pagamento online (Asaas via fila): já recebido, não pode ser editado nem removido no fechamento.
  locked?: boolean;
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
  const { pode } = useSalonPermissions();
  const canDelete = pode("comanda.excluir");
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("itens");
  const { items, isLoading, addItem, removeItem, isAdding, isRemoving } = useComandaItems(comanda?.id || null);
  const { reopenComanda, isReopening } = useComandas();
  const { calculateServiceCost } = useAllServiceProducts();
  const { deductStockForServices } = useStockMovements();
  const { bankAccounts } = useBankAccounts();
  const { cardBrands } = useCardBrands();
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
  // Creditos da FILA (pagou online e nao foi atendida → credito 30d) — tabela customer_credits
  const [filaCredits, setFilaCredits] = useState<Array<{
    id: string;
    amount: number;
    expires_at: string;
  }>>([]);
  // Discount efetivo da comanda (lido da prop + somas locais ao aplicar credito) — espelho local
  const [localDiscount, setLocalDiscount] = useState<number>(0);
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
          else if (row.key === "cashback_min_purchase" && row.value) {
            // "0" = sem compra mínima (não pode cair no padrão de 100)
            const v = parseFloat(row.value);
            cfg.minPurchase = Number.isFinite(v) && v >= 0 ? v : 100;
          }
        }
        setCashbackConfig(cfg);
        setCashbackPercentInput(cfg.percent);
      });
  }, [open]);

  // Sincroniza localDiscount com comanda.discount quando comanda muda
  useEffect(() => {
    setLocalDiscount(Number(comanda?.discount || 0));
  }, [comanda?.id, comanda?.discount]);

  // A prop `comanda` é uma cópia que não se atualiza com o modal aberto. Quando os itens mudam
  // (lançar/remover/editar), os triggers do Clube/pacote podem ter mexido no discount do banco:
  // relê o discount para "Total a Cobrar", "Diferença" e "Fechar sem cobrança" refletirem o real.
  useEffect(() => {
    if (!open || !comanda?.id) return;
    let cancelled = false;
    supabase
      .from("comandas")
      .select("discount")
      .eq("id", comanda.id)
      .single()
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        setLocalDiscount(Number((data as any).discount || 0));
      });
    return () => { cancelled = true; };
  }, [open, comanda?.id, items]);

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

  // Load creditos da FILA (customer_credits, match por telefone do cliente)
  useEffect(() => {
    if (!open || !comanda?.client_id) {
      setFilaCredits([]);
      return;
    }
    (async () => {
      const { data: cli } = await supabase
        .from("clients_staff")
        .select("phone")
        .eq("id", comanda.client_id)
        .maybeSingle();
      const dig = String((cli as any)?.phone || "").replace(/\D/g, "");
      if (dig.length < 8) {
        setFilaCredits([]);
        return;
      }
      const chave = dig.slice(-8);
      const nowIso = new Date().toISOString();
      const { data } = await supabase
        .from("customer_credits")
        .select("id, amount, expires_at, customer_phone")
        .eq("used", false)
        .gt("expires_at", nowIso)
        .order("expires_at", { ascending: true });
      const meus = ((data as any) || []).filter(
        (c: any) => String(c.customer_phone || "").replace(/\D/g, "").slice(-8) === chave,
      );
      setFilaCredits(meus);
    })();
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
    // Pagamento anulado na reabertura NÃO conta: sem este filtro a tela mostrava
    // o pagamento antigo como válido e deixava fechar de novo sem pagar (04/09).
    const { data } = await supabase
      .from("payments")
      .select("*")
      .eq("comanda_id", comanda.id)
      .eq("voided", false);
    if (data) {
      setPayments(data.map(p => ({
        id: p.id,
        method: p.payment_method,
        amount: Number(p.amount),
        info: p.notes || "",
        bankAccountId: p.bank_account_id || null,
        cardBrandId: p.card_brand_id || null,
        installments: p.installments || 1,
        provider: p.payment_provider || null,
        // Pagamento online (Asaas) já recebido pela fila → travado no fechamento.
        locked: p.payment_provider === "asaas",
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
        // Anti-duplicação (Cleiton 08/07): se JÁ existe appointment desse serviço nesta comanda,
        // não cria outro (era isso que triplicava o atendimento ao mexer/fechar a comanda).
        const { data: jaExiste } = await supabase
          .from("appointments")
          .select("id")
          .eq("salon_id", salonId)
          .eq("client_id", comanda.client_id)
          .eq("service_id", serviceId)
          .ilike("notes", `%comanda ${comandaRef}%`)
          .neq("status", "cancelled")
          .limit(1)
          .maybeSingle();
        if (jaExiste) {
          queryClient.invalidateQueries({ queryKey: ["appointments", salonId] });
          return;
        }
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
    // total = subtotal − discount ATUAL do banco (a prop comanda.discount pode estar velha)
    await recalcComandaTotals(comanda.id);
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

      // Update comanda date to today — só em comanda ABERTA: o banco recusa
      // mudar created_at de comanda fechada fora de RPC (etapa 5, F-11).
      const now = new Date();
      const dateUpdate: { updated_at: string; created_at?: string } = { updated_at: now.toISOString() };
      if (!comanda.closed_at) dateUpdate.created_at = now.toISOString();
      await supabase
        .from("comandas")
        .update(dateUpdate)
        .eq("id", comanda.id);

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ["comandas", salonId] });
      queryClient.invalidateQueries({ queryKey: ["comanda_items", comanda.id] });

      const messages = [];
      if (itemsAdded > 0) messages.push(`${itemsAdded} serviço(s) adicionado(s)`);
      if (itemsUpdated > 0) messages.push(`${itemsUpdated} serviço(s) atualizado(s)`);
      if (dateUpdate.created_at) messages.push("Data atualizada para hoje");

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
    // Pagamento online (Asaas) é travado: não pode ser removido no fechamento.
    setPayments(prev => prev.filter(p => p.id !== paymentId || p.locked));
  };

  const updatePayment = (paymentId: string, field: string, value: string | number) => {
    setPayments(prev => prev.map(p => {
      if (p.id !== paymentId) return p;
      if (p.locked) return p; // travado: pagamento online não editável
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
  // Pagamentos JÁ recebidos (online/Asaas, travados) — abatem o que ainda falta cobrar no balcão
  const totalJaRecebido = payments.filter(p => p.locked).reduce((acc, p) => acc + p.amount, 0);
  // Total efetivo a cobrar — abate o discount da comanda (cashback aplicado, Clube, pacote etc).
  // Usa o discount LOCAL (mesmo valor enviado à RPC), não a prop, que não se atualiza dentro do modal.
  const totalACobrar = Math.max(0, subtotal - localDiscount);
  // O que a recepção ainda precisa cobrar (desconta o que já entrou online)
  const totalACobrarLiquido = Math.max(0, totalACobrar - totalJaRecebido);
  // Líquido a cobrar − tudo que já foi lançado (online + novas linhas). Nunca o subtotal cheio (F-04).
  const difference = totalACobrar - totalPayments;
  // Comanda paga por Clube/pacote/crédito (líquido zero) e sem linha nova: fecha sem cobrança, com p_payments vazio.
  const fecharSemCobranca = totalACobrarLiquido < 0.01 && !payments.some(p => p.id.startsWith("temp_") && p.amount > 0);

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
  <h2>NP HAIR EXPRESS</h2>
  <div style="text-align:center;font-size:10px;">Comprovante sem valor fiscal</div>
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
  <div class="footer">Obrigado pela preferência!<br>Beleza pra quem não para!</div>
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
      // Reabertura 100% no banco (falha 17): a RPC estorna pagamentos manuais
      // de forma auditável (nunca deleta), preserva pagamentos de provedor
      // (Asaas) e valida caixa aberto/papel server-side.
      await reopenComanda({ comandaId: comanda.id });
      queryClient.invalidateQueries({ queryKey: ["comandas"] });
      queryClient.invalidateQueries({ queryKey: ["comanda_items", comanda.id] });
      loadPayments();
      onClose();
    } catch (err: any) {
      toast({ title: "Erro ao reabrir comanda", description: err?.message || "Tente novamente.", variant: "destructive" });
    }
  };

  const handleFinalizeComanda = async () => {
    if (!comanda || !salonId) return;
    // Duplo clique: o estado do botão pode atrasar um render — segunda chamada não sai daqui.
    if (isClosing) return;

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
      // Fechamento 100% no banco (etapa 4, F-01/F-05/F-20): pagamentos (com taxa
      // por bandeira/PIX), caixa, comanda, fila, agendamentos, cashback, troco,
      // dívida e saldo anterior entram em UMA transação. Erro no meio = nada
      // gravado — antes, cada escrita solta podia ficar pela metade (pagamento
      // duplicado e caixa inflado no duplo clique).
      const novosPagamentos = payments
        .filter(p => p.id.startsWith("temp_") && p.amount > 0)
        .map(p => ({
          method: p.method,
          amount: p.amount,
          installments: p.method === 'credit_card' ? (p.installments || 1) : 1,
          card_brand_id: (p.method === 'credit_card' || p.method === 'debit_card') ? p.cardBrandId : null,
          bank_account_id: p.method === 'pix' ? p.bankAccountId : null,
          notes: p.info || null,
        }));

      // Agendamentos que viram "paid": o da comanda + os de origem dos itens
      const appointmentIds = [
        comanda.appointment_id,
        ...editableItems.map(item => (item as any).source_appointment_id),
      ].filter(Boolean);

      // % digitada pelo profissional (fallback config padrao)
      const inputPct = parseFloat(cashbackPercentInput);
      const cashbackPercent = isNaN(inputPct) ? parseFloat(cashbackConfig.percent) : inputPct;

      const { data, error } = await supabase.rpc("rpc_fechar_comanda_v2", {
        p_comanda: comanda.id,
        p_caixa: caixaToUse,
        p_payments: novosPagamentos,
        p_discount: localDiscount,
        p_allow_underpaid: saveUnderpaymentAsDebt,
        p_overpayment_mode: saveOverpaymentAsCredit ? 'credito' : 'troco',
        p_underpaid_as_debt: saveUnderpaymentAsDebt,
        p_cashback: (enableCashback && cashbackConfig.enabled && comanda.client_id)
          ? { percent: cashbackPercent, min_purchase: cashbackConfig.minPurchase, validity_days: cashbackConfig.validityDays }
          : null,
        p_appointment_ids: appointmentIds.length > 0 ? appointmentIds : null,
      });
      if (error) throw error;
      const result = (data || {}) as { ok?: boolean; error?: string; message?: string; cashback_id?: string | null };
      if (result.ok !== true) {
        throw new Error(result.error || result.message || "O banco recusou o fechamento da comanda.");
      }

      // ---- Daqui pra baixo só efeito NÃO crítico: a comanda já está fechada. ----

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

      // E-mail de cashback — o crédito em si já foi gerado pela RPC (só quando ela devolve cashback_id)
      if (result.cashback_id && comanda.client?.name && comanda.client_id) {
        try {
          const { data: credit } = await supabase
            .from("client_credits")
            .select("credit_amount, expires_at")
            .eq("id", result.cashback_id)
            .single();
          const { data: clientData } = await supabase
            .from("clients_staff")
            .select("email")
            .eq("id", comanda.client_id)
            .single();

          if (credit && clientData?.email) {
            const expiresAt = new Date(credit.expires_at);
            sendEmail({
              type: "cashback",
              salon_id: salonId,
              to_email: clientData.email,
              to_name: comanda.client.name,
              client_id: comanda.client_id,
              variables: {
                credit_amount: Number(credit.credit_amount).toFixed(2),
                expires_at: `${expiresAt.getDate().toString().padStart(2, "0")}/${(expiresAt.getMonth() + 1).toString().padStart(2, "0")}/${expiresAt.getFullYear()}`,
              },
            }).catch(() => {});
          }
        } catch (emailError) {
          console.error("Erro ao enviar e-mail de cashback:", emailError);
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
      <DialogContent className="max-sm:w-screen max-sm:h-[100dvh] max-sm:max-w-none max-sm:max-h-none max-sm:rounded-none max-w-[95vw] lg:max-w-6xl max-h-[95vh] overflow-hidden flex flex-col p-0">
        {/* Header responsivo (mobile: título em cima c/ espaço pro X, abas roláveis embaixo) */}
        <div className="px-4 md:px-6 pt-4 pb-2 border-b border-border bg-background">
          {/* Título — no mobile fica em cima, com padding pra não bater no X de fechar */}
          <div className="md:hidden pr-10 mb-2">
            <span className="np-display text-lg text-foreground truncate block">
              Comanda {getComandaNumber()} · {comanda.client?.name || "Cliente"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4 min-w-0">
            <div className="min-w-0 max-w-full overflow-x-auto">
              <NavTabs
                variant="underline"
                aria-label="Seções da comanda"
                value={activeTab}
                onChange={setActiveTab}
                tabs={[
                  { id: "itens", label: "Itens" },
                  { id: "pagamento", label: "Pagamento" },
                  { id: "prontuario", label: "Prontuário" },
                  { id: "informacoes", label: "Informações" },
                ]}
              />
            </div>
            <span className="hidden md:inline np-display text-xl text-foreground whitespace-nowrap truncate pr-8">
              Comanda {getComandaNumber()} - {comanda.client?.name || "Cliente"}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 md:px-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsContent value="itens" className="space-y-4 mt-4">
              {/* Locked Comanda Warning */}
              {isComandaLocked && (
                <div role="alert" className="flex items-center gap-3 p-3 rounded-xl border border-[var(--np-danger-border)] bg-[var(--np-danger-soft)]">
                  <X className="h-5 w-5 text-[var(--np-danger-text)] shrink-0" />
                  <div>
                    <p className="font-semibold text-[var(--np-danger-text)] text-sm">Comanda Bloqueada</p>
                    <p className="text-xs text-muted-foreground">Reabra o caixa para editar.</p>
                  </div>
                </div>
              )}

              {/* Client Info + Date + Number — Avec inline style */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 py-2 border-b border-border">
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
                  <NpBadge tone="danger">
                    <AlertTriangle className="h-3 w-3" /> Divida <span className="tabular-nums">{formatCurrency(Math.abs(clientNetBalance))}</span>
                  </NpBadge>
                )}
                {comanda.client_id && clientNetBalance > 0 && (
                  <NpBadge tone="positive">
                    <Wallet className="h-3 w-3" /> Credito <span className="tabular-nums">{formatCurrency(clientNetBalance)}</span>
                  </NpBadge>
                )}
              </div>

              {/* Items — MOBILE: cards empilhados (o profissional lança/edita pelo celular) */}
              <div className="md:hidden space-y-3">
                {isLoading ? (
                  <div className="text-center py-6"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
                ) : editableItems.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">Nenhum serviço adicionado</div>
                ) : (
                  editableItems.map((item) => {
                    const nome = item.description?.includes("📦") ? item.description.split(" — ")[0] : item.description;
                    return (
                    <div key={item.id} className="rounded-2xl border border-border bg-foreground/[0.04] p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <span className="font-medium leading-tight">{nome}</span>
                        <span className="np-num whitespace-nowrap text-foreground">{formatCurrency(item.total_price)}</span>
                      </div>

                      {item.isEditing ? (
                        <div className="space-y-2">
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <Label className="text-[11px] text-muted-foreground">Qtd</Label>
                              <Input type="number" min="1" className="h-11" value={item.editQuantity}
                                onChange={(e) => updateItemField(item.id, 'editQuantity', parseInt(e.target.value) || 1)} />
                            </div>
                            <div>
                              <Label className="text-[11px] text-muted-foreground">Valor</Label>
                              <Input type="number" step="0.01" className="h-11 text-right" value={item.editUnitPrice}
                                onChange={(e) => updateItemField(item.id, 'editUnitPrice', parseFloat(e.target.value) || 0)} />
                            </div>
                            <div>
                              <Label className="text-[11px] text-muted-foreground">Desc%</Label>
                              <Input type="number" min="0" max="100" className="h-11 text-right" value={item.editDiscount || 0}
                                onChange={(e) => updateItemField(item.id, 'editDiscount', parseFloat(e.target.value) || 0)} />
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button className="flex-1 h-12 gap-2" onClick={() => saveItemChanges(item)}><CheckCircle className="h-4 w-4" /> Salvar</Button>
                            <Button variant="outline" className="h-11" onClick={() => toggleEditItem(item.id)}><X className="h-4 w-4" /></Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <Select value={item.editProfessionalId || item.professional_id || comanda.professional_id || ""}
                            onValueChange={(value) => updateItemProfessional(item.id, value)}>
                            <SelectTrigger className="h-11"><SelectValue placeholder="Profissional" /></SelectTrigger>
                            <SelectContent>
                              {professionals.filter(p => p.is_active).map((prof) => (
                                <SelectItem key={prof.id} value={prof.id}>{prof.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <div className="flex items-center justify-between text-sm text-muted-foreground">
                            <span>Qtd {item.quantity} · {formatCurrency(item.unit_price)}{(item.editDiscount || 0) > 0 ? ` · -${item.editDiscount}%` : ""}</span>
                            {item.service_id && (
                              <Button variant="ghost" size="sm" className="h-11 gap-1 text-muted-foreground"
                                onClick={() => toggleProductsExpanded(item.id)}>
                                <Package className="h-4 w-4" /> Produtos
                              </Button>
                            )}
                          </div>
                          {!isComandaLocked && (
                            <div className="flex gap-2">
                              <Button variant="outline" className="flex-1 h-11 gap-2" onClick={() => toggleEditItem(item.id)}>
                                <Pencil className="h-4 w-4" /> Editar
                              </Button>
                              <Button variant="outline" className="h-11 w-11 text-[var(--np-danger-text)]" onClick={() => removeItem(item.id)} disabled={isRemoving} aria-label="Remover item">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                          {item.service_id && item.isProductsExpanded && (
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
                              savedProducts={item.comanda_item_products}
                            />
                          )}
                        </>
                      )}
                    </div>
                    );
                  })
                )}
              </div>

              {/* Items Table — DESKTOP */}
              <Card className="hidden md:block">
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
                                      <Badge variant="secondary" className="text-xs whitespace-nowrap border border-[var(--np-accent-border)] bg-[var(--np-accent-soft)] text-[var(--np-accent-text)]">
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
                              <TableCell className="text-right font-semibold tabular-nums">
                                {formatCurrency(item.total_price)}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1">
                                  {item.isEditing ? (
                                    <>
                                      <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        className="h-8 w-8 text-[var(--np-positive-text)]"
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
                                    savedProducts={item.comanda_item_products}
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
                          <Button variant="outline" size="sm" className="gap-2 h-11">
                            <Receipt className="h-4 w-4" />
                            Produto
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80 p-0" align="start">
                          <Command shouldFilter={false}>
                            <div className="p-2">
                              <input
                                className="w-full h-11 px-3 text-sm border border-input bg-background text-foreground placeholder:text-muted-foreground rounded-md outline-none focus:ring-2 focus:ring-primary"
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
                          <Button variant="outline" size="sm" className="gap-2 h-11">
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
                      <Button variant="outline" size="sm" className="h-11">Caixinha</Button>
                    </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="pagamento" className="space-y-4 mt-4">
              {/* Resumo do pagamento — caixa, totais, saldo e diferença */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 md:gap-3">
                <div className="col-span-2 sm:col-span-1 rounded-2xl border border-border bg-foreground/[0.04] p-3">
                  <Label className="text-xs text-muted-foreground block mb-1">Caixa Responsável:</Label>
                  <Select value={selectedCaixaId || ""} onValueChange={(v) => setSelectedCaixaId(v || null)}>
                    <SelectTrigger className="h-11 text-xs">
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
                </div>
                <div className="rounded-2xl border border-border bg-foreground/[0.04] p-3">
                  <Label className="text-xs text-muted-foreground">Total do Serviço:</Label>
                  <p className="np-num text-lg text-foreground">{formatCurrency(subtotal)}</p>
                </div>
                <div className="rounded-2xl border border-border bg-foreground/[0.04] p-3">
                  <Label className="text-xs text-muted-foreground">Total do Produto:</Label>
                  <p className="np-num text-lg text-foreground">{formatCurrency(0)}</p>
                </div>
                <div className="rounded-2xl border border-border bg-foreground/[0.04] p-3">
                  <Label className="text-xs text-muted-foreground">Saldo do Cliente:</Label>
                  <p className={`np-num text-lg ${clientNetBalance > 0 ? 'text-[var(--np-positive-text)]' : clientNetBalance < 0 ? 'text-[var(--np-danger-text)]' : 'text-foreground'}`}>
                    {clientNetBalance !== 0 ? formatCurrency(clientNetBalance) : '0'}
                  </p>
                </div>
                {/* Diferença: positivo = troco (verde), negativo = falta (vermelho). Mesmo número de antes (−difference). */}
                <DiffField className="col-span-2 sm:col-span-1" label="Diferença" value={-difference} />
              </div>

              {/* Creditos disponiveis do cliente (cashback acumulado) */}
              {comanda?.client_id && availableCredits.length > 0 && !isComandaLocked && (
                <Card className="border-primary/40 bg-primary/5">
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Gift className="h-4 w-4 text-primary" />
                      Cashback e créditos deste cliente
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
                            disabled={!minOk || !pode("comanda.desconto_manual")}
                            title={!pode("comanda.desconto_manual") ? "Sem permissão para desconto manual" : undefined}
                            onClick={async () => {
                              try {
                                const creditAmt = Number(credit.credit_amount);
                                // Atômico no banco: marca o crédito usado e soma no desconto na
                                // mesma transação. O UPDATE direto em client_credits era barrado
                                // pela RLS na recepção (0 linhas, sem erro) e o crédito ficava reusável.
                                const { data, error } = await supabase.rpc("rpc_aplicar_credito_cliente", {
                                  p_comanda: comanda.id,
                                  p_credit: credit.id,
                                });
                                if (error) throw error;
                                const res = data as { new_discount?: number } | null;
                                if (typeof res?.new_discount === "number") setLocalDiscount(res.new_discount);
                                setAvailableCredits((prev) => prev.filter((c) => c.id !== credit.id));
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

              {/* Credito da FILA (pagou online e nao foi atendida) */}
              {comanda?.client_id && filaCredits.length > 0 && !isComandaLocked && (
                <Card className="border-[var(--np-accent-border)] bg-[var(--np-accent-soft)]">
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[var(--np-accent-text)]">
                      <Gift className="h-4 w-4" />
                      Crédito da fila online (pagou e não foi atendida)
                    </div>
                    {filaCredits.map((credit) => (
                      <div key={credit.id} className="flex items-center justify-between gap-2 text-sm">
                        <span>
                          {formatCurrency(Number(credit.amount))} · vence{" "}
                          {new Date(credit.expires_at).toLocaleDateString("pt-BR")}
                        </span>
                        <Button
                          size="sm"
                          onClick={async () => {
                            try {
                              const creditAmt = Number(credit.amount);
                              // Atômico no banco (falha 5): trava o crédito, marca
                              // usado e recalcula o total em UMA transação — sem
                              // corrida entre marcar-usado e aplicar-desconto.
                              const { data, error } = await supabase.rpc("rpc_aplicar_credito_fila", {
                                p_comanda: comanda.id,
                                p_credit: credit.id,
                              });
                              if (error) throw error;
                              const res = data as { new_discount?: number } | null;
                              if (typeof res?.new_discount === "number") setLocalDiscount(res.new_discount);
                              setFilaCredits((prev) => prev.filter((c) => c.id !== credit.id));
                              queryClient.invalidateQueries({ queryKey: ["comandas"] });
                              toast({ title: `Crédito da fila de R$ ${creditAmt.toFixed(2)} aplicado!` });
                            } catch (e: any) {
                              toast({ title: "Erro ao aplicar crédito da fila", description: e?.message, variant: "destructive" });
                            }
                          }}
                        >
                          Aplicar
                        </Button>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Total a Cobrar — desconto da comanda (cashback aplicado etc) */}
              <div className="text-center py-4 rounded-2xl border border-border bg-foreground/[0.04]">
                {(Number(comanda?.discount || 0) > 0 || totalJaRecebido > 0) ? (
                  <>
                    <div className="flex justify-center items-baseline gap-3 text-sm text-muted-foreground flex-wrap">
                      <span className="tabular-nums">Subtotal: {formatCurrency(subtotal)}</span>
                      {Number(comanda?.discount || 0) > 0 && (
                        <span className="text-[var(--np-positive-text)] tabular-nums">- Desconto cashback: {formatCurrency(Number(comanda?.discount || 0))}</span>
                      )}
                      {totalJaRecebido > 0 && (
                        <span className="text-[var(--np-positive-text)] tabular-nums">- Pago online: {formatCurrency(totalJaRecebido)}</span>
                      )}
                    </div>
                    <Label className="text-xs text-muted-foreground">Total a Cobrar:</Label>
                    <p className="np-num text-4xl text-foreground">{formatCurrency(totalACobrarLiquido)}</p>
                  </>
                ) : (
                  <>
                    <Label className="text-xs text-muted-foreground">Total a Cobrar:</Label>
                    <p className="np-num text-4xl text-foreground">{formatCurrency(subtotal)}</p>
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

              {/* Comprovante em formato de cupom (só leitura) — comanda fechada */}
              {comanda?.closed_at && (
                <div className="flex justify-center">
                  <NpReceipt
                    className="w-full max-w-[340px]"
                    number={getComandaNumber()}
                    date={format(new Date(comanda.closed_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                    client={comanda.client?.name || "Cliente não informado"}
                    items={editableItems.map((it) => ({
                      name: it.description?.includes("📦") ? it.description.split(" — ")[0] : it.description,
                      pro: professionals.find((p) => p.id === ((it as any).professional_id || comanda.professional_id))?.name,
                      price: Number(it.total_price) || 0,
                    }))}
                    discount={localDiscount}
                    method={payments.length > 0 ? Array.from(new Set(payments.map((p) => PAYMENT_METHODS.find((pm) => pm.value === p.method)?.label || p.method))).join(" + ") : undefined}
                    received={payments.length > 0 ? totalPayments : undefined}
                  />
                </div>
              )}

              {/* Payment Methods */}
              <Card>
                <CardContent className="p-4 space-y-4">
                  <div className="hidden md:flex gap-2 text-sm font-medium text-muted-foreground border-b border-border pb-2">
                    <span className="w-8 shrink-0"></span>
                    <span className="w-[140px] shrink-0">Forma de Pagamento</span>
                    <span className="flex-1 min-w-0">Banco/Bandeira</span>
                    <span className="w-[100px] shrink-0">Observações</span>
                    <span className="w-[100px] shrink-0">Valor (R$)</span>
                    <span className="w-10 shrink-0"></span>
                  </div>
                  
                  {payments.map((payment, index) => (
                    payment.locked ? (
                      <div key={payment.id} className="flex items-center gap-2 rounded-xl border border-[var(--np-positive-border)] bg-[var(--np-positive-soft)] px-3 py-2">
                        <CheckCircle className="h-5 w-5 text-[var(--np-positive-text)] shrink-0" />
                        <span className="flex-1 text-sm font-medium text-[var(--np-positive-text)]">
                          Pago online via Asaas · já recebido, não editável
                        </span>
                        <span className="text-sm font-semibold text-[var(--np-positive-text)] tabular-nums">
                          {formatCurrency(payment.amount)}
                        </span>
                      </div>
                    ) : (
                    <div key={payment.id} className="grid grid-cols-[44px_1fr] md:flex md:flex-nowrap gap-2 items-center rounded-xl border border-border p-2 md:border-0 md:p-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11 md:h-8 md:w-8 shrink-0 text-[var(--np-danger-text)]"
                        aria-label="Remover forma de pagamento"
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
                        <SelectTrigger className="h-11 md:h-10 w-full md:w-[140px] shrink-0">
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
                      <div className="col-span-2 md:col-auto flex-1 min-w-0 flex gap-2 empty:hidden">
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
                          <div className="hidden md:block flex-1" />
                        )}
                      </div>

                      <Input
                        placeholder="Observações"
                        value={payment.info}
                        onChange={(e) => updatePayment(payment.id, 'info', e.target.value)}
                        className="col-span-2 md:col-auto h-11 md:h-10 w-full md:w-[100px] shrink-0"
                      />

                      <div className="col-span-2 flex gap-2 md:contents">
                      <Input
                        type="number"
                        step="0.01"
                        value={payment.amount || ""}
                        onChange={(e) => updatePayment(payment.id, 'amount', parseFloat(e.target.value) || 0)}
                        aria-label="Valor (R$)"
                        className="h-11 md:h-10 flex-1 md:flex-none md:w-[100px] shrink-0 text-right tabular-nums"
                      />

                      <Button
                        variant="outline"
                        size="sm"
                        className="h-11 md:h-9 px-5 shrink-0 font-semibold"
                        title="Preencher com a diferença"
                        onClick={() => updatePayment(payment.id, 'amount', Math.max(0, Math.round((difference + payment.amount) * 100) / 100))}
                      >
                        Dif
                      </Button>
                      </div>
                    </div>
                    )
                  ))}

                  <Button variant="outline" size="sm" className="gap-2 h-11 w-full md:w-auto" onClick={addPaymentRow}>
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

        {/* Rodapé — no celular as ações principais ocupam a largura toda (alvo ≥ 48 px) */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 md:px-6 py-3 flex-shrink-0 bg-background">
          <Button
            variant="outline"
            className="gap-2 text-sm h-12 md:h-10 max-sm:flex-1"
            onClick={handleSyncComanda}
            disabled={isUpdating}
          >
            <RefreshCw className={`h-4 w-4 ${isUpdating ? "animate-spin" : ""}`} />
            {isUpdating ? "Atualizando..." : "Atualizar Comanda"}
          </Button>
          <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
            <Button variant="outline" size="icon" className="h-12 w-12 md:h-10 md:w-10" onClick={handlePrintReceipt} title="Imprimir" aria-label="Imprimir">
              <Printer className="h-4 w-4" />
            </Button>
            {canDelete && (
              <Button
                variant="outline"
                size="icon"
                className="h-12 w-12 md:h-10 md:w-10 text-[var(--np-danger-text)] hover:text-[var(--np-danger-text)]"
                onClick={() => { if (comanda && onDelete) onDelete(comanda); }}
                title="Excluir"
                aria-label="Excluir"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            <Button variant="outline" className="h-12 md:h-10 max-sm:flex-1" onClick={onClose}>Confirmar</Button>
            {comanda?.closed_at ? pode("comanda.reabrir") && (
              <Button
                variant="outline"
                className="gap-2 h-12 md:h-10 max-sm:w-full border-[var(--np-accent-border)] text-[var(--np-accent-text)] hover:bg-[var(--np-accent-soft)] hover:text-[var(--np-accent-text)]"
                onClick={handleReopenComanda}
                disabled={isReopening}
              >
                <RefreshCw className={`h-4 w-4 ${isReopening ? "animate-spin" : ""}`} />
                {isReopening ? "Reabrindo..." : "Reabrir Comanda"}
              </Button>
            ) : (
              <Button
                className="h-12 px-6 max-sm:w-full font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_8px_24px_var(--np-accent-glow)]"
                onClick={handleFinalizeComanda}
                disabled={isClosing || !canFinalizeComanda}
                title={!canFinalizeComanda ? "Você só pode finalizar suas próprias comandas" : undefined}
              >
                {isClosing ? "Finalizando..." : !canFinalizeComanda ? "Sem permissão" : fecharSemCobranca ? "Fechar sem cobrança" : "Finalizar Comanda"}
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
