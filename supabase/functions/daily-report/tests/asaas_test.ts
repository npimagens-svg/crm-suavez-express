import { assert, assertEquals } from "std/assert/mod.ts";
import { fetchAsaasPayments } from "../asaas.ts";

const API_KEY = "TEST_ASAAS_KEY";

const samplePayment = (id: string) => ({
  id,
  status: "RECEIVED",
  billingType: "PIX",
  value: 100,
  netValue: 99,
  customer: "cus_test",
  dateCreated: "2026-05-09",
});

Deno.test("fetchAsaasPayments: monta header access_token corretamente", async () => {
  let capturedHeaders: Headers | undefined;
  let capturedUrl: string | undefined;
  globalThis.fetch = async (input: any, init: any) => {
    capturedUrl = typeof input === "string" ? input : input.url;
    capturedHeaders = new Headers(init?.headers ?? input.headers);
    return new Response(
      JSON.stringify({ data: [samplePayment("p1")], hasMore: false }),
      { status: 200 },
    );
  };
  await fetchAsaasPayments("2026-05-09", "2026-05-09", API_KEY);
  assertEquals(capturedHeaders?.get("access_token"), API_KEY);
  assert(capturedUrl?.includes("dateCreated[ge]=2026-05-09"));
  assert(capturedUrl?.includes("dateCreated[le]=2026-05-09"));
  assert(capturedUrl?.includes("limit=100"));
});

Deno.test("fetchAsaasPayments: retorna payments em sucesso", async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: [samplePayment("p1"), samplePayment("p2")],
        hasMore: false,
      }),
      { status: 200 },
    );
  const result = await fetchAsaasPayments("2026-05-09", "2026-05-09", API_KEY);
  assertEquals(result.unavailable, false);
  assertEquals(result.payments.length, 2);
  assertEquals(result.payments[0].id, "p1");
});

Deno.test("fetchAsaasPayments: retorna unavailable=true em 401", async () => {
  globalThis.fetch = async () => new Response("Unauthorized", { status: 401 });
  const result = await fetchAsaasPayments("2026-05-09", "2026-05-09", API_KEY);
  assertEquals(result.unavailable, true);
  assertEquals(result.payments.length, 0);
});

Deno.test("fetchAsaasPayments: retorna unavailable=true em 5xx", async () => {
  globalThis.fetch = async () => new Response("ISE", { status: 500 });
  const result = await fetchAsaasPayments("2026-05-09", "2026-05-09", API_KEY);
  assertEquals(result.unavailable, true);
});

Deno.test("fetchAsaasPayments: pagina quando hasMore", async () => {
  let calls = 0;
  globalThis.fetch = async (input: any) => {
    calls += 1;
    const url = typeof input === "string" ? input : input.url;
    if (calls === 1) {
      assert(url.includes("offset=0"));
      return new Response(
        JSON.stringify({ data: [samplePayment("p1"), samplePayment("p2")], hasMore: true }),
        { status: 200 },
      );
    }
    assert(url.includes("offset=2"));
    return new Response(
      JSON.stringify({ data: [samplePayment("p3")], hasMore: false }),
      { status: 200 },
    );
  };
  const result = await fetchAsaasPayments("2026-05-09", "2026-05-09", API_KEY);
  assertEquals(calls, 2);
  assertEquals(result.unavailable, false);
  assertEquals(result.payments.length, 3);
  assertEquals(result.payments.map(p => p.id), ["p1", "p2", "p3"]);
});

Deno.test("fetchAsaasPayments: api key vazia → unavailable=true", async () => {
  const result = await fetchAsaasPayments("2026-05-09", "2026-05-09", "");
  assertEquals(result.unavailable, true);
  assertEquals(result.payments.length, 0);
});
