// Tipos compartilhados da Edge Function daily-report

export type IssueType =
  | 'payment_method_mismatch'
  | 'value_mismatch'
  | 'comanda_open_24h'
  | 'professional_missing'
  | 'duplicate_service_same_client'
  | 'paid_without_payment'
  | 'payment_without_paid_flag'
  | 'pagbank_orphan_transaction'
  | 'cashback_overdraft';

export type Severity = 'high' | 'medium' | 'low';

export interface ClosureIssue {
  type: IssueType;
  severity: Severity;
  description: string;
  comanda_id?: string;
  professional_id?: string;
  expected_value?: Record<string, unknown>;
  actual_value?: Record<string, unknown>;
}

export interface PaymentMix {
  credit:  { count: number; gross: number; net: number };
  debit:   { count: number; gross: number; net: number };
  pix:     { count: number; gross: number; net: number };
  cash:    { count: number; gross: number; net: number };
}

export interface ProfessionalStats {
  id: string;
  name: string;
  revenue: number;
  count: number;
  top_service: { name: string; count: number } | null;
}

export interface ServiceStats {
  id: string;
  name: string;
  count: number;
  revenue: number;
}

export interface DailyKpis {
  revenue: { gross: number; net: number; expected_from_pagbank: number };
  bookings: { count: number; average_ticket: number };
  by_professional: ProfessionalStats[];
  top_services: ServiceStats[];
  payment_mix: PaymentMix;
  real_card_fee: { total: number; by_brand: Record<string, number> };
  new_vs_returning: { new_count: number; returning_count: number; new_revenue: number };
  cashback: { credited: number; redeemed: number; balance_change: number };
  towels: { count: number; cost: number };
  queue_unattended: { count: number; list: Array<{ id: string; client: string }> };
  seven_day_average: { revenue: number; bookings: number; ticket: number };
}

export interface PagBankTransaction {
  meio_pagamento: number;       // 3=Crédito, 8=Débito Maestro, 11=PIX, 15=Débito prepaid
  arranjo_ur: string;           // CREDIT_VISA, DEBIT_MASTERCARD, PIX, ...
  valor_total_transacao: number;
  valor_liquido_transacao: number;
  taxa_intermediacao: number;
  data_prevista_pagamento: string;
  quantidade_parcelas: number;
}

export interface DailyReportResponse {
  period: { start: string; end: string; days: number };
  kpis: DailyKpis;
  issues: ClosureIssue[];
  comparisons: {
    vs_yesterday:    { revenue_pct: number; bookings_pct: number };
    vs_7d_avg:       { revenue_pct: number; bookings_pct: number };
    vs_same_weekday: { revenue_pct: number; bookings_pct: number };
  };
  markdown: string;
  html: string;
  pagbank_unavailable?: boolean;
}

// Domínio (input das funções de cálculo)
export interface ComandaWithItems {
  id: string;
  salon_id: string;
  client_id: string | null;
  professional_id: string | null;
  comanda_number: number;
  total: number;
  is_paid: boolean;
  created_at: string;
  closed_at: string | null;
  items: Array<{
    service_id: string;
    service_name: string;
    quantity: number;
    unit_price: number;
    total_price: number;
  }>;
  payments: Array<{
    id: string;
    amount: number;
    payment_method: string;
    fee_amount: number;
    net_amount: number;
    installments: number;
  }>;
}
