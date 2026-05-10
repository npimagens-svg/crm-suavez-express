import { useState, useEffect } from "react";
import { useSearchParams, useLocation } from "react-router-dom";
import { AppLayoutNew } from "@/components/layout/AppLayoutNew";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Loader2, CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { useCaixas, Caixa } from "@/hooks/useCaixas";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrentUserPermissions } from "@/hooks/useCurrentUserPermissions";
import { CaixaCard } from "@/components/caixa/CaixaCard";
import { OpenCaixaModal } from "@/components/caixa/OpenCaixaModal";
import { CloseCaixaModal } from "@/components/caixa/CloseCaixaModal";
import { EditCaixaModal } from "@/components/caixa/EditCaixaModal";
import { CaixaDetailModal } from "@/components/caixa/CaixaDetailModal";
import { PaymentByProviderReport } from "@/components/financeiro/PaymentByProviderReport";
import { format, isSameDay, getDaysInMonth, startOfMonth, setDate } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

export default function Financeiro() {
  const location = useLocation();
  const [openCaixaModalOpen, setOpenCaixaModalOpen] = useState(false);
  const [closeCaixaModalOpen, setCloseCaixaModalOpen] = useState(false);
  const [editCaixaModalOpen, setEditCaixaModalOpen] = useState(false);
  const [detailCaixaModalOpen, setDetailCaixaModalOpen] = useState(false);
  const [selectedCaixa, setSelectedCaixa] = useState<Caixa | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [userOpenCaixa, setUserOpenCaixa] = useState<Caixa | null>(null);

  const { user } = useAuth();
  const { isMaster, hasPermission } = useCurrentUserPermissions();
  const canViewAllCaixas = isMaster || hasPermission("caixas.view_others");
  const {
    caixas,
    openCaixas: allOpenCaixas,
    closedCaixas: allClosedCaixas,
    isLoading,
    openCaixa,
    closeCaixa,
    reopenCaixa,
    updateCaixa,
    getCurrentUserOpenCaixa,
    recalculateCaixaTotals,
    isOpening,
    isClosing,
    isReopening,
    isUpdating,
    isRecalculating,
  } = useCaixas();

  // Filter caixas: normal users only see their own, managers/master see all
  const openCaixas = canViewAllCaixas
    ? allOpenCaixas
    : allOpenCaixas.filter(c => c.user_id === user?.id);
  const closedCaixas = canViewAllCaixas
    ? allClosedCaixas
    : allClosedCaixas.filter(c => c.user_id === user?.id);

  // Determine active tab from URL
  const isHistorico = location.pathname.includes("/historico");
  const isPorGateway = location.pathname.includes("/por-gateway");

  // Check if user has open caixa
  useEffect(() => {
    const checkUserCaixa = async () => {
      const caixa = await getCurrentUserOpenCaixa();
      setUserOpenCaixa(caixa);
    };
    checkUserCaixa();
  }, [caixas]);

  const handleOpenCaixa = (openingBalance: number, notes?: string) => {
    openCaixa({ opening_balance: openingBalance, notes }, {
      onSuccess: () => {
        setOpenCaixaModalOpen(false);
      }
    });
  };

  const handleCloseCaixa = (closingBalance: number, notes?: string) => {
    if (!selectedCaixa) return;
    closeCaixa({ caixaId: selectedCaixa.id, closingBalance, notes });
  };

  const handleOpenCloseModal = (caixa: Caixa) => {
    setSelectedCaixa(caixa);
    setCloseCaixaModalOpen(true);
  };

  const handleOpenEditModal = (caixa: Caixa) => {
    setSelectedCaixa(caixa);
    setEditCaixaModalOpen(true);
  };

  const handleReopenCaixa = (caixa: Caixa) => {
    reopenCaixa(caixa.id);
  };

  // Group closed caixas by date for history
  const caixasByDate = closedCaixas.filter(c => 
    isSameDay(new Date(c.opened_at), selectedDate)
  );

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
      <div className="space-y-4">
        {isPorGateway ? (
          // Por Gateway Tab
          <PaymentByProviderReport />
        ) : !isHistorico ? (
          // Caixas Abertos Tab
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold">Caixas Abertos</h2>
                <Badge variant="outline" className="px-3">
                  {openCaixas.length} aberto{openCaixas.length !== 1 ? "s" : ""}
                </Badge>
              </div>
              <Button 
                className="gap-2" 
                onClick={() => setOpenCaixaModalOpen(true)}
                disabled={!!userOpenCaixa}
              >
                <Plus className="h-4 w-4" />
                Abrir Meu Caixa
              </Button>
            </div>

            {openCaixas.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  Nenhum caixa aberto no momento
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {userOpenCaixa && (
                  <div className="ring-2 ring-primary rounded-lg">
                    <CaixaCard
                      key={userOpenCaixa.id}
                      caixa={userOpenCaixa}
                      showCloseButton
                      onClose={() => handleOpenCloseModal(userOpenCaixa)}
                      onRecalculate={canViewAllCaixas ? () => recalculateCaixaTotals(userOpenCaixa.id) : undefined}
                      isRecalculating={isRecalculating}
                      label="Seu Caixa"
                    />
                  </div>
                )}
                {openCaixas
                  .filter(c => c.id !== userOpenCaixa?.id)
                  .map((caixa) => (
                    <CaixaCard
                      key={caixa.id}
                      caixa={caixa}
                      showCloseButton={canViewAllCaixas}
                      showEditButton={canViewAllCaixas}
                      onClose={() => handleOpenCloseModal(caixa)}
                      onEdit={() => handleOpenEditModal(caixa)}
                      onRecalculate={canViewAllCaixas ? () => recalculateCaixaTotals(caixa.id) : undefined}
                      isRecalculating={isRecalculating}
                    />
                  ))}
              </div>
            )}
          </>
        ) : (
          // Histórico de Caixas Tab
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Histórico de Caixas</h2>
            </div>

            <div className="space-y-4">
              {/* Date Selector */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => {
                          const newDate = new Date(selectedDate);
                          newDate.setDate(newDate.getDate() - 1);
                          setSelectedDate(newDate);
                        }}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      
                      {/* Day Selector */}
                      <Select
                        value={selectedDate.getDate().toString()}
                        onValueChange={(value) => {
                          const newDate = setDate(selectedDate, parseInt(value));
                          setSelectedDate(newDate);
                        }}
                      >
                        <SelectTrigger className="w-[70px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: getDaysInMonth(selectedDate) }, (_, i) => (
                            <SelectItem key={i + 1} value={(i + 1).toString()}>
                              {String(i + 1).padStart(2, "0")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {/* Month Selector */}
                      <Select
                        value={selectedDate.getMonth().toString()}
                        onValueChange={(value) => {
                          const newDate = new Date(selectedDate);
                          newDate.setMonth(parseInt(value));
                          setSelectedDate(newDate);
                        }}
                      >
                        <SelectTrigger className="w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 12 }, (_, i) => (
                            <SelectItem key={i} value={i.toString()}>
                              {format(new Date(2024, i, 1), "MMMM", { locale: ptBR })}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      
                      {/* Year Selector */}
                      <Select
                        value={selectedDate.getFullYear().toString()}
                        onValueChange={(value) => {
                          const newDate = new Date(selectedDate);
                          newDate.setFullYear(parseInt(value));
                          setSelectedDate(newDate);
                        }}
                      >
                        <SelectTrigger className="w-[100px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 5 }, (_, i) => {
                            const year = new Date().getFullYear() - 2 + i;
                            return (
                              <SelectItem key={year} value={year.toString()}>
                                {year}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                      
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => {
                          const newDate = new Date(selectedDate);
                          newDate.setDate(newDate.getDate() + 1);
                          setSelectedDate(newDate);
                        }}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedDate(new Date())}
                    >
                      Hoje
                    </Button>

                    <Badge variant="outline" className="ml-auto">
                      {caixasByDate.length} caixa{caixasByDate.length !== 1 ? "s" : ""} encontrado{caixasByDate.length !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              {/* Selected Date Display */}
              <div className="flex items-center gap-2 text-lg font-medium capitalize">
                <CalendarIcon className="h-5 w-5 text-primary" />
                {format(selectedDate, "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
              </div>

              {/* Caixas List */}
              {caixasByDate.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground">
                    Nenhum caixa fechado nesta data
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {caixasByDate.map((caixa) => (
                    <CaixaCard 
                      key={caixa.id} 
                      caixa={caixa}
                      showEditButton={true}
                      showReopenButton={true}
                      onEdit={() => handleOpenEditModal(caixa)}
                      onReopen={() => handleReopenCaixa(caixa)}
                      onView={() => { setSelectedCaixa(caixa); setDetailCaixaModalOpen(true); }}
                      onRecalculate={canViewAllCaixas ? () => recalculateCaixaTotals(caixa.id) : undefined}
                      isRecalculating={isRecalculating}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Modals */}
      <OpenCaixaModal
        open={openCaixaModalOpen}
        onClose={() => setOpenCaixaModalOpen(false)}
        onConfirm={handleOpenCaixa}
        isLoading={isOpening}
      />

      <CloseCaixaModal
        open={closeCaixaModalOpen}
        onClose={() => {
          setCloseCaixaModalOpen(false);
          setSelectedCaixa(null);
        }}
        onConfirm={handleCloseCaixa}
        caixa={selectedCaixa}
        isLoading={isClosing}
      />

      <EditCaixaModal
        open={editCaixaModalOpen}
        onClose={() => {
          setEditCaixaModalOpen(false);
          setSelectedCaixa(null);
        }}
        caixa={selectedCaixa}
      />

      <CaixaDetailModal
        open={detailCaixaModalOpen}
        onClose={() => {
          setDetailCaixaModalOpen(false);
          setSelectedCaixa(null);
        }}
        caixa={selectedCaixa}
      />
    </AppLayoutNew>
  );
}
