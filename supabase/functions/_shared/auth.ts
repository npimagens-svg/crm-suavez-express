// Helpers de autenticação/autorização das Edge Functions (Sua Vez Express).
// Regra geral: FALHA FECHADA — segredo ausente ou inválido nunca libera acesso.
// deno-lint-ignore-file no-explicit-any

export type StaffCheck =
  | { ok: true; userId: string; salonId: string; roles: string[] }
  | { ok: false; status: number; error: string };

/**
 * Valida que o chamador é um usuário AUTENTICADO do salão (staff).
 * Aceita também o service_role key como Bearer (chamadas server→server internas).
 * `requiredRoles`: se informado, o usuário precisa ter ao menos um dos papéis.
 */
export async function requireStaff(
  req: Request,
  supaAdmin: any,
  requiredRoles?: string[],
): Promise<StaffCheck> {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, error: "Não autenticado" };

  // Server→server interno (email-cron → send-email etc.)
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (serviceKey && token === serviceKey) {
    return { ok: true, userId: "service_role", salonId: "*", roles: ["service_role"] };
  }

  const { data: userData, error: userErr } = await supaAdmin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { ok: false, status: 401, error: "Sessão inválida" };
  }
  const uid = userData.user.id;

  const { data: profile } = await supaAdmin
    .from("profiles")
    .select("salon_id")
    .eq("user_id", uid)
    .maybeSingle();
  if (!profile?.salon_id) {
    return { ok: false, status: 403, error: "Usuário sem salão" };
  }

  const { data: roleRows } = await supaAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", uid);
  const roles = (roleRows ?? []).map((r: any) => String(r.role));

  if (requiredRoles && requiredRoles.length > 0) {
    if (!roles.some((r: string) => requiredRoles.includes(r))) {
      return { ok: false, status: 403, error: "Sem permissão para esta ação" };
    }
  }

  return { ok: true, userId: uid, salonId: profile.salon_id, roles };
}

/**
 * Valida chamada de cron/automação via segredo compartilhado.
 * CRON_SECRET ausente ⇒ 503 (falha fechada, nunca libera).
 */
export function requireCronSecret(req: Request): { ok: true } | { ok: false; status: number; error: string } {
  const expected = Deno.env.get("CRON_SECRET") ?? "";
  if (!expected) {
    return { ok: false, status: 503, error: "CRON_SECRET não configurado (falha fechada)" };
  }
  const got = req.headers.get("x-cron-secret") ?? "";
  if (got !== expected) {
    return { ok: false, status: 401, error: "Cron secret inválido" };
  }
  return { ok: true };
}

/** Lê os segredos do salão no cofre backend-only (salon_secrets). */
export async function getSalonSecrets(supaAdmin: any, salonId: string) {
  const { data } = await supaAdmin
    .from("salon_secrets")
    .select("asaas_api_key, zapi_instance_id, zapi_token, zapi_client_token")
    .eq("salon_id", salonId)
    .maybeSingle();
  return data ?? null;
}
