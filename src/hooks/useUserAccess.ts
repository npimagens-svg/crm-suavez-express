import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { useAuth, AppRole } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export interface UserWithAccess {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  role: AppRole;
  access_level_id: string | null;
  professional_id: string | null;
  professional_name: string | null;
  can_open_caixa: boolean;
  created_at: string;
}

export function useUserAccess() {
  const { salonId, isMaster, userRole } = useAuth();
  const canManageAccess = isMaster || userRole === "admin";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["user-access", salonId],
    queryFn: async () => {
      if (!salonId) return [];

      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("id, user_id, role, salon_id, can_open_caixa, access_level_id")
        .eq("salon_id", salonId);

      if (rolesError) throw rolesError;
      if (!roles || roles.length === 0) return [];

      const userIds = roles.map((r) => r.user_id);
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);

      if (profilesError) throw profilesError;

      const { data: professionals, error: profError } = await supabase
        .from("professionals")
        .select("id, user_id, name")
        .eq("salon_id", salonId)
        .not("user_id", "is", null);

      if (profError) throw profError;

      const usersWithAccess: UserWithAccess[] = [];

      for (const role of roles) {
        const profile = profiles?.find((p) => p.user_id === role.user_id);
        const professional = professionals?.find((p) => p.user_id === role.user_id);

        usersWithAccess.push({
          id: role.id,
          user_id: role.user_id,
          full_name: professional?.name || profile?.full_name || "Usuário",
          email: "",
          role: role.role as AppRole,
          access_level_id: role.access_level_id ?? null,
          professional_id: professional?.id || null,
          professional_name: professional?.name || null,
          can_open_caixa: role.can_open_caixa ?? false,
          created_at: new Date().toISOString(),
        });
      }

      return usersWithAccess;
    },
    enabled: !!salonId,
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, newRole, accessLevelId }: { userId: string; newRole: AppRole; accessLevelId?: string | null }) => {
      if (!salonId) throw new Error("Salão não encontrado");
      if (!canManageAccess) throw new Error("Você não tem permissão para alterar acessos");

      // Promover a admin é PERMITIDO (pedido do Cleiton): a autorização real é
      // no backend — a edge function update-user-role só deixa um admin
      // promover, e ninguém altera o próprio papel.
      const { error } = await supabase.functions.invoke("update-user-role", {
        body: { userId, salonId, newRole, accessLevelId: accessLevelId ?? null },
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-access", salonId] });
      toast({ title: "Permissão atualizada com sucesso!" });
    },
    onError: (error: Error) => {
      toast({
        title: "Erro ao atualizar permissão",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateCanOpenCaixaMutation = useMutation({
    mutationFn: async ({ userId, canOpenCaixa }: { userId: string; canOpenCaixa: boolean }) => {
      if (!salonId) throw new Error("Salão não encontrado");
      if (!canManageAccess) throw new Error("Você não tem permissão para alterar acessos");

      const { error } = await supabase
        .from("user_roles")
        .update({ can_open_caixa: canOpenCaixa })
        .eq("user_id", userId)
        .eq("salon_id", salonId);

      if (error) throw error;
    },
    onMutate: async ({ userId, canOpenCaixa }) => {
      await queryClient.cancelQueries({ queryKey: ["user-access", salonId] });
      const previous = queryClient.getQueryData<UserWithAccess[]>(["user-access", salonId]);
      queryClient.setQueryData<UserWithAccess[]>(["user-access", salonId], (old) => {
        if (!old) return old;
        return old.map(u => u.user_id === userId ? { ...u, can_open_caixa: canOpenCaixa } : u);
      });
      return { previous };
    },
    onSuccess: () => {
      toast({ title: "Permissão de caixa atualizada!" });
    },
    onError: (error: Error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["user-access", salonId], context.previous);
      }
      toast({
        title: "Erro ao atualizar permissão",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteAccessMutation = useMutation({
    mutationFn: async (userId: string) => {
      if (!salonId) throw new Error("Salão não encontrado");
      if (!canManageAccess) throw new Error("Você não tem permissão para remover acessos");

      const { error } = await supabase.functions.invoke("delete-user-access", {
        body: { userId, salonId },
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-access", salonId] });
      toast({ title: "Acesso removido com sucesso!" });
    },
    onError: (error: Error) => {
      toast({
        title: "Erro ao remover acesso",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return {
    users: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    updateRole: updateRoleMutation.mutate,
    updateCanOpenCaixa: updateCanOpenCaixaMutation.mutate,
    deleteAccess: deleteAccessMutation.mutate,
    isUpdating: updateRoleMutation.isPending || updateCanOpenCaixaMutation.isPending,
    isDeleting: deleteAccessMutation.isPending,
  };
}
