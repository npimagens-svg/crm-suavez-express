import { describe, it, expect } from "vitest";
import { decideEndOfDayCredit } from "@/lib/queueCreditRules";

describe("decideEndOfDayCredit (falhas 15/16 — regra única de crédito)", () => {
  it("no_show NÃO gera crédito (falha 16 — cron incluía no_show)", () => {
    const d = decideEndOfDayCredit({ status: "no_show", payment_status: "confirmed", paid_amount: 50 });
    expect(d.generate).toBe(false);
    expect(d.amount).toBe(0);
  });

  it("cancelled NÃO gera crédito no fim do dia", () => {
    const d = decideEndOfDayCredit({ status: "cancelled", payment_status: "confirmed", paid_amount: 50 });
    expect(d.generate).toBe(false);
  });

  it("waiting + pago gera crédito com o VALOR PAGO (snapshot)", () => {
    const d = decideEndOfDayCredit({ status: "waiting", payment_status: "confirmed", paid_amount: 87.5 });
    expect(d.generate).toBe(true);
    expect(d.amount).toBe(87.5);
  });

  it("checked_in + pago gera crédito", () => {
    const d = decideEndOfDayCredit({ status: "checked_in", payment_status: "confirmed", paid_amount: 40 });
    expect(d.generate).toBe(true);
    expect(d.amount).toBe(40);
  });

  it("sem paid_amount usa a SOMA de todos os serviços (falha 15 — multi-serviço)", () => {
    const d = decideEndOfDayCredit({
      status: "waiting",
      payment_status: "confirmed",
      paid_amount: null,
      service_prices_sum: 47 + 30, // 2 serviços, não só o 1º
    });
    expect(d.generate).toBe(true);
    expect(d.amount).toBe(77);
  });

  it("não pago (pending) nunca gera crédito", () => {
    const d = decideEndOfDayCredit({ status: "waiting", payment_status: "pending", paid_amount: 50 });
    expect(d.generate).toBe(false);
  });
});
