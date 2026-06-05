import { useState, useMemo, useEffect } from "react";
import { AppLayoutNew } from "@/components/layout/AppLayoutNew";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Loader2, DollarSign, ChevronDown, ChevronUp, FileText, Printer, Gift, MinusCircle, Trash2 } from "lucide-react";
import { useProfessionals } from "@/hooks/useProfessionals";
import { useComandas } from "@/hooks/useComandas";
import { useServices } from "@/hooks/useServices";
import { useClients } from "@/hooks/useClients";
import { useCommissionSettings } from "@/hooks/useCommissionSettings";
import { useCurrentProfessional } from "@/hooks/useCurrentProfessional";
import { useCommissionAdjustments, AdjustmentType } from "@/hooks/useCommissionAdjustments";
import { useCommissionPayments } from "@/hooks/useCommissionPayments";
import { CommissionAdjustmentModal } from "@/components/modals/CommissionAdjustmentModal";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { useAuth } from "@/contexts/AuthContext";
import { format, startOfMonth, isWithinInterval } from "date-fns";
import { ptBR } from "date-fns/locale";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface CommissionItem {
  comandaId: string;
  comandaNumber: string;
  date: string;
  serviceName: string;
  clientName: string;
  serviceValue: number;
  productCost: number;
  cardFee: number;
  netValue: number;
  commissionPercent: number;
  commissionValue: number;
  serviceId: string | null;
  quantity: number;
  paymentMethod: string;
}

