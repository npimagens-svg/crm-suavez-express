// Lógica PURA de rateio de taxa de cartão nas comissões (falha 20).
// Extraída para ser testável e reutilizável (DRY).

export interface FeeItem {
  total_price?: number | null;
}
export interface FeePayment {
  fee_amount?: number | null;
}

/**
 * Rateia a taxa de cartão de UMA comanda por item, proporcional à
 * participação do item na SOMA DOS ITENS (não no comanda.total).
 *
 * Invariante garantido: a soma dos rateios de todos os itens é EXATAMENTE
 * a taxa total paga — nunca a excede. O bug antigo usava comanda.total como
 * denominador; com desconto, comanda.total < soma dos itens, então o rateio
 * total ultrapassava a taxa realmente paga.
 */
export function calculateItemCardFee(
  items: FeeItem[],
  payments: FeePayment[],
  itemTotal: number,
): number {
  const totalCardFees = payments.reduce((sum, p) => sum + (p.fee_amount || 0), 0);
  if (totalCardFees === 0) return 0;
  const itemsTotal = items.reduce((sum, it) => sum + (it.total_price || 0), 0);
  if (itemsTotal <= 0) return 0;
  return (itemTotal / itemsTotal) * totalCardFees;
}
