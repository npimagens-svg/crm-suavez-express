import { assertEquals, assert } from "std/assert/mod.ts";
import { fetchPagBankTransactional, type PagBankAuth } from "../pagbank.ts";
import response from "./fixtures/pagbank_response.json" with { type: "json" };

const auth: PagBankAuth = { user: "119232542", token: "TEST_TOKEN" };

Deno.test("fetchPagBankTransactional: monta Basic Auth corretamente", async () => {
  let capturedUrl: string | undefined;
  let capturedHeaders: Headers | undefined;
  globalThis.fetch = async (input: any, init: any) => {
    capturedUrl = typeof input === "string" ? input : input.url;
    capturedHeaders = new Headers(init?.headers ?? input.headers);
    return new Response(JSON.stringify(response), { status: 200 });
  };
  await fetchPagBankTransactional("2026-05-09", auth);
  const expected = "Basic " + btoa("119232542:TEST_TOKEN");
  assertEquals(capturedHeaders?.get("Authorization"), expected);
  assert(capturedUrl?.endsWith("/movement/v3.00/transactional/2026-05-09"));
});

Deno.test("fetchPagBankTransactional: retorna detalhes em sucesso", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify(response), { status: 200 });
  const result = await fetchPagBankTransactional("2026-05-09", auth);
  assertEquals(result.unavailable, false);
  assertEquals(result.transactions.length, 2);
});

Deno.test("fetchPagBankTransactional: retorna unavailable=true em 401", async () => {
  globalThis.fetch = async () => new Response("Unauthorized", { status: 401 });
  const result = await fetchPagBankTransactional("2026-05-09", auth);
  assertEquals(result.unavailable, true);
  assertEquals(result.transactions.length, 0);
});

Deno.test("fetchPagBankTransactional: retorna unavailable=true em 5xx", async () => {
  globalThis.fetch = async () => new Response("ISE", { status: 500 });
  const result = await fetchPagBankTransactional("2026-05-09", auth);
  assertEquals(result.unavailable, true);
});

Deno.test("fetchPagBankTransactional: retorna unavailable=true em erro de rede", async () => {
  globalThis.fetch = async () => { throw new Error("network unreachable"); };
  const result = await fetchPagBankTransactional("2026-05-09", auth);
  assertEquals(result.unavailable, true);
});
