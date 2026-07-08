export type QueueStatus = "waiting" | "checked_in" | "in_service" | "completed" | "cancelled" | "no_show";
export type QueueSource = "online" | "walk_in";
export type QueuePaymentStatus = "pending" | "confirmed" | "refunded" | "credit";

export interface QueueEntry {
  id: string;
  salon_id: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  service_id: string;
  service_ids: string[] | null;
  status: QueueStatus;
  source: QueueSource;
  position: number;
  payment_id: string | null;
  payment_status: QueuePaymentStatus;
  payment_method: string | null;
  notify_minutes_before: number;
  notify_sent: boolean;
  notify_next_sent: boolean;
  estimated_time: string | null;
  checked_in_at: string | null;
  assigned_professional_id: string | null;
  created_at: string;
  updated_at: string;
  service?: { id: string; name: string; price: number; duration_minutes: number };
  professional?: { id: string; name: string };
}

export interface QueueEntryInput {
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  service_id: string;
  service_ids?: string[];
  source: QueueSource;
  notify_minutes_before?: number;
  payment_id?: string;
}

export interface QueueLead {
  id: string;
  salon_id: string;
  name: string;
  phone: string;
  max_queue_size: number;
  notified: boolean;
  created_at: string;
}

export interface QueueLeadInput {
  name: string;
  phone: string;
  max_queue_size: number;
}

export interface CustomerCredit {
  id: string;
  salon_id: string;
  customer_id: string | null;
  customer_phone: string;
  amount: number;
  origin_queue_entry_id: string | null;
  expires_at: string;
  used: boolean;
  used_at: string | null;
  created_at: string;
}

export interface QueueSettings {
  id: string;
  salon_id: string;
  inflation_factor: number;
  credit_validity_days: number;
  notify_options: number[];
  reception_email: string | null;
  zapi_instance_id: string | null;
  zapi_token: string | null;
  asaas_api_key: string | null;
}

export interface QueueStats {
  totalInQueue: number;
  inflatedCount: number;
  estimatedMinutes: number;
  activeProfessionals: number;
}
