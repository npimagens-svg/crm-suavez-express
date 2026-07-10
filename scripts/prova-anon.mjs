// Prova de segurança da fila pública com a chave ANON (pública por design).
// Uso:
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/prova-anon.mjs
//
// ANTES das migrations: mostra a VULNERABILIDADE (anon lê segredo/PII).
// DEPOIS das migrations: as leituras diretas devem falhar/retornar vazio e
// só as RPCs de escopo mínimo funcionam.
// Nenhum segredo é impresso — apenas se o acesso foi PERMITIDO ou NEGADO.
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
if (!url || !anon) {
  console.error("Defina SUPABASE_URL e SUPABASE_ANON_KEY no ambiente.");
  process.exit(2);
}
const supa = createClient(url, anon, { auth: { persistSession: false } });

let vulnerabilidades = 0;

async function provaLeituraNegada(tabela, colunas) {
  const { data, error } = await supa.from(tabela).select(colunas).limit(1);
  if (error) {
    console.log(`✅ ${tabela}: acesso anônimo NEGADO (${error.code || "erro"})`);
    return;
  }
  if (data && data.length > 0) {
    console.log(`🔴 ${tabela}: anon LEU dados (VULNERÁVEL) — ${data.length} linha(s)`);
    vulnerabilidades++;
  } else {
    console.log(`✅ ${tabela}: anon não recebeu linhas`);
  }
}

async function provaInsertPagoNegado() {
  const { error } = await supa.from("queue_entries").insert({
    salon_id: "00000000-0000-0000-0000-000000000000",
    customer_name: "PROVA_ANON",
    customer_phone: "11900000000",
    service_id: "00000000-0000-0000-0000-000000000000",
    position: 999,
    payment_status: "confirmed",
    status: "waiting",
  });
  if (error) {
    console.log(`✅ queue_entries INSERT: anon BLOQUEADO de criar entrada paga (${error.code || "erro"})`);
  } else {
    console.log("🔴 queue_entries INSERT: anon CRIOU entrada marcada como paga (VULNERÁVEL)");
    vulnerabilidades++;
  }
}

async function provaBootstrapSemSegredo() {
  const { data, error } = await supa.rpc("fila_public_bootstrap");
  if (error) {
    console.log(`ℹ️  fila_public_bootstrap ausente (migrations ainda não aplicadas): ${error.code}`);
    return;
  }
  const txt = JSON.stringify(data || {});
  if (/asaas|zapi|api_key/i.test(txt)) {
    console.log("🔴 fila_public_bootstrap VAZOU segredo");
    vulnerabilidades++;
  } else {
    console.log("✅ fila_public_bootstrap: sem segredo, escopo mínimo");
  }
}

console.log("=== PROVA ANON (read-only) —", url, "===\n");
await provaLeituraNegada("queue_settings", "asaas_api_key, zapi_token");
await provaLeituraNegada("queue_entries", "customer_name, customer_phone, payment_status");
await provaLeituraNegada("customer_credits", "customer_phone, amount");
await provaInsertPagoNegado();
await provaBootstrapSemSegredo();

console.log(`\n=== ${vulnerabilidades} vulnerabilidade(s) detectada(s) ===`);
process.exit(vulnerabilidades > 0 ? 1 : 0);
