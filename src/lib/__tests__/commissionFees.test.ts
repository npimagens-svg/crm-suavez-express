import { describe, it, expect } from "vitest";
import { calculateItemCardFee } from "@/lib/commissionFees";

describe("calculateItemCardFee (falha 20 — rateio de taxa)", () => {
  it("soma dos rateios NUNCA excede a taxa paga, mesmo com desconto", () => {
    // 2 itens de 100 (soma itens = 200). Comanda com desconto → total 150.
    // Taxa paga sobre o valor cobrado = 5.
    const items = [{ total_price: 100 }, { total_price: 100 }];
    const payments = [{ fee_amount: 5 }];
    const fee1 = calculateItemCardFee(items, payments, 100);
    const fee2 = calculateItemCardFee(items, payments, 100);
    // Regressão do bug: o rateio antigo (item/comanda.total) daria
    // 100/150*5 * 2 = 6.66 > 5. Aqui: 100/200*5 * 2 = 5 exatos.
    expect(fee1 + fee2).toBeCloseTo(5, 6);
    expect(fee1 + fee2).toBeLessThanOrEqual(5 + 1e-9);
  });

  it("distribui proporcionalmente ao valor do item", () => {
    const items = [{ total_price: 30 }, { total_price: 70 }];
    const payments = [{ fee_amount: 10 }];
    expect(calculateItemCardFee(items, payments, 30)).toBeCloseTo(3, 6);
    expect(calculateItemCardFee(items, payments, 70)).toBeCloseTo(7, 6);
  });

  it("retorna 0 sem taxa de cartão", () => {
    expect(calculateItemCardFee([{ total_price: 50 }], [{ fee_amount: 0 }], 50)).toBe(0);
    expect(calculateItemCardFee([{ total_price: 50 }], [], 50)).toBe(0);
  });

  it("retorna 0 quando a soma dos itens é zero (evita divisão por zero)", () => {
    expect(calculateItemCardFee([{ total_price: 0 }], [{ fee_amount: 5 }], 0)).toBe(0);
  });
});
