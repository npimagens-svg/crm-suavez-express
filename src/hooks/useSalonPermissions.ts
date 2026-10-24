import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { useAuth, AppRole } from "@/contexts/AuthContext";

// Etapa 6: permissões por papel configuráveis em Configurações > Permissões.
// Lê salon_permissions (uma linha por chave) e responde pode(chave) pelo papel do usuário.
// Enquanto a migration não estiver aplicada (tabela ausente / consulta falha), cai no comportamento
// antigo do front (ver fallbackPode).

export interface SalonPermissionRow {
  permission_key: string;
  roles: AppRole[];
  updated_at: string | null;
  updated_by: string | null;
}

export const PERMISSION_LABELS: Record<string, string> = {
  "caixa.abrir": "Abrir caixa",
  "caixa.fechar": "Fechar caixa",
  "caixa.reabrir_editar": "Reabrir, editar ou recalcular caixa",
  "caixa.sangria_suprimento": "Lançar sangria e suprimento",
  "comanda.fechar_qualquer": "Fechar comanda de qualquer profissional",
  "comanda.fechar_propria": "Fechar a própria comanda",
  "comanda.reabrir": "Reabrir comanda",
  "comanda.excluir": "Excluir comanda",
  "comanda.desconto_manual": "Dar desconto manual na comanda",
  "pagamento.anular": "Anular pagamento",
  "financeiro.ver": "Ver o menu Financeiro",
  "comissao.ver_todas": "Ver comissões de todas as profissionais",
  "comissao.editar": "Editar comissões (bônus, desconto, pagamento, regras)",
  "ficha.editar_propria_contato": "Editar contato e endereço da própria ficha",
  "ficha.editar_qualquer": "Editar qualquer ficha de profissional",
  "despesas.lancar": "Lançar despesas, contas a pagar e entradas",
  "dados_bancarios.editar_propria": "Editar os próprios dados bancários",
  "dados_bancarios.editar_qualquer": "Editar dados bancários de qualquer profissional",
  "cliente.excluir": "Excluir cliente",
  "cliente.ver_cpf": "Ver CPF, RG e nascimento de clientes",
  "clube.estornar_cancelar": "Estornar cobrança e cancelar assinatura do Clube (com senha)",
};

export const PERMISSION_KEYS = Object.keys(PERMISSION_LABELS);

const ROLES_OPERACAO_CAIXA: AppRole[] = ["admin", "financial", "receptionist", "manager"];
const KEYS_ADMIN_OU_MASTER = new Set([
  "comanda.excluir",
  "comanda.reabrir",
  "pagamento.anular",
  "caixa.reabrir_editar",
  "comissao.ver_todas",
  "comissao.editar",
  "financeiro.ver",
  "despesas.lancar",
  "cliente.excluir",
  "clube.estornar_cancelar",
]);
const KEYS_OPERACAO_CAIXA = new Set([
  "caixa.abrir",
  "caixa.fechar",
  "comanda.fechar_qualquer",
  "comanda.desconto_manual",
  "caixa.sangria_suprimento",
]);

// O que o gate antigo devolvia para cada chave (usado só quando a tabela não existe / a consulta falha).
// Chaves fora das duas listas não tinham gate no front: continuam liberadas.
function fallbackPode(key: string, userRole: AppRole | null, isAdmin: boolean, isMaster: boolean): boolean {
  if (isAdmin || isMaster) return true;
  if (KEYS_ADMIN_OU_MASTER.has(key)) return false;
  if (KEYS_OPERACAO_CAIXA.has(key)) return !!userRole && ROLES_OPERACAO_CAIXA.includes(userRole);
  return true;
}

export function useSalonPermissions() {
  const { salonId, userRole, isAdmin, isMaster } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["salon-permissions", salonId],
    queryFn: async (): Promise<{ available: boolean; rows: SalonPermissionRow[] }> => {
      if (!salonId) return { available: false, rows: [] };
      const { data, error } = await supabase
        .from("salon_permissions" as any)
        .select("permission_key, roles, updated_at, updated_by")
        .eq("salon_id", salonId);
      // Tabela ausente (42P01) ou qualquer outro erro: fallback para o gate antigo, sem quebrar a tela.
      if (error) return { available: false, rows: [] };
      return { available: true, rows: (data ?? []) as unknown as SalonPermissionRow[] };
    },
    enabled: !!salonId,
    staleTime: 5 * 60 * 1000,
  });

  const available = query.data?.available ?? false;
  const rows = query.data?.rows ?? [];

  const pode = useCallback(
    (key: string): boolean => {
      if (isAdmin) return true;
      if (!available) return fallbackPode(key, userRole, isAdmin, isMaster);
      const row = rows.find((r) => r.permission_key === key);
      // Chave ainda não semeada no salão: mesmo tratamento do fallback.
      if (!row) return fallbackPode(key, userRole, isAdmin, isMaster);
      return !!userRole && row.roles.includes(userRole);
    },
    [available, rows, userRole, isAdmin, isMaster]
  );

  const updateRoles = async (permissionKey: string, roles: AppRole[]) => {
    if (!salonId) throw new Error("Salão não identificado");
    const { data, error } = await supabase
      .from("salon_permissions" as any)
      .update({ roles })
      .eq("salon_id", salonId)
      .eq("permission_key", permissionKey)
      .select("permission_key");
    if (error) throw error;
    // Policy de UPDATE negada não dá erro: volta 0 linhas.
    if (!data || (data as unknown[]).length === 0) throw new Error("Sem permissão para alterar (apenas administrador)");
    await queryClient.invalidateQueries({ queryKey: ["salon-permissions", salonId] });
  };

  return {
    pode,
    rows,
    available,
    // isPending (e não isLoading): enquanto o salonId não chegou a query fica desligada e
    // isLoading vinha false, então pode() caía na regra antiga e as telas com
    // <Navigate> (Financeiro, Contas a Pagar, Comissões) expulsavam a recepção de vez em quando.
    // Também espera o papel do usuário: as permissões podem chegar antes do papel, e aí
    // pode() respondia "não" por um instante (1 em 15 cargas ainda redirecionava).
    isLoading: query.isPending || (!userRole && !isAdmin && !isMaster),
    updateRoles,
  };
}