export default function Comissoes() {
  const [dateStart, setDateStart] = useState(() => {
    const d = startOfMonth(new Date());
    return format(d, "yyyy-MM-dd");
  });
  const [dateEnd, setDateEnd] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [selectedProfessional, setSelectedProfessional] = useState<string>("all");
  const [commissionStatus, setCommissionStatus] = useState<string>("all");
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  const { professionalId: currentProfessionalId, isProfessionalUser, isLoading: loadingCurrentProfessional } = useCurrentProfessional();
  const { professionals, isLoading: loadingProfessionals } = useProfessionals();

  // Auto-select the current professional's ID when they are a professional user
  useEffect(() => {
    if (isProfessionalUser && currentProfessionalId) {
      setSelectedProfessional(currentProfessionalId);
    }
  }, [isProfessionalUser, currentProfessionalId]);
  const { salonId, user, userRole, isMaster } = useAuth();
  const canManageAdjustments = !isProfessionalUser && (isMaster || userRole === "admin" || userRole === "manager");
  const canPayCommission = isMaster || !isProfessionalUser;
  const [adjustmentModalOpen, setAdjustmentModalOpen] = useState(false);
  const [adjustmentModalType, setAdjustmentModalType] = useState<AdjustmentType>("bonus");
  const [adjustmentToDelete, setAdjustmentToDelete] = useState<{ id: string; label: string } | null>(null);
  const [payConfirmOpen, setPayConfirmOpen] = useState(false);
  const [reverseConfirmOpen, setReverseConfirmOpen] = useState(false);
  const {
    adjustments: periodAdjustments,
    createAdjustment,
    deleteAdjustment,
    isCreating: isCreatingAdjustment,
    isDeleting: isDeletingAdjustment,
  } = useCommissionAdjustments({
    periodStart: dateStart,
    periodEnd: dateEnd,
    professionalId: selectedProfessional !== "all" ? selectedProfessional : undefined,
  });
  const { payments: commissionPayments, payCommissionAsync, isPaying, reverseCommission, isReversing } = useCommissionPayments();
  const { comandas, isLoading: loadingComandas } = useComandas();
  const { services, isLoading: loadingServices } = useServices();
  const { clients, isLoading: loadingClients } = useClients();
  const { settings: commissionSettings } = useCommissionSettings();

  // Load per-professional per-service commission overrides
  const { data: profServiceCommissions } = useQuery({
    queryKey: ["all-professional-commissions", salonId],
    queryFn: async () => {
      if (!salonId) return [];
      const { data, error } = await supabase
        .from("professional_service_commissions")
        .select("professional_id, service_id, commission_percent");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!salonId,
  });

  // Map: "profId:serviceId" → commission_percent
  const profServiceCommMap = useMemo(() => {
    const map = new Map<string, number>();
    (profServiceCommissions ?? []).forEach(c => {
      map.set(`${c.professional_id}:${c.service_id}`, c.commission_percent);
    });
    return map;
  }, [profServiceCommissions]);

  // Create client map for quick lookup
  const clientMap = useMemo(() => {
    const map = new Map<string, string>();
    clients.forEach(c => map.set(c.id, c.name));
    return map;
  }, [clients]);

  // Create service map for quick lookup
  const serviceMap = useMemo(() => {
    const map = new Map<string, { name: string; commission_percent: number }>();
    services.forEach(s => map.set(s.id, { name: s.name, commission_percent: s.commission_percent || 0 }));
    return map;
  }, [services]);

  // Filter closed comandas within date range - using created_at for proper date attribution
  const filteredComandas = useMemo(() => {
    const start = new Date(dateStart + "T00:00:00");
    const end = new Date(dateEnd + "T23:59:59.999");

    return comandas.filter(comanda => {
      // Only include closed comandas
      if (!comanda.closed_at) return false;
      // Use created_at for date filtering so retroactive closures appear in correct period
      const comandaDate = new Date(comanda.created_at);
      return isWithinInterval(comandaDate, { start, end });
    });
  }, [comandas, dateStart, dateEnd]);

  // Helper to calculate the proportional card fee for an item
  const calculateItemCardFee = (comanda: typeof filteredComandas[0], itemTotal: number): number => {
    const payments = comanda.payments || [];
    const comandaTotal = comanda.total || 0;
    if (comandaTotal === 0) return 0;

    // Sum up all card fees from payments
    const totalCardFees = payments.reduce((sum, p) => sum + (p.fee_amount || 0), 0);
    if (totalCardFees === 0) return 0;

    // Proportionally distribute the fee based on item's share of total
    return (itemTotal / comandaTotal) * totalCardFees;
  };

  // Get detailed commission items for selected professional
  const commissionDetails = useMemo(() => {
    if (selectedProfessional === "all") return [];

    const items: CommissionItem[] = [];
    const selectedProf = professionals.find(p => p.id === selectedProfessional);
    if (!selectedProf) return [];

    filteredComandas.forEach((comanda, idx) => {
      const comandaItems = comanda.items || [];

      comandaItems.forEach(item => {
        const profId = item.professional_id || comanda.professional_id;
        if (profId !== selectedProfessional) return;

        // Get service info and commission percent
        // Priority: package_commission > professional_service_commissions > services.commission_percent > professionals.commission_percent
        let serviceName = item.description || "Serviço";
        let commissionPercent = selectedProf.commission_percent || 0;

        // Package items use package_commission_percent from the professional
        if (item.item_type === "package") {
          commissionPercent = selectedProf.package_commission_percent || commissionPercent;
        } else if (item.service_id && serviceMap.has(item.service_id)) {
          const serviceInfo = serviceMap.get(item.service_id)!;
          serviceName = serviceInfo.name;
          commissionPercent = serviceInfo.commission_percent || commissionPercent;
        }

        // Override with per-professional per-service commission if configured (not for packages)
        if (item.item_type !== "package" && item.service_id && profId) {
          const profCommKey = `${profId}:${item.service_id}`;
          if (profServiceCommMap.has(profCommKey)) {
            commissionPercent = profServiceCommMap.get(profCommKey)!;
          }
        }

        const serviceValue = item.total_price || 0;
        const productCost = commissionSettings.service_cost_enabled ? (item.product_cost || 0) : 0;

        // Calculate proportional card fee for this item
        const cardFee = calculateItemCardFee(comanda, serviceValue);

        // Calculate admin fee if enabled
        const adminFee = commissionSettings.admin_fee_enabled
          ? serviceValue * (commissionSettings.admin_fee_percent / 100)
          : 0;

        // Net value and commission depend on product_cost_deduction setting
        let netValue: number;
        let commissionValue: number;
        if (commissionSettings.product_cost_deduction === "after_commission") {
          // Deduct product cost AFTER commission: commission on (service - fees), then subtract product cost
          netValue = serviceValue - cardFee - adminFee;
          commissionValue = (netValue * commissionPercent) / 100 - productCost;
        } else {
          // Default: deduct product cost BEFORE commission
          netValue = serviceValue - productCost - cardFee - adminFee;
          commissionValue = (netValue * commissionPercent) / 100;
        }

        // Use created_at for the date display to show when service was performed
        const displayDate = format(new Date(comanda.created_at), "dd/MM/yyyy");

        // Get primary payment method for this comanda
        const payments = comanda.payments || [];
        const primaryPayment = payments.length > 0 ? payments.reduce((a, b) => (a.amount > b.amount ? a : b)) : null;
        const PAYMENT_LABELS: Record<string, string> = {
          cash: "Dinheiro", credit_card: "Cartão Crédito", debit_card: "Cartão Débito",
          pix: "PIX", transfer: "Transferência", voucher: "Voucher", other: "Outro",
        };
        const paymentMethod = primaryPayment ? (PAYMENT_LABELS[primaryPayment.payment_method] || primaryPayment.payment_method) : "-";

        items.push({
          comandaId: comanda.id,
          comandaNumber: `Nº${comanda.comanda_number ? String(comanda.comanda_number).padStart(4, "0") : String(idx + 1).padStart(4, "0")} (${displayDate})`,
          date: displayDate,
          serviceName: `${item.quantity || 1} x ${serviceName}`,
          clientName: comanda.client_id ? clientMap.get(comanda.client_id) || "Cliente" : "Cliente avulso",
          serviceValue,
          productCost,
          cardFee,
          netValue,
          commissionPercent,
          commissionValue,
          serviceId: item.service_id,
          quantity: item.quantity || 1,
          paymentMethod,
        });
      });
    });

    return items;
  }, [selectedProfessional, filteredComandas, professionals, serviceMap, clientMap, profServiceCommMap, commissionSettings]);

  // Busca na lista do profissional selecionado (comanda, cliente/serviço, valor)
  const [detailSearch, setDetailSearch] = useState("");
  const filteredDetails = useMemo(() => {
    const q = detailSearch.trim().toLowerCase();
    if (!q) return commissionDetails;
    return commissionDetails.filter(it =>
      it.comandaNumber.toLowerCase().includes(q) ||
      it.clientName.toLowerCase().includes(q) ||
      it.serviceName.toLowerCase().includes(q) ||
      String(it.serviceValue).includes(q) ||
      Number(it.serviceValue).toFixed(2).includes(q) ||
      String(it.commissionValue).includes(q)
    );
  }, [commissionDetails, detailSearch]);

  // Calculate totals for selected professional
  const professionalTotals = useMemo(() => {
    const totalServices = commissionDetails.reduce((sum, item) => sum + item.serviceValue, 0);
    const totalProductCost = commissionDetails.reduce((sum, item) => sum + item.productCost, 0);
    const totalCardFee = commissionDetails.reduce((sum, item) => sum + item.cardFee, 0);
    const totalNetValue = commissionDetails.reduce((sum, item) => sum + item.netValue, 0);
    const totalCommission = commissionDetails.reduce((sum, item) => sum + item.commissionValue, 0);

    const totalBonus = periodAdjustments
      .filter(a => a.adjustment_type === "bonus")
      .reduce((sum, a) => sum + Number(a.amount), 0);
    const totalDiscount = periodAdjustments
      .filter(a => a.adjustment_type === "discount")
      .reduce((sum, a) => sum + Number(a.amount), 0);

    return {
      baseRateio: totalServices,
      servicos: totalServices,
      productCost: totalProductCost,
      cardFee: totalCardFee,
      netValue: totalNetValue,
      produtos: 0,
      pacotes: 0,
      rateioServicos: totalCommission,
      rateioProdutos: 0,
      rateioPacotes: 0,
      totalRateio: totalCommission,
      totalCaixinhas: 0,
      totalValePresente: 0,
      totalBonus,
      totalDiscount,
      descontosBonus: totalBonus - totalDiscount,
      totalPagar: totalCommission + totalBonus - totalDiscount,
    };
  }, [commissionDetails, periodAdjustments]);

  const openAdjustmentModal = (type: AdjustmentType) => {
    setAdjustmentModalType(type);
    setAdjustmentModalOpen(true);
  };

  const handleConfirmDeleteAdjustment = () => {
    if (!adjustmentToDelete) return;
    deleteAdjustment(adjustmentToDelete.id);
    setAdjustmentToDelete(null);
  };

  const currentPayment = useMemo(
    () =>
      commissionPayments.find(
        (p) =>
          p.professional_id === selectedProfessional &&
          p.period_start === dateStart &&
          p.period_end === dateEnd
      ) || null,
    [commissionPayments, selectedProfessional, dateStart, dateEnd]
  );

  const handlePayCommission = async () => {
    if (!selectedProfessionalData) return;
    await payCommissionAsync({
      professional_id: selectedProfessional,
      professional_name: selectedProfessionalData.name,
      period_start: dateStart,
      period_end: dateEnd,
      total_amount: professionalTotals.totalPagar,
      total_commission: professionalTotals.totalRateio,
      total_bonus: professionalTotals.totalBonus,
      total_discount: professionalTotals.totalDiscount,
    });
    setPayConfirmOpen(false);
    handlePrint();
  };

  // Group commission details by date for mobile view
  const dailyCommissions = useMemo(() => {
    const grouped = new Map<string, { items: CommissionItem[]; totalProduction: number; totalCommission: number }>();
    filteredDetails.forEach(item => {
      const existing = grouped.get(item.date);
      if (existing) {
        existing.items.push(item);
        existing.totalProduction += item.serviceValue;
        existing.totalCommission += item.commissionValue;
      } else {
        grouped.set(item.date, {
          items: [item],
          totalProduction: item.serviceValue,
          totalCommission: item.commissionValue,
        });
      }
    });
    return Array.from(grouped.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => {
        const [da, ma] = a.date.split("/").map(Number);
        const [db, mb] = b.date.split("/").map(Number);
        return mb - ma || db - da;
      });
  }, [filteredDetails]);

  const toggleDay = (date: string) => {
    setExpandedDays(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  // Calculate commissions per professional (for "all" view)
  const professionalCommissions = useMemo(() => {
    const commissionMap = new Map<string, {
      professional: typeof professionals[0];
      totalServices: number;
      productCost: number;
      cardFee: number;
      netValue: number;
      commission: number;
      discounts: number;
      totalToPay: number;
      itemCount: number;
    }>();

    professionals.forEach(prof => {
      commissionMap.set(prof.id, {
        professional: prof,
        totalServices: 0,
        productCost: 0,
        cardFee: 0,
        netValue: 0,
        commission: 0,
        discounts: 0,
        totalToPay: 0,
        itemCount: 0,
      });
    });

    filteredComandas.forEach(comanda => {
      const items = comanda.items || [];

      items.forEach(item => {
        const profId = item.professional_id || comanda.professional_id;
        if (!profId) return;

        const profData = commissionMap.get(profId);
        if (!profData) return;

        // Priority: package_commission > professional_service_commissions > services.commission_percent > professionals.commission_percent
        let commissionPercent = profData.professional.commission_percent || 0;

        if (item.item_type === "package") {
          commissionPercent = profData.professional.package_commission_percent || commissionPercent;
        } else if (item.service_id && serviceMap.has(item.service_id)) {
          commissionPercent = serviceMap.get(item.service_id)?.commission_percent || commissionPercent;
        }
        if (item.item_type !== "package" && item.service_id && profId) {
          const profCommKey = `${profId}:${item.service_id}`;
          if (profServiceCommMap.has(profCommKey)) {
            commissionPercent = profServiceCommMap.get(profCommKey)!;
          }
        }

        const itemTotal = item.total_price || 0;
        const productCost = commissionSettings.service_cost_enabled ? (item.product_cost || 0) : 0;

        // Calculate proportional card fee for this item
        const cardFee = calculateItemCardFee(comanda, itemTotal);

        // Calculate admin fee if enabled
        const adminFee = commissionSettings.admin_fee_enabled
          ? itemTotal * (commissionSettings.admin_fee_percent / 100)
          : 0;

        // Net value and commission depend on product_cost_deduction setting
        let netValue: number;
        let commission: number;
        if (commissionSettings.product_cost_deduction === "after_commission") {
          netValue = itemTotal - cardFee - adminFee;
          commission = (netValue * commissionPercent) / 100 - productCost;
        } else {
          netValue = itemTotal - productCost - cardFee - adminFee;
          commission = (netValue * commissionPercent) / 100;
        }

        profData.totalServices += itemTotal;
        profData.productCost += productCost;
        profData.cardFee += cardFee;
        profData.netValue += netValue;
        profData.commission += commission;
        profData.totalToPay += commission;
        profData.itemCount += 1;
      });
    });

    return Array.from(commissionMap.values()).filter(c => c.itemCount > 0);
  }, [professionals, filteredComandas, serviceMap, profServiceCommMap, commissionSettings]);

  // Ajustes (bônus - desconto) por profissional no período (para o resumo geral)
  const adjustmentsByProf = useMemo(() => {
    const m = new Map<string, number>();
    periodAdjustments.forEach(a => {
      const cur = m.get(a.professional_id) || 0;
      m.set(a.professional_id, cur + (a.adjustment_type === "bonus" ? Number(a.amount) : -Number(a.amount)));
    });
    return m;
  }, [periodAdjustments]);

  // Seleção de profissionais (ticar) na lista geral
  const [selectedProfs, setSelectedProfs] = useState<Set<string>>(new Set());
  const toggleProf = (id: string) =>
    setSelectedProfs(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  const allSelected = professionalCommissions.length > 0 && professionalCommissions.every(c => selectedProfs.has(c.professional.id));
  const toggleAllProfs = () =>
    setSelectedProfs(allSelected ? new Set() : new Set(professionalCommissions.map(c => c.professional.id)));

  const selectedSummary = useMemo(() => {
    const rows = professionalCommissions.filter(c => selectedProfs.has(c.professional.id));
    const totalServices = rows.reduce((s, c) => s + c.totalServices, 0);
    const totalCommission = rows.reduce((s, c) => s + c.totalToPay, 0);
    const totalAdj = rows.reduce((s, c) => s + (adjustmentsByProf.get(c.professional.id) || 0), 0);
    return { count: rows.length, totalServices, totalCommission, totalAdj, totalPay: totalCommission + totalAdj };
  }, [professionalCommissions, selectedProfs, adjustmentsByProf]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
  };

  const getInitials = (name: string) => {
    return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  };

  const SPECIALTY_LABELS: Record<string, string> = {
    cabeleireiro: "Cabeleireiro(a)",
    manicure: "Manicure",
    esteticista: "Esteticista",
    maquiador: "Maquiador(a)",
    barbeiro: "Barbeiro",
    depilador: "Depilador(a)",
    massagista: "Massagista",
    recepcionista: "Recepcionista",
    gerente: "Gerente",
    outro: "Outro",
  };

  const getSpecialtyLabel = (role: string | null | undefined) => {
    if (!role) return null;
    return SPECIALTY_LABELS[role] || role;
  };

  const selectedProfessionalData = professionals.find(p => p.id === selectedProfessional);

  const isLoading = loadingProfessionals || loadingComandas || loadingServices || loadingClients || (isProfessionalUser && loadingCurrentProfessional);

  const generateCommissionPDF = () => {
    if (!selectedProfessionalData) return;
    const doc = new jsPDF({ orientation: "landscape" });
    const profName = selectedProfessionalData.name;
    const periodo = `${dateStart.split("-").reverse().join("/")} a ${dateEnd.split("-").reverse().join("/")}`;

    // Header
    doc.setFontSize(16);
    doc.text("Relatório de Comissão", 14, 15);
    doc.setFontSize(11);
    doc.text(`Profissional: ${profName}`, 14, 23);
    doc.text(`Período: ${periodo}`, 14, 29);

    // Table
    autoTable(doc, {
      startY: 35,
      head: [["Comanda", "Data", "Serviço", "Cliente", "Valor", "Custo Prod.", "Taxa Cartão", "Líquido", "%", "Comissão"]],
      body: commissionDetails.map(item => [
        item.comandaNumber,
        item.date,
        item.serviceName,
        item.clientName,
        formatCurrency(item.serviceValue),
        item.productCost > 0 ? `-${formatCurrency(item.productCost)}` : "-",
        item.cardFee > 0 ? `-${formatCurrency(item.cardFee)}` : "-",
        formatCurrency(item.netValue),
        `${item.commissionPercent}%`,
        formatCurrency(item.commissionValue),
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [234, 88, 12] },
      columnStyles: {
        4: { halign: "right" },
        5: { halign: "right" },
        6: { halign: "right" },
        7: { halign: "right" },
        9: { halign: "right" },
      },
    });

    // Ajustes do período (bônus e descontos)
    if (periodAdjustments.length > 0) {
      autoTable(doc, {
        startY: ((doc as any).lastAutoTable?.finalY || 150) + 8,
        head: [["Ajustes do período", "Data", "Tipo", "Motivo", "Valor"]],
        body: periodAdjustments.map(a => [
          "",
          format(new Date(a.adjustment_date + "T00:00:00"), "dd/MM/yyyy"),
          a.adjustment_type === "bonus" ? "Bônus" : "Desconto",
          a.description || "-",
          `${a.adjustment_type === "bonus" ? "+" : "-"}${formatCurrency(Number(a.amount))}`,
        ]),
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [234, 88, 12] },
        columnStyles: { 4: { halign: "right" } },
      });
    }

    // Summary
    const finalY = (doc as any).lastAutoTable?.finalY || 150;
    const summaryY = finalY + 10;
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("Resumo", 14, summaryY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const lines = [
      [`Base de Rateio (Serviços):`, formatCurrency(professionalTotals.baseRateio)],
      ...(professionalTotals.productCost > 0 ? [[`(-) Custo de Produtos:`, `-${formatCurrency(professionalTotals.productCost)}`]] : []),
      ...(professionalTotals.cardFee > 0 ? [[`(-) Taxa de Cartão:`, `-${formatCurrency(professionalTotals.cardFee)}`]] : []),
      [`Valor Líquido:`, formatCurrency(professionalTotals.netValue)],
      [`Comissão:`, formatCurrency(professionalTotals.totalRateio)],
      ...(professionalTotals.totalBonus > 0 ? [[`(+) Bônus:`, `+${formatCurrency(professionalTotals.totalBonus)}`]] : []),
      ...(professionalTotals.totalDiscount > 0 ? [[`(-) Descontos:`, `-${formatCurrency(professionalTotals.totalDiscount)}`]] : []),
    ];
    lines.forEach(([label, value], i) => {
      doc.text(label, 14, summaryY + 7 + i * 5);
      doc.text(value, 100, summaryY + 7 + i * 5, { align: "right" });
    });

    // Total
    const totalY = summaryY + 7 + lines.length * 5 + 3;
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Total a pagar:", 14, totalY);
    doc.text(formatCurrency(professionalTotals.totalPagar), 100, totalY, { align: "right" });

    // Recibo + assinatura
    const reciboY = totalY + 16;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("RECIBO", 14, reciboY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const reciboText = `Declaro que recebi a importância de ${formatCurrency(professionalTotals.totalPagar)} referente à comissão do período de ${periodo}, e que estou de acordo com os valores apresentados neste relatório.`;
    const reciboLines = doc.splitTextToSize(reciboText, 180);
    doc.text(reciboLines, 14, reciboY + 7);

    const signY = reciboY + 7 + reciboLines.length * 5 + 22;
    doc.line(14, signY, 110, signY);
    doc.setFont("helvetica", "bold");
    doc.text(profName, 14, signY + 5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("Assinatura do profissional", 14, signY + 10);
    doc.text("Data: ____ / ____ / ________", 140, signY);

    return doc;
  };

  const handlePrint = () => {
    const doc = generateCommissionPDF();
    if (!doc) return;
    // Open in new window for printing
    const blob = doc.output("blob");
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (win) {
      win.addEventListener("load", () => {
        win.print();
      });
    }
  };

  const handlePDF = () => {
    const doc = generateCommissionPDF();
    if (!doc) return;
    const profName = selectedProfessionalData?.name?.replace(/\s+/g, "_") || "profissional";
    const periodo = `${dateStart}_${dateEnd}`;
    doc.save(`Comissao_${profName}_${periodo}.pdf`);
  };

  if (isLoading) {
    return (
      <AppLayoutNew>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayoutNew>
    );
  }

  return (
    <AppLayoutNew>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Comissões</h1>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="space-y-2">
                <Label>Data Início:</Label>
                <Input 
                  type="date" 
                  value={dateStart} 
                  onChange={e => setDateStart(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Data Fim:</Label>
                <Input 
                  type="date" 
                  value={dateEnd} 
                  onChange={e => setDateEnd(e.target.value)}
                />
              </div>
              {!isProfessionalUser && (
                <div className="space-y-2">
                  <Label>Profissionais:</Label>
                  <Select value={selectedProfessional} onValueChange={setSelectedProfessional}>
                    <SelectTrigger>
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      {professionals.filter(p => p.is_active).map(prof => (
                        <SelectItem key={prof.id} value={prof.id}>
                          {prof.name} {(prof as any).role ? `- ${getSpecialtyLabel((prof as any).role)}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label>Comissões:</Label>
                <Select value={commissionStatus} onValueChange={setCommissionStatus}>
                  <SelectTrigger>
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    <SelectItem value="unpaid">Não pagas</SelectItem>
                    <SelectItem value="paid">Pagas</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 flex items-end">
                <Button className="gap-2 w-full">
                  <Search className="h-4 w-4" />
                  Buscar
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Show detailed view when professional is selected */}
        {selectedProfessional !== "all" && selectedProfessionalData ? (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Detailed Table */}
            <div className="lg:col-span-3 space-y-4">
              {/* Professional Header */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <Avatar className="h-12 w-12">
                      <AvatarImage src={selectedProfessionalData.avatar_url || undefined} />
                      <AvatarFallback className="bg-primary/10 text-primary">
                        {getInitials(selectedProfessionalData.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <h2 className="text-xl font-semibold">{selectedProfessionalData.name}</h2>
                      <p className="text-sm text-muted-foreground">
                        {getSpecialtyLabel((selectedProfessionalData as any).role) || "Profissional"} • {commissionDetails.length} serviço{commissionDetails.length !== 1 ? "s" : ""} no período
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Report Actions */}
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  Relatório de comissão
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handlePrint}>
                    <Printer className="h-4 w-4 mr-2" />
                    Imprimir
                  </Button>
                  <Button variant="outline" size="sm" onClick={handlePDF}>
                    <FileText className="h-4 w-4 mr-2" />
                    PDF
                  </Button>
                </div>
              </div>

              {/* Busca na lista do profissional */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por comanda, cliente ou valor..."
                  value={detailSearch}
                  onChange={(e) => setDetailSearch(e.target.value)}
                  className="pl-9"
                />
              </div>

              {/* Desktop: Detailed Services Table */}
              <div className="hidden md:block">
                <Card>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Comanda</TableHead>
                          <TableHead>Data</TableHead>
                          <TableHead>Serviços e Produtos</TableHead>
                          <TableHead>Cliente</TableHead>
                          <TableHead className="text-right">Valor</TableHead>
                          <TableHead className="text-right">Custo Prod.</TableHead>
                          <TableHead className="text-right">Taxa Cartão</TableHead>
                          <TableHead className="text-right">Líquido</TableHead>
                          <TableHead className="text-right">Comissão</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredDetails.map((item, idx) => (
                          <TableRow key={`${item.comandaId}-${idx}`}>
                            <TableCell className="font-mono text-sm">{item.comandaNumber}</TableCell>
                            <TableCell>{item.date}</TableCell>
                            <TableCell>{item.serviceName}</TableCell>
                            <TableCell>{item.clientName}</TableCell>
                            <TableCell className="text-right">{formatCurrency(item.serviceValue)}</TableCell>
                            <TableCell className="text-right text-destructive">
                              {item.productCost > 0 ? `-${formatCurrency(item.productCost)}` : "-"}
                            </TableCell>
                            <TableCell className="text-right text-destructive">
                              {item.cardFee > 0 ? `-${formatCurrency(item.cardFee)}` : "-"}
                            </TableCell>
                            <TableCell className="text-right">{formatCurrency(item.netValue)}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                <Badge variant="secondary">{item.commissionPercent}%</Badge>
                                <span className="font-medium text-primary">{formatCurrency(item.commissionValue)}</span>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                        {filteredDetails.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                              {detailSearch ? "Nenhum resultado pra essa busca" : "Nenhum serviço encontrado no período"}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>

              {/* Mobile: Daily cards with expandable details */}
              <div className="md:hidden space-y-3">
                {dailyCommissions.length === 0 ? (
                  <Card>
                    <CardContent className="py-8 text-center text-muted-foreground text-sm">
                      Nenhum serviço encontrado no período
                    </CardContent>
                  </Card>
                ) : (
                  dailyCommissions.map(day => (
                    <Card key={day.date}>
                      <CardContent className="p-0">
                        <button
                          type="button"
                          className="w-full flex items-center gap-4 p-4"
                          onClick={() => toggleDay(day.date)}
                        >
                          <span className="text-primary font-semibold text-lg">{day.date.slice(0, 5)}</span>
                          <div className="border-l-2 border-primary/40 pl-4">
                            <p className="text-xs text-muted-foreground font-medium uppercase">produção</p>
                            <p className="font-semibold">{formatCurrency(day.totalProduction)}</p>
                          </div>
                          <div className="border-l-2 border-primary/40 pl-4">
                            <p className="text-xs text-muted-foreground font-medium uppercase">rateio</p>
                            <p className="font-semibold">{formatCurrency(day.totalCommission)}</p>
                          </div>
                          <div className="ml-auto">
                            {expandedDays.has(day.date) ? (
                              <ChevronUp className="h-5 w-5 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-5 w-5 text-muted-foreground" />
                            )}
                          </div>
                        </button>

                        {expandedDays.has(day.date) && (
                          <div className="px-4 pb-4 space-y-3">
                            {day.items.map((item, idx) => (
                              <div key={`${item.comandaId}-${idx}`} className="border rounded-lg p-3 bg-muted/30 text-sm space-y-1">
                                <p className="font-semibold text-primary">{item.comandaNumber.split(" (")[0]} {item.date}</p>
                                <p><span className="font-medium">Item:</span> {item.serviceName}</p>
                                <p><span className="font-medium">Cliente:</span> {item.clientName}</p>
                                <p><span className="font-medium">Valor:</span> {formatCurrency(item.serviceValue)}</p>
                                <p><span className="font-medium">Tipo de Pagamento:</span> {item.paymentMethod}</p>
                                {item.productCost > 0 && (
                                  <p className="text-destructive"><span className="font-medium">Custo de Produto:</span> -{formatCurrency(item.productCost)}</p>
                                )}
                                <p className="text-primary font-medium">
                                  Comissão: {formatCurrency(item.commissionValue)} ({item.commissionPercent}%)
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </div>

            {/* Summary Card */}
            <div className="lg:col-span-1">
              <Card className="sticky top-4">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Resumo</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Base de Rateio Geral */}
                  <div className="pb-3 border-b">
                    <div className="flex justify-between font-medium mb-2">
                      <span>Base de Rateio (Valor dos Serviços):</span>
                      <span>{formatCurrency(professionalTotals.baseRateio)}</span>
                    </div>
                    <div className="space-y-1 text-sm text-muted-foreground">
                      <div className="flex justify-between">
                        <span>Serviços:</span>
                        <span>{formatCurrency(professionalTotals.servicos)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Product Cost Deduction */}
                  {professionalTotals.productCost > 0 && (
                    <div className="pb-3 border-b">
                      <div className="flex justify-between font-medium mb-2 text-destructive">
                        <span>(-) Custo de Produtos:</span>
                        <span>-{formatCurrency(professionalTotals.productCost)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Produtos consumidos nos serviços realizados
                      </p>
                    </div>
                  )}

                  {/* Card Fee Deduction */}
                  {professionalTotals.cardFee > 0 && (
                    <div className="pb-3 border-b">
                      <div className="flex justify-between font-medium mb-2 text-destructive">
                        <span>(-) Taxa de Cartão:</span>
                        <span>-{formatCurrency(professionalTotals.cardFee)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Taxa proporcional das bandeiras de cartão
                      </p>
                    </div>
                  )}

                  {/* Net Value */}
                  <div className="pb-3 border-b">
                    <div className="flex justify-between font-medium mb-2">
                      <span>Valor Líquido (Base para Comissão):</span>
                      <span>{formatCurrency(professionalTotals.netValue)}</span>
                    </div>
                  </div>

                  {/* Rateio */}
                  <div className="pb-3 border-b">
                    <div className="flex justify-between font-medium mb-2">
                      <span>Rateio (Comissão):</span>
                      <span>{formatCurrency(professionalTotals.totalRateio)}</span>
                    </div>
                    <div className="space-y-1 text-sm text-muted-foreground">
                      <div className="flex justify-between">
                        <span>Comissão sobre Serviços:</span>
                        <span>{formatCurrency(professionalTotals.rateioServicos)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Ajustes (Bônus e Descontos) com motivo inline */}
                  <div className="pb-3 border-b space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Ajustes do período</span>
                      {canManageAdjustments && (
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-green-700 hover:bg-green-50"
                            onClick={() => openAdjustmentModal("bonus")}
                            aria-label="Adicionar bônus"
                            title="Adicionar bônus"
                          >
                            <Gift className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:bg-destructive/10"
                            onClick={() => openAdjustmentModal("discount")}
                            aria-label="Adicionar desconto"
                            title="Adicionar desconto"
                          >
                            <MinusCircle className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>

                    {periodAdjustments.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">
                        Nenhum bônus ou desconto registrado.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {periodAdjustments.map(adj => {
                          const isBonus = adj.adjustment_type === "bonus";
                          return (
                            <div key={adj.id} className="flex items-start gap-2 text-xs">
                              <span className={`shrink-0 ${isBonus ? "text-green-700" : "text-destructive"}`}>
                                {isBonus ? <Gift className="h-3.5 w-3.5" /> : <MinusCircle className="h-3.5 w-3.5" />}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="truncate font-medium" title={adj.description}>
                                  {adj.description || (isBonus ? "Bônus" : "Desconto")}
                                </p>
                                <p className="text-[10px] text-muted-foreground">
                                  {format(new Date(adj.adjustment_date + "T00:00:00"), "dd/MM/yyyy", { locale: ptBR })}
                                </p>
                              </div>
                              <span className={`shrink-0 font-semibold ${isBonus ? "text-green-700" : "text-destructive"}`}>
                                {isBonus ? "+" : "-"}{formatCurrency(Number(adj.amount))}
                              </span>
                              {canManageAdjustments && (
                                <button
                                  type="button"
                                  className="shrink-0 text-muted-foreground hover:text-destructive"
                                  onClick={() =>
                                    setAdjustmentToDelete({
                                      id: adj.id,
                                      label: `${isBonus ? "bônus" : "desconto"} de ${formatCurrency(Number(adj.amount))}`,
                                    })
                                  }
                                  aria-label="Remover ajuste"
                                  title="Remover"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {(professionalTotals.totalBonus > 0 || professionalTotals.totalDiscount > 0) && (
                      <div className="flex justify-between text-sm pt-2 border-t border-dashed">
                        <span className="text-muted-foreground">Líquido dos ajustes:</span>
                        <span className={professionalTotals.descontosBonus > 0 ? "text-green-700 font-semibold" : professionalTotals.descontosBonus < 0 ? "text-destructive font-semibold" : ""}>
                          {professionalTotals.descontosBonus > 0 ? "+" : ""}{formatCurrency(professionalTotals.descontosBonus)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Total */}
                  <div className="pt-2">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold flex items-center gap-2">
                        Total a pagar:
                        {currentPayment && <Badge className="bg-emerald-600 hover:bg-emerald-600">PAGO</Badge>}
                      </span>
                      <span className="text-2xl font-bold text-primary">
                        {formatCurrency(professionalTotals.totalPagar)}
                      </span>
                    </div>
                  </div>

                  {currentPayment ? (
                    <div className="mt-4 space-y-2">
                      <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-center">
                        <p className="text-sm font-semibold text-emerald-700">
                          ✓ Comissão paga em {format(new Date(currentPayment.paid_at), "dd/MM/yyyy")}
                        </p>
                        <p className="text-xs text-emerald-600">{formatCurrency(Number(currentPayment.total_amount))}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" className="flex-1 gap-2" onClick={handlePrint}>
                          <Printer className="h-4 w-4" /> Recibo
                        </Button>
                        <Button variant="outline" className="flex-1 gap-2" onClick={handlePDF}>
                          <FileText className="h-4 w-4" /> PDF
                        </Button>
                      </div>
                      {canPayCommission && (
                        <Button
                          variant="ghost"
                          className="w-full text-destructive text-xs h-8"
                          onClick={() => setReverseConfirmOpen(true)}
                          disabled={isReversing}
                        >
                          Estornar pagamento
                        </Button>
                      )}
                    </div>
                  ) : (
                    <Button
                      className="w-full gap-2 mt-4"
                      disabled={professionalTotals.totalPagar <= 0 || isPaying || !canPayCommission}
                      onClick={() => setPayConfirmOpen(true)}
                    >
                      {isPaying ? <Loader2 className="h-4 w-4 animate-spin" /> : <DollarSign className="h-4 w-4" />}
                      Pagar Comissão
                    </Button>
                  )}

                  <button className="w-full text-sm text-primary hover:underline flex items-center justify-center gap-1">
                    Solicitar Recalculo
                    <span className="text-muted-foreground">ℹ</span>
                  </button>
                </CardContent>
              </Card>
            </div>
          </div>
        ) : (
          /* Show all professionals summary when none selected */
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            <div className="lg:col-span-3">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Selecione um profissional para ver o relatório detalhado</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox checked={allSelected} onCheckedChange={toggleAllProfs} aria-label="Selecionar todos" />
                        </TableHead>
                        <TableHead>Profissional</TableHead>
                        <TableHead>Cargo</TableHead>
                        <TableHead className="text-right">Serviços</TableHead>
                        <TableHead className="text-right">Total Serviços</TableHead>
                        <TableHead className="text-right">Comissão</TableHead>
                        <TableHead className="text-right">Ajustes</TableHead>
                        <TableHead className="text-right">Total a pagar</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {professionalCommissions.map((item) => {
                        const adjNet = adjustmentsByProf.get(item.professional.id) || 0;
                        return (
                        <TableRow
                          key={item.professional.id}
                          className={`cursor-pointer hover:bg-muted/50 ${selectedProfs.has(item.professional.id) ? "bg-primary/5" : ""}`}
                          onClick={() => setSelectedProfessional(item.professional.id)}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selectedProfs.has(item.professional.id)}
                              onCheckedChange={() => toggleProf(item.professional.id)}
                              aria-label={`Selecionar ${item.professional.name}`}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <Avatar className="h-8 w-8">
                                <AvatarImage src={item.professional.avatar_url || undefined} />
                                <AvatarFallback className="text-xs bg-primary/10 text-primary">
                                  {getInitials(item.professional.name)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="font-medium">{item.professional.name}</span>
                            </div>
                          </TableCell>
                          <TableCell>{item.professional.role || "-"}</TableCell>
                          <TableCell className="text-right">{item.itemCount}</TableCell>
                          <TableCell className="text-right">{formatCurrency(item.totalServices)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(item.totalToPay)}</TableCell>
                          <TableCell className={`text-right ${adjNet > 0 ? "text-green-700" : adjNet < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                            {adjNet === 0 ? "—" : `${adjNet > 0 ? "+" : ""}${formatCurrency(adjNet)}`}
                          </TableCell>
                          <TableCell className="text-right font-bold text-primary">
                            {formatCurrency(item.totalToPay + adjNet)}
                          </TableCell>
                        </TableRow>
                        );
                      })}
                      {professionalCommissions.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                            Nenhum profissional com comissões no período
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>

            {/* Summary Card */}
            <div className="lg:col-span-1">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Resumo Geral</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total Serviços:</span>
                    <span className="font-medium">
                      {formatCurrency(professionalCommissions.reduce((sum, c) => sum + c.totalServices, 0))}
                    </span>
                  </div>
                  <div className="border-t pt-4">
                    <div className="flex justify-between">
                      <span className="font-medium">Total a pagar (todos):</span>
                      <span className="text-xl font-bold text-primary">
                        {formatCurrency(professionalCommissions.reduce((sum, c) => sum + c.totalToPay + (adjustmentsByProf.get(c.professional.id) || 0), 0))}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">Já com bônus e descontos do período.</p>
                  </div>

                  {selectedSummary.count > 0 && (
                    <div className="border-t pt-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">Selecionados ({selectedSummary.count})</span>
                        <button className="text-xs text-muted-foreground hover:underline" onClick={() => setSelectedProfs(new Set())}>limpar</button>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Comissão:</span>
                        <span>{formatCurrency(selectedSummary.totalCommission)}</span>
                      </div>
                      {selectedSummary.totalAdj !== 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Ajustes:</span>
                          <span className={selectedSummary.totalAdj > 0 ? "text-green-700" : "text-destructive"}>
                            {selectedSummary.totalAdj > 0 ? "+" : ""}{formatCurrency(selectedSummary.totalAdj)}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between pt-1 border-t">
                        <span className="font-semibold">Total selecionados:</span>
                        <span className="text-lg font-bold text-primary">{formatCurrency(selectedSummary.totalPay)}</span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>

      <CommissionAdjustmentModal
        open={adjustmentModalOpen}
        onOpenChange={setAdjustmentModalOpen}
        type={adjustmentModalType}
        professionalId={selectedProfessional}
        professionalName={selectedProfessionalData?.name || ""}
        createdByName={user?.email || null}
        onSubmit={createAdjustment}
        isSubmitting={isCreatingAdjustment}
      />

      <AlertDialog open={!!adjustmentToDelete} onOpenChange={(o) => { if (!o) setAdjustmentToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover ajuste?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja remover o {adjustmentToDelete?.label}? O total a pagar será recalculado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingAdjustment}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleConfirmDeleteAdjustment(); }}
              disabled={isDeletingAdjustment}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingAdjustment ? "Removendo..." : "Remover"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={payConfirmOpen} onOpenChange={setPayConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar pagamento de comissão</AlertDialogTitle>
            <AlertDialogDescription>
              Registrar o pagamento de <strong>{formatCurrency(professionalTotals.totalPagar)}</strong> para{" "}
              <strong>{selectedProfessionalData?.name}</strong> referente ao período de{" "}
              {dateStart.split("-").reverse().join("/")} a {dateEnd.split("-").reverse().join("/")}?
              <br /><br />
              Isso lança a despesa no financeiro, marca o mês como pago e gera o recibo pra impressão e assinatura.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPaying}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); handlePayCommission(); }} disabled={isPaying}>
              {isPaying ? "Registrando..." : "Confirmar e gerar recibo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={reverseConfirmOpen} onOpenChange={setReverseConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Estornar pagamento?</AlertDialogTitle>
            <AlertDialogDescription>
              O registro do pagamento e a despesa no financeiro serão removidos. O mês volta a aparecer como não pago.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isReversing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (currentPayment) reverseCommission(currentPayment); setReverseConfirmOpen(false); }}
              disabled={isReversing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isReversing ? "Estornando..." : "Estornar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayoutNew>
  );
}
