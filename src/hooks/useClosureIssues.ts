// @ts-nocheck
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/dynamicSupabaseClient";

export type IssueStatus =
  | "open"
  | "in_correction"
  | "auto_resolved"
  | "marked_resolved"
  | "resolved"
  | "reopened"
  | "ignored";

const CORRECTION_WEBHOOK_URL =
  "https://agentes.72-60-6-168.sslip.io/webhook/send-correction";

/**
 * Lista pendências de fechamento (closure_issues) com joins úteis pra UI.
 * Padrão: status abertos (open, in_correction, reopened).
 */
export function useClosureIssues(
  salonId: string | null | undefined,
  status: IssueStatus[] = ["open", "in_correction", "reopened"]
) {
  return useQuery({
    queryKey: ["closure-issues", salonId, status],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("closure_issues")
        .select(
          `
          *,
          comandas(comanda_number, total, clients(name)),
          professionals(name, phone)
        `
        )
        .eq("salon_id", salonId)
        .in("status", status)
        .order("severity", { ascending: true })
        .order("detected_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!salonId,
  });
}

/**
 * Marca como resolvido manualmente ou ignora a pendência.
 * Registra ação em closure_issue_actions.
 */
export function useResolveIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      action,
      reason,
    }: {
      id: string;
      action: "marked_resolved" | "ignored";
      reason?: string;
    }) => {
      const update: Record<string, any> = {
        status: action,
        resolved_at: new Date().toISOString(),
      };
      if (action === "ignored") {
        update.ignored_reason = reason && reason.length > 0 ? reason : "User";
      }
      const { error } = await supabase
        .from("closure_issues")
        .update(update)
        .eq("id", id);
      if (error) throw error;
      await supabase
        .from("closure_issue_actions")
        .insert({ issue_id: id, action });
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["closure-issues"] }),
  });
}

/**
 * Dispara mensagem de correção via webhook Evolution e marca como in_correction.
 * Registra ação com whatsapp_message_id (quando webhook retorna).
 */
export function useRequestCorrection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      issueId,
      phone,
      message,
    }: {
      issueId: string;
      phone: string;
      message: string;
    }) => {
      let messageId: string | null = null;
      try {
        const resp = await fetch(CORRECTION_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, message }),
        });
        if (resp.ok) {
          const json = await resp.json().catch(() => null);
          messageId = json?.message_id ?? json?.id ?? null;
        } else {
          throw new Error(
            `Webhook respondeu ${resp.status}: ${await resp
              .text()
              .catch(() => "")}`
          );
        }
      } catch (err) {
        // Re-throw — o caller mostra erro via toast/disabled state.
        throw err;
      }

      const { error: updateErr } = await supabase
        .from("closure_issues")
        .update({ status: "in_correction" })
        .eq("id", issueId);
      if (updateErr) throw updateErr;

      await supabase.from("closure_issue_actions").insert({
        issue_id: issueId,
        action: "requested_correction",
        message,
        whatsapp_message_id: messageId,
      });
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["closure-issues"] }),
  });
}
