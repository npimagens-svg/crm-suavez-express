// Backfill one-shot: lê todos queue_entries com payment_status='pending'
// e payment_id começando com 'pay_', consulta Asaas e atualiza o status.
//
// Uso:
//   SUPABASE_URL=...
//   SUPABASE_SERVICE_ROLE_KEY=...
//   deno run --allow-net --allow-env scripts/sync-queue-asaas-status.ts
//
// Roda 1 vez pra corrigir o histórico antes do webhook entrar em produção.
//
// Asaas → queue_payment_status enum (pending|confirmed|refunded|credit):
//   RECEIVED, CONFIRMED, RECEIVED_IN_CASH    → confirmed
//   REFUNDED, REFUND_REQUESTED, CHARGEBACK_* → refunded
//   PENDING, OVERDUE, AWAITING_*             → pending  (no-op)
//   tudo mais                                → pending  (no-op)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ASAAS_BASE = "https://api.asaas.com/v3";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Set SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY");
  Deno.exit(1);
}

const supa = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

function mapAsaasStatus(s: string): "confirmed" | "refunded" | "pending" {
  const v = (s ?? "").toUpperCase();
  if (["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(v)) return "confirmed";
  if (["REFUNDED", "REFUND_REQUESTED", "CHARGEBACK_REQUESTED", "CHARGEBACK_DISPUTE"].includes(v)) {
    return "refunded";
  }
  return "pending";
}

async function fetchAsaasPayment(apiKey: string, id: string) {
  const res = await fetch(`${ASAAS_BASE}/payments/${id}`, {
    headers: { access_token: apiKey },
  });
  return await res.json();
}

async function main() {
  console.log("=== Backfill queue_entries.payment_status via Asaas ===");

  // 1) Mapa salon_id → asaas_api_key
  const { data: settings, error: sErr } = await supa
    .from("queue_settings")
    .select("salon_id, asaas_api_key");
  if (sErr) {
    console.error("queue_settings error:", sErr);
    Deno.exit(1);
  }
  const apiKeyBySalon = new Map<string, string>();
  for (const s of settings ?? []) {
    if (s.asaas_api_key) apiKeyBySalon.set(s.salon_id, s.asaas_api_key);
  }
  console.log(`Salões com Asaas: ${apiKeyBySalon.size}`);

  // 2) Lista candidatos
  const { data: entries, error: eErr } = await supa
    .from("queue_entries")
    .select("id, salon_id, customer_name, payment_id, payment_status, created_at")
    .eq("payment_status", "pending")
    .like("payment_id", "pay_%")
    .order("created_at", { ascending: false });
  if (eErr) {
    console.error("queue_entries error:", eErr);
    Deno.exit(1);
  }
  console.log(`Candidatos: ${entries?.length ?? 0}`);

  let confirmed = 0;
  let refunded = 0;
  let unchanged = 0;
  let errors = 0;

  for (const e of entries ?? []) {
    const apiKey = apiKeyBySalon.get(e.salon_id);
    if (!apiKey) {
      console.warn(`  [skip] salon ${e.salon_id} sem asaas_api_key`);
      continue;
    }
    try {
      const p = await fetchAsaasPayment(apiKey, e.payment_id!);
      if (p?.errors) {
        console.error(`  [ERR] ${e.payment_id} (${e.customer_name}): ${JSON.stringify(p.errors)}`);
        errors++;
        continue;
      }
      const mapped = mapAsaasStatus(p.status);
      const label = `${e.customer_name.padEnd(28)} ${e.payment_id} asaas=${p.status} → ${mapped}`;

      if (mapped === "pending") {
        console.log(`  [=] ${label}`);
        unchanged++;
        continue;
      }

      const { error: uErr } = await supa
        .from("queue_entries")
        .update({
          payment_status: mapped,
          updated_at: new Date().toISOString(),
        })
        .eq("id", e.id);

      if (uErr) {
        console.error(`  [ERR update] ${label}: ${uErr.message}`);
        errors++;
        continue;
      }
      console.log(`  [✓] ${label}`);
      if (mapped === "confirmed") confirmed++;
      else refunded++;
    } catch (err) {
      console.error(`  [EX] ${e.payment_id}: ${(err as Error).message}`);
      errors++;
    }
  }

  console.log("\n=== Resumo ===");
  console.log(`  confirmed: ${confirmed}`);
  console.log(`  refunded : ${refunded}`);
  console.log(`  unchanged: ${unchanged}`);
  console.log(`  errors   : ${errors}`);
}

await main();
