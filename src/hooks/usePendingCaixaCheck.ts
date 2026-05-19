import { useMemo } from "react";
import { useCaixas } from "./useCaixas";
import { useAuth } from "@/contexts/AuthContext";
import { startOfDay, isSameDay } from "date-fns";

/**
 * Hook that checks if the current user has an open caixa from a previous day
 * that DOES NOT match the operation's target date (default: today).
 *
 * Used to block creating comandas/appointments until yesterday's forgotten
 * caixa is closed — but allows intentional retroactive operations (e.g. master
 * opening a caixa for day 16 to register the missing comandas from that day).
 *
 * Pass `targetDate` to declare which day you're operating on. If a pending
 * caixa exists for THAT same day, it is not flagged as "forgotten".
 */
export function usePendingCaixaCheck(targetDate?: Date) {
  const { openCaixas, isLoading } = useCaixas();
  const { user } = useAuth();
  const userId = user?.id;

  const pendingCaixa = useMemo(() => {
    if (!userId || isLoading) return null;

    const today = startOfDay(new Date());
    const opDay = targetDate ? startOfDay(targetDate) : today;

    const pending = openCaixas.find(c => {
      if (c.user_id !== userId) return false;
      const caixaDate = startOfDay(new Date(c.opened_at));
      // Only flag as "forgotten" if it's from a previous day AND not the day we're operating on.
      if (caixaDate.getTime() >= today.getTime()) return false;
      if (isSameDay(caixaDate, opDay)) return false;
      return true;
    });

    return pending || null;
  }, [openCaixas, userId, isLoading, targetDate]);

  const pendingCaixaDate = pendingCaixa
    ? new Date(pendingCaixa.opened_at).toLocaleDateString("pt-BR")
    : null;

  return {
    hasPendingCaixa: !!pendingCaixa,
    pendingCaixa,
    pendingCaixaDate,
    isLoading,
    message: pendingCaixa
      ? `Você tem um caixa aberto de ${pendingCaixaDate} que precisa ser finalizado antes de continuar.`
      : null,
  };
}
