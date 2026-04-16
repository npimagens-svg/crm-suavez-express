/**
 * Combined SQL schema for setting up a new Supabase project.
 * This is a consolidated version of all migrations.
 * The user must run this in the Supabase SQL Editor before proceeding with the setup wizard.
 */
export const SETUP_SCHEMA_SQL = `
-- ============================================================
-- NP Hair Studio - Schema Completo para Supabase
-- Execute este SQL no SQL Editor do seu projeto Supabase
-- ============================================================

-- 1. ENUMS
CREATE TYPE public.app_role AS ENUM ('admin', 'manager', 'receptionist', 'financial', 'professional');
CREATE TYPE public.appointment_status AS ENUM ('scheduled', 'confirmed', 'in_progress', 'completed', 'paid', 'no_show', 'cancelled');
CREATE TYPE public.transaction_type AS ENUM ('income', 'expense');
CREATE TYPE public.payment_method AS ENUM ('cash', 'pix', 'credit_card', 'debit_card', 'other', 'installment');
CREATE TYPE public.stock_movement_type AS ENUM ('entry', 'exit', 'adjustment');

-- 2. FUNÇÕES AUXILIARES
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 3. TABELAS PRINCIPAIS

CREATE TABLE public.salons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  trade_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  logo_url TEXT,
  cnpj TEXT,
  state_registration TEXT,
  city_registration TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  salon_id UUID REFERENCES public.salons(id) ON DELETE CASCADE NOT NULL,
  full_name TEXT NOT NULL,
  avatar_url TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  salon_id UUID REFERENCES public.salons(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  can_open_caixa boolean NOT NULL DEFAULT false,
  access_level_id uuid,
  UNIQUE (user_id, salon_id, role)
);

CREATE TABLE public.system_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID REFERENCES public.salons(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  phone_landline TEXT,
  birth_date DATE,
  notes TEXT,
  tags TEXT[] DEFAULT '{}',
  gender TEXT,
  cpf TEXT,
  rg TEXT,
  cep TEXT,
  state TEXT,
  city TEXT,
  neighborhood TEXT,
  address TEXT,
  address_number TEXT,
  address_complement TEXT,
  how_met TEXT,
  profession TEXT,
  avatar_url TEXT,
  allow_email_campaigns BOOLEAN DEFAULT true,
  allow_sms_campaigns BOOLEAN DEFAULT true,
  allow_online_booking BOOLEAN DEFAULT true,
  allow_whatsapp_campaigns BOOLEAN DEFAULT true,
  add_cpf_invoice BOOLEAN DEFAULT true,
  allow_ai_service BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID REFERENCES public.salons(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  price NUMERIC NOT NULL DEFAULT 0,
  commission_percent NUMERIC DEFAULT 0,
  category TEXT,
  is_active BOOLEAN DEFAULT true,
  queue_enabled BOOLEAN NOT NULL DEFAULT false,
  send_return_reminder BOOLEAN NOT NULL DEFAULT false,
  return_reminder_days INTEGER DEFAULT 30,
  return_reminder_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.professionals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID REFERENCES public.salons(id) ON DELETE CASCADE NOT NULL,
  user_id UUID,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  avatar_url TEXT,
  specialty TEXT,
  nickname TEXT,
  cpf TEXT,
  rg TEXT,
  role TEXT,
  description TEXT,
  commission_percent NUMERIC DEFAULT 0,
  package_commission_percent NUMERIC DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  can_be_assistant BOOLEAN DEFAULT false,
  has_schedule BOOLEAN DEFAULT true,
  create_access BOOLEAN DEFAULT false,
  birth_date DATE,
  agenda_color TEXT DEFAULT '#000000',
  agenda_order INTEGER DEFAULT 0,
  mobile TEXT,
  site TEXT,
  facebook TEXT,
  instagram TEXT,
  twitter TEXT,
  cep TEXT,
  address TEXT,
  neighborhood TEXT,
  city TEXT,
  state TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID REFERENCES public.salons(id) ON DELETE CASCADE NOT NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  professional_id UUID REFERENCES public.professionals(id) ON DELETE SET NULL NOT NULL,
  service_id UUID REFERENCES public.services(id) ON DELETE SET NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  status appointment_status NOT NULL DEFAULT 'scheduled',
  notes TEXT,
  price NUMERIC,
  group_id UUID,
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID REFERENCES public.salons(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  sku TEXT,
  category TEXT,
  brand TEXT,
  product_line TEXT,
  cost_price NUMERIC DEFAULT 0,
  sale_price NUMERIC DEFAULT 0,
  current_stock INTEGER DEFAULT 0,
  current_stock_fractional NUMERIC DEFAULT 0,
  min_stock INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  is_for_resale BOOLEAN DEFAULT true,
  is_for_consumption BOOLEAN DEFAULT true,
  unit_of_measure TEXT DEFAULT 'unidade',
  unit_quantity NUMERIC DEFAULT 1,
  commission_percent NUMERIC DEFAULT 0,
  supplier_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID REFERENCES public.salons(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  trade_name TEXT,
  document TEXT,
  responsible TEXT,
  website TEXT,
  phone TEXT,
  mobile TEXT,
  email TEXT,
  cep TEXT,
  state TEXT,
  city TEXT,
  address TEXT,
  address_number TEXT,
  neighborhood TEXT,
  address_complement TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add FK after both tables exist
ALTER TABLE public.products ADD CONSTRAINT products_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);

CREATE TABLE public.stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID REFERENCES public.salons(id) ON DELETE CASCADE NOT NULL,
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE NOT NULL,
  movement_type stock_movement_type NOT NULL,
  quantity INTEGER NOT NULL,
  previous_stock INTEGER NOT NULL,
  new_stock INTEGER NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.comandas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID REFERENCES public.salons(id) ON DELETE CASCADE NOT NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  professional_id UUID REFERENCES public.professionals(id) ON DELETE SET NULL,
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  caixa_id UUID,
  comanda_number INTEGER,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  discount NUMERIC DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  is_paid BOOLEAN DEFAULT false,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.comanda_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comanda_id UUID REFERENCES public.comandas(id) ON DELETE CASCADE NOT NULL,
  service_id UUID REFERENCES public.services(id) ON DELETE SET NULL,
  product_id UUID,
  professional_id UUID REFERENCES public.professionals(id),
  source_appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL,
  total_price NUMERIC NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'service',
  product_cost NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.caixas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID REFERENCES public.salons(id) ON DELETE CASCADE NOT NULL,
  user_id UUID NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  opening_balance NUMERIC NOT NULL DEFAULT 0,
  closing_balance NUMERIC,
  total_cash NUMERIC DEFAULT 0,
  total_pix NUMERIC DEFAULT 0,
  total_credit_card NUMERIC DEFAULT 0,
  total_debit_card NUMERIC DEFAULT 0,
  total_other NUMERIC DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add FK for comandas.caixa_id
ALTER TABLE public.comandas ADD CONSTRAINT comandas_caixa_id_fkey FOREIGN KEY (caixa_id) REFERENCES public.caixas(id);

CREATE TABLE public.card_brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID NOT NULL,
  name TEXT NOT NULL,
  credit_fee_percent NUMERIC NOT NULL DEFAULT 0,
  debit_fee_percent NUMERIC NOT NULL DEFAULT 0,
  credit_2_6_fee_percent NUMERIC NOT NULL DEFAULT 0,
  credit_7_12_fee_percent NUMERIC NOT NULL DEFAULT 0,
  credit_13_18_fee_percent NUMERIC NOT NULL DEFAULT 0,
  credit_installment_fees JSONB DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID REFERENCES public.salons(id) ON DELETE CASCADE NOT NULL,
  comanda_id UUID REFERENCES public.comandas(id) ON DELETE CASCADE NOT NULL,
  amount NUMERIC NOT NULL,
  payment_method payment_method NOT NULL,
  card_brand_id UUID REFERENCES public.card_brands(id),
  bank_account_id UUID REFERENCES public.bank_accounts(id),
  fee_amount NUMERIC DEFAULT 0,
  net_amount NUMERIC,
  installments INTEGER DEFAULT 1,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.financial_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID REFERENCES public.salons(id) ON DELETE CASCADE NOT NULL,
  transaction_type transaction_type NOT NULL,
  amount NUMERIC NOT NULL,
  description TEXT NOT NULL,
  category TEXT,
  payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.professional_service_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id UUID NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  commission_percent NUMERIC NOT NULL DEFAULT 0,
  assistant_commission_percent NUMERIC DEFAULT 0,
  duration_minutes INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(professional_id, service_id)
);

CREATE TABLE public.professional_work_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id UUID NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  start_time TIME NOT NULL DEFAULT '09:00',
  end_time TIME NOT NULL DEFAULT '19:00',
  monday BOOLEAN NOT NULL DEFAULT false,
  tuesday BOOLEAN NOT NULL DEFAULT true,
  wednesday BOOLEAN NOT NULL DEFAULT true,
  thursday BOOLEAN NOT NULL DEFAULT true,
  friday BOOLEAN NOT NULL DEFAULT true,
  saturday BOOLEAN NOT NULL DEFAULT true,
  sunday BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.professional_bank_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id UUID NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE UNIQUE,
  person_type TEXT NOT NULL DEFAULT 'fisica',
  account_holder TEXT,
  holder_cpf TEXT,
  bank_name TEXT,
  account_type TEXT NOT NULL DEFAULT 'corrente',
  agency TEXT,
  account_number TEXT,
  account_digit TEXT,
  transfer_type TEXT NOT NULL DEFAULT 'ted',
  pix_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.professional_commission_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id UUID NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE UNIQUE,
  contract_type TEXT DEFAULT 'parceiro',
  contract_start DATE,
  contract_end DATE,
  payment_frequency TEXT DEFAULT 'mensal',
  card_payment_date TEXT DEFAULT 'sale_date',
  deduct_anticipation BOOLEAN DEFAULT true,
  deduct_card_fee BOOLEAN DEFAULT true,
  deduct_admin_fee BOOLEAN DEFAULT true,
  deduct_service_cost BOOLEAN DEFAULT true,
  deduct_product_cost BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.service_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity_per_use NUMERIC NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(service_id, product_id)
);

CREATE TABLE public.comanda_deletions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comanda_id UUID NOT NULL,
  client_id UUID,
  client_name TEXT,
  professional_id UUID,
  professional_name TEXT,
  comanda_total NUMERIC NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  deleted_by UUID NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  original_created_at TIMESTAMPTZ,
  original_closed_at TIMESTAMPTZ
);

CREATE TABLE public.client_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  salon_id UUID NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  description TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  performed_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.access_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID REFERENCES public.salons(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  system_key TEXT,
  color TEXT DEFAULT '#6366f1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(salon_id, name),
  UNIQUE(salon_id, system_key)
);

-- Add FK for user_roles.access_level_id
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_access_level_id_fkey FOREIGN KEY (access_level_id) REFERENCES public.access_levels(id);

CREATE TABLE public.access_level_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_level_id UUID REFERENCES public.access_levels(id) ON DELETE CASCADE NOT NULL,
  permission_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(access_level_id, permission_key)
);

CREATE TABLE public.scheduling_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  opening_time TIME NOT NULL DEFAULT '08:00',
  closing_time TIME NOT NULL DEFAULT '20:00',
  slot_interval_minutes INTEGER NOT NULL DEFAULT 30,
  default_columns INTEGER NOT NULL DEFAULT 6,
  monday BOOLEAN NOT NULL DEFAULT true,
  tuesday BOOLEAN NOT NULL DEFAULT true,
  wednesday BOOLEAN NOT NULL DEFAULT true,
  thursday BOOLEAN NOT NULL DEFAULT true,
  friday BOOLEAN NOT NULL DEFAULT true,
  saturday BOOLEAN NOT NULL DEFAULT true,
  sunday BOOLEAN NOT NULL DEFAULT false,
  min_advance_hours INTEGER NOT NULL DEFAULT 0,
  max_advance_days INTEGER NOT NULL DEFAULT 90,
  allow_simultaneous BOOLEAN NOT NULL DEFAULT true,
  auto_confirm BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(salon_id)
);

CREATE TABLE public.commission_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  card_payment_date TEXT NOT NULL DEFAULT 'comanda_date',
  anticipation_fee_enabled BOOLEAN NOT NULL DEFAULT false,
  anticipation_fee_percent NUMERIC NOT NULL DEFAULT 0,
  card_fee_mode TEXT NOT NULL DEFAULT 'card_brands',
  custom_card_fee_percent NUMERIC NOT NULL DEFAULT 0,
  admin_fee_enabled BOOLEAN NOT NULL DEFAULT false,
  admin_fee_percent NUMERIC NOT NULL DEFAULT 0,
  admin_fee_scope TEXT NOT NULL DEFAULT 'services_only',
  service_cost_enabled BOOLEAN NOT NULL DEFAULT true,
  product_cost_deduction TEXT NOT NULL DEFAULT 'before_commission',
  show_revenue_values BOOLEAN NOT NULL DEFAULT true,
  show_costs_values BOOLEAN NOT NULL DEFAULT true,
  admin_fee_display TEXT NOT NULL DEFAULT 'summary',
  card_fee_display TEXT NOT NULL DEFAULT 'summary',
  service_fee_display TEXT NOT NULL DEFAULT 'summary',
  presale_commission_rule TEXT NOT NULL DEFAULT 'discounted_value',
  presale_commission_percent NUMERIC NOT NULL DEFAULT 0,
  gift_card_commission_percent NUMERIC NOT NULL DEFAULT 0,
  package_commission_enabled BOOLEAN NOT NULL DEFAULT false,
  package_commission_percent NUMERIC NOT NULL DEFAULT 0,
  dual_assistant_rule TEXT NOT NULL DEFAULT 'full_value',
  receipt_footer_message TEXT NOT NULL DEFAULT '',
  pix_fee_percent NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(salon_id)
);

CREATE TABLE public.client_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  comanda_id UUID REFERENCES public.comandas(id) ON DELETE SET NULL,
  credit_amount NUMERIC NOT NULL DEFAULT 0,
  min_purchase_amount NUMERIC NOT NULL DEFAULT 100,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  used_in_comanda_id UUID REFERENCES public.comandas(id) ON DELETE SET NULL,
  is_used BOOLEAN NOT NULL DEFAULT false,
  is_expired BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.client_debts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID NOT NULL REFERENCES public.salons(id),
  client_id UUID NOT NULL REFERENCES public.clients(id),
  comanda_id UUID REFERENCES public.comandas(id),
  debt_amount NUMERIC NOT NULL DEFAULT 0,
  is_paid BOOLEAN NOT NULL DEFAULT false,
  paid_at TIMESTAMPTZ,
  paid_in_comanda_id UUID REFERENCES public.comandas(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT
);

CREATE TABLE public.client_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  alert_event TEXT NOT NULL DEFAULT 'agenda_and_comanda',
  target_type TEXT NOT NULL DEFAULT 'client',
  target_client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  target_tag TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.email_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  target_type TEXT NOT NULL DEFAULT 'all',
  target_tag TEXT,
  target_client_ids UUID[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  recipients_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.sms_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  message TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT 'all',
  target_tag TEXT,
  target_client_ids UUID[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  recipients_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  discount_type TEXT NOT NULL DEFAULT 'percent',
  discount_value NUMERIC NOT NULL DEFAULT 0,
  target_type TEXT NOT NULL DEFAULT 'all',
  target_service_id UUID REFERENCES public.services(id),
  target_product_id UUID REFERENCES public.products(id),
  start_date DATE,
  end_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  email_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  error_message TEXT,
  campaign_id UUID REFERENCES public.email_campaigns(id) ON DELETE SET NULL,
  resend_id TEXT,
  to_email TEXT,
  delivered_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  bounced_at TIMESTAMPTZ,
  complained_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. FUNÇÕES DE SEGURANÇA

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.get_user_salon_id(_user_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT salon_id FROM public.profiles WHERE user_id = _user_id LIMIT 1
$$;

-- 5. HABILITAR RLS EM TODAS AS TABELAS
ALTER TABLE public.salons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professionals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comandas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comanda_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professional_service_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professional_work_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professional_bank_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professional_commission_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comanda_deletions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_level_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduling_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caixas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.card_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

-- 6. POLÍTICAS RLS

-- salons
CREATE POLICY "Users can view their salon" ON public.salons FOR SELECT TO authenticated USING (id = get_user_salon_id(auth.uid()));
CREATE POLICY "Admins can update their salon" ON public.salons FOR UPDATE TO authenticated USING (id = get_user_salon_id(auth.uid()) AND has_role(auth.uid(), 'admin'));
CREATE POLICY "No direct salon inserts" ON public.salons FOR INSERT TO authenticated WITH CHECK (false);

-- profiles
CREATE POLICY "Users can view profiles in their salon or own profile" ON public.profiles FOR SELECT TO authenticated USING (user_id = auth.uid() OR salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can insert their profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- user_roles
CREATE POLICY "No direct role inserts allowed" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "Users can view roles in their salon" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid() OR salon_id = get_user_salon_id(auth.uid()));

-- system_config
CREATE POLICY "Authenticated users can read system config" ON public.system_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert system config" ON public.system_config FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update system config" ON public.system_config FOR UPDATE TO authenticated USING (true);

-- clients
CREATE POLICY "Users can view clients in their salon" ON public.clients FOR SELECT TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can insert clients in their salon" ON public.clients FOR INSERT TO authenticated WITH CHECK (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can update clients in their salon" ON public.clients FOR UPDATE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can delete clients in their salon" ON public.clients FOR DELETE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));

-- services
CREATE POLICY "Users can view services in their salon" ON public.services FOR SELECT TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can insert services in their salon" ON public.services FOR INSERT TO authenticated WITH CHECK (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can update services in their salon" ON public.services FOR UPDATE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can delete services in their salon" ON public.services FOR DELETE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));

-- professionals
CREATE POLICY "Users can view professionals in their salon" ON public.professionals FOR SELECT TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can insert professionals in their salon" ON public.professionals FOR INSERT TO authenticated WITH CHECK (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can update professionals in their salon" ON public.professionals FOR UPDATE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Admins can delete professionals in their salon" ON public.professionals FOR DELETE TO authenticated USING ((salon_id = get_user_salon_id(auth.uid())) AND has_role(auth.uid(), 'admin'::app_role));

-- appointments
CREATE POLICY "Users can view appointments in their salon" ON public.appointments FOR SELECT TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can insert appointments in their salon" ON public.appointments FOR INSERT TO authenticated WITH CHECK (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can update appointments in their salon" ON public.appointments FOR UPDATE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can delete appointments in their salon" ON public.appointments FOR DELETE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));

-- comandas
CREATE POLICY "Users can view comandas in their salon" ON public.comandas FOR SELECT TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can insert comandas in their salon" ON public.comandas FOR INSERT TO authenticated WITH CHECK (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can update comandas in their salon" ON public.comandas FOR UPDATE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can delete comandas in their salon" ON public.comandas FOR DELETE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));

-- comanda_items
CREATE POLICY "Users can view comanda items" ON public.comanda_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM comandas c WHERE c.id = comanda_id AND c.salon_id = get_user_salon_id(auth.uid())));
CREATE POLICY "Users can insert comanda items" ON public.comanda_items FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM comandas c WHERE c.id = comanda_id AND c.salon_id = get_user_salon_id(auth.uid())));
CREATE POLICY "Users can update comanda items" ON public.comanda_items FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM comandas c WHERE c.id = comanda_id AND c.salon_id = get_user_salon_id(auth.uid())));
CREATE POLICY "Users can delete comanda items" ON public.comanda_items FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM comandas c WHERE c.id = comanda_id AND c.salon_id = get_user_salon_id(auth.uid())));

-- payments
CREATE POLICY "Users can view payments in their salon" ON public.payments FOR SELECT TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can insert payments in their salon" ON public.payments FOR INSERT TO authenticated WITH CHECK (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can update payments in their salon" ON public.payments FOR UPDATE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can delete payments in their salon" ON public.payments FOR DELETE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));

-- products
CREATE POLICY "Users can view products in their salon" ON public.products FOR SELECT TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can insert products in their salon" ON public.products FOR INSERT TO authenticated WITH CHECK (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can update products in their salon" ON public.products FOR UPDATE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can delete products in their salon" ON public.products FOR DELETE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));

-- stock_movements
CREATE POLICY "Users can view stock movements in their salon" ON public.stock_movements FOR SELECT TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can insert stock movements in their salon" ON public.stock_movements FOR INSERT TO authenticated WITH CHECK (salon_id = get_user_salon_id(auth.uid()));

-- financial_transactions
CREATE POLICY "Users can view transactions in their salon" ON public.financial_transactions FOR SELECT TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can insert transactions in their salon" ON public.financial_transactions FOR INSERT TO authenticated WITH CHECK (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can update transactions in their salon" ON public.financial_transactions FOR UPDATE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can delete transactions in their salon" ON public.financial_transactions FOR DELETE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));

-- professional_service_commissions
CREATE POLICY "Users can view commissions in their salon" ON public.professional_service_commissions FOR SELECT USING (EXISTS (SELECT 1 FROM professionals p WHERE p.id = professional_service_commissions.professional_id AND p.salon_id = get_user_salon_id(auth.uid())));
CREATE POLICY "Users can insert commissions in their salon" ON public.professional_service_commissions FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM professionals p WHERE p.id = professional_service_commissions.professional_id AND p.salon_id = get_user_salon_id(auth.uid())));
CREATE POLICY "Users can update commissions in their salon" ON public.professional_service_commissions FOR UPDATE USING (EXISTS (SELECT 1 FROM professionals p WHERE p.id = professional_service_commissions.professional_id AND p.salon_id = get_user_salon_id(auth.uid())));
CREATE POLICY "Users can delete commissions in their salon" ON public.professional_service_commissions FOR DELETE USING (EXISTS (SELECT 1 FROM professionals p WHERE p.id = professional_service_commissions.professional_id AND p.salon_id = get_user_salon_id(auth.uid())));

-- professional_work_schedules
CREATE POLICY "Users can view work schedules in their salon" ON public.professional_work_schedules FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM professionals p WHERE p.id = professional_work_schedules.professional_id AND p.salon_id = get_user_salon_id(auth.uid())));
CREATE POLICY "Users can insert work schedules in their salon" ON public.professional_work_schedules FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM professionals p WHERE p.id = professional_work_schedules.professional_id AND p.salon_id = get_user_salon_id(auth.uid())));
CREATE POLICY "Users can update work schedules in their salon" ON public.professional_work_schedules FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM professionals p WHERE p.id = professional_work_schedules.professional_id AND p.salon_id = get_user_salon_id(auth.uid())));
CREATE POLICY "Users can delete work schedules in their salon" ON public.professional_work_schedules FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM professionals p WHERE p.id = professional_work_schedules.professional_id AND p.salon_id = get_user_salon_id(auth.uid())));

-- professional_bank_details
CREATE POLICY "Users can view bank details in their salon" ON public.professional_bank_details FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM professionals p WHERE p.id = professional_bank_details.professional_id AND p.salon_id = get_user_salon_id(auth.uid())));
CREATE POLICY "Users can insert bank details in their salon" ON public.professional_bank_details FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM professionals p WHERE p.id = professional_bank_details.professional_id AND p.salon_id = get_user_salon_id(auth.uid())));
CREATE POLICY "Users can update bank details in their salon" ON public.professional_bank_details FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM professionals p WHERE p.id = professional_bank_details.professional_id AND p.salon_id = get_user_salon_id(auth.uid())));
CREATE POLICY "Users can delete bank details in their salon" ON public.professional_bank_details FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM professionals p WHERE p.id = professional_bank_details.professional_id AND p.salon_id = get_user_salon_id(auth.uid())));

-- professional_commission_rules
CREATE POLICY "Users can view commission rules in their salon" ON public.professional_commission_rules FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM professionals p WHERE p.id = professional_commission_rules.professional_id AND p.salon_id = get_user_salon_id(auth.uid())));
CREATE POLICY "Users can insert commission rules in their salon" ON public.professional_commission_rules FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM professionals p WHERE p.id = professional_commission_rules.professional_id AND p.salon_id = get_user_salon_id(auth.uid())));
CREATE POLICY "Users can update commission rules in their salon" ON public.professional_commission_rules FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM professionals p WHERE p.id = professional_commission_rules.professional_id AND p.salon_id = get_user_salon_id(auth.uid())));
CREATE POLICY "Users can delete commission rules in their salon" ON public.professional_commission_rules FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM professionals p WHERE p.id = professional_commission_rules.professional_id AND p.salon_id = get_user_salon_id(auth.uid())));

-- service_products
CREATE POLICY "Users can view service products in their salon" ON public.service_products FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM services s WHERE s.id = service_products.service_id AND s.salon_id = get_user_salon_id(auth.uid())));
CREATE POLICY "Users can insert service products in their salon" ON public.service_products FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM services s WHERE s.id = service_products.service_id AND s.salon_id = get_user_salon_id(auth.uid())));
CREATE POLICY "Users can update service products in their salon" ON public.service_products FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM services s WHERE s.id = service_products.service_id AND s.salon_id = get_user_salon_id(auth.uid())));
CREATE POLICY "Users can delete service products in their salon" ON public.service_products FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM services s WHERE s.id = service_products.service_id AND s.salon_id = get_user_salon_id(auth.uid())));

-- comanda_deletions
CREATE POLICY "Users can view comanda deletions in their salon" ON public.comanda_deletions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.salon_id = (SELECT pr.salon_id FROM profiles pr WHERE pr.user_id = comanda_deletions.deleted_by LIMIT 1)));
CREATE POLICY "Users can insert comanda deletions" ON public.comanda_deletions FOR INSERT TO authenticated WITH CHECK (deleted_by = auth.uid());

-- client_history
CREATE POLICY "Users can view client history in their salon" ON public.client_history FOR SELECT TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can insert client history in their salon" ON public.client_history FOR INSERT TO authenticated WITH CHECK (salon_id = get_user_salon_id(auth.uid()));

-- access_levels
CREATE POLICY "Users can view access levels in their salon" ON public.access_levels FOR SELECT TO authenticated USING ((salon_id = get_user_salon_id(auth.uid())) OR (salon_id IS NULL));
CREATE POLICY "Admins can insert access levels in their salon" ON public.access_levels FOR INSERT TO authenticated WITH CHECK ((salon_id = get_user_salon_id(auth.uid())) AND has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update access levels in their salon" ON public.access_levels FOR UPDATE TO authenticated USING ((salon_id = get_user_salon_id(auth.uid())) AND has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete custom access levels" ON public.access_levels FOR DELETE TO authenticated USING ((salon_id = get_user_salon_id(auth.uid())) AND has_role(auth.uid(), 'admin'::app_role) AND (is_system = false));

-- access_level_permissions
CREATE POLICY "Users can view permissions" ON public.access_level_permissions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM access_levels al WHERE al.id = access_level_permissions.access_level_id AND ((al.salon_id = get_user_salon_id(auth.uid())) OR (al.salon_id IS NULL))));
CREATE POLICY "Admins can manage permissions" ON public.access_level_permissions FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM access_levels al WHERE al.id = access_level_permissions.access_level_id AND al.salon_id = get_user_salon_id(auth.uid()) AND has_role(auth.uid(), 'admin'::app_role)));

-- scheduling_settings
CREATE POLICY "Users can view scheduling settings in their salon" ON public.scheduling_settings FOR SELECT TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Admins can insert scheduling settings" ON public.scheduling_settings FOR INSERT TO authenticated WITH CHECK (salon_id = get_user_salon_id(auth.uid()) AND has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update scheduling settings" ON public.scheduling_settings FOR UPDATE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()) AND has_role(auth.uid(), 'admin'::app_role));

-- commission_settings
CREATE POLICY "Users can view commission settings in their salon" ON public.commission_settings FOR SELECT TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Admins can insert commission settings" ON public.commission_settings FOR INSERT TO authenticated WITH CHECK (salon_id = get_user_salon_id(auth.uid()) AND has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update commission settings" ON public.commission_settings FOR UPDATE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()) AND has_role(auth.uid(), 'admin'::app_role));

-- client_credits
CREATE POLICY "Users can view credits in their salon" ON public.client_credits FOR SELECT TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can insert credits in their salon" ON public.client_credits FOR INSERT TO authenticated WITH CHECK (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can update credits in their salon" ON public.client_credits FOR UPDATE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));

-- client_debts
CREATE POLICY "Users can view debts in their salon" ON public.client_debts FOR SELECT TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can insert debts in their salon" ON public.client_debts FOR INSERT TO authenticated WITH CHECK (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can update debts in their salon" ON public.client_debts FOR UPDATE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can delete debts in their salon" ON public.client_debts FOR DELETE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));

-- client_alerts
CREATE POLICY "Users can view alerts in their salon" ON public.client_alerts FOR SELECT TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can insert alerts in their salon" ON public.client_alerts FOR INSERT TO authenticated WITH CHECK (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can update alerts in their salon" ON public.client_alerts FOR UPDATE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can delete alerts in their salon" ON public.client_alerts FOR DELETE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));

-- email_campaigns
CREATE POLICY "Users can view email campaigns in their salon" ON public.email_campaigns FOR SELECT TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can insert email campaigns in their salon" ON public.email_campaigns FOR INSERT TO authenticated WITH CHECK (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can update email campaigns in their salon" ON public.email_campaigns FOR UPDATE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can delete email campaigns in their salon" ON public.email_campaigns FOR DELETE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));

-- sms_campaigns
CREATE POLICY "Users can view sms campaigns in their salon" ON public.sms_campaigns FOR SELECT TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can insert sms campaigns in their salon" ON public.sms_campaigns FOR INSERT TO authenticated WITH CHECK (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can update sms campaigns in their salon" ON public.sms_campaigns FOR UPDATE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can delete sms campaigns in their salon" ON public.sms_campaigns FOR DELETE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));

-- promotions
CREATE POLICY "Users can view promotions in their salon" ON public.promotions FOR SELECT TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can insert promotions in their salon" ON public.promotions FOR INSERT TO authenticated WITH CHECK (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can update promotions in their salon" ON public.promotions FOR UPDATE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can delete promotions in their salon" ON public.promotions FOR DELETE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));

-- email_logs
CREATE POLICY "Users can view email logs in their salon" ON public.email_logs FOR SELECT TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can insert email logs in their salon" ON public.email_logs FOR INSERT TO authenticated WITH CHECK (salon_id = get_user_salon_id(auth.uid()));

-- caixas
CREATE POLICY "Users can view caixas in their salon" ON public.caixas FOR SELECT TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can insert caixas in their salon" ON public.caixas FOR INSERT TO authenticated WITH CHECK ((salon_id = get_user_salon_id(auth.uid())) AND (user_id = auth.uid()));
CREATE POLICY "Users can update caixas in their salon" ON public.caixas FOR UPDATE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));

-- card_brands
CREATE POLICY "Users can view card brands in their salon" ON public.card_brands FOR SELECT TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can insert card brands in their salon" ON public.card_brands FOR INSERT TO authenticated WITH CHECK (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can update card brands in their salon" ON public.card_brands FOR UPDATE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can delete card brands in their salon" ON public.card_brands FOR DELETE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));

-- bank_accounts
CREATE POLICY "Users can view bank accounts in their salon" ON public.bank_accounts FOR SELECT TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can insert bank accounts in their salon" ON public.bank_accounts FOR INSERT TO authenticated WITH CHECK (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can update bank accounts in their salon" ON public.bank_accounts FOR UPDATE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can delete bank accounts in their salon" ON public.bank_accounts FOR DELETE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));

-- suppliers
CREATE POLICY "Users can view suppliers in their salon" ON public.suppliers FOR SELECT TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can insert suppliers in their salon" ON public.suppliers FOR INSERT TO authenticated WITH CHECK (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can update suppliers in their salon" ON public.suppliers FOR UPDATE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can delete suppliers in their salon" ON public.suppliers FOR DELETE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));

-- 7. TRIGGERS para updated_at
CREATE TRIGGER update_salons_updated_at BEFORE UPDATE ON public.salons FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_services_updated_at BEFORE UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_professionals_updated_at BEFORE UPDATE ON public.professionals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_appointments_updated_at BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_comandas_updated_at BEFORE UPDATE ON public.comandas FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Auto-increment comanda_number per salon
CREATE OR REPLACE FUNCTION public.set_comanda_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.comanda_number IS NULL THEN
    SELECT COALESCE(MAX(comanda_number), 0) + 1 INTO NEW.comanda_number
    FROM comandas WHERE salon_id = NEW.salon_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_set_comanda_number BEFORE INSERT ON public.comandas FOR EACH ROW EXECUTE FUNCTION set_comanda_number();

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_caixas_updated_at BEFORE UPDATE ON public.caixas FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_card_brands_updated_at BEFORE UPDATE ON public.card_brands FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_bank_accounts_updated_at BEFORE UPDATE ON public.bank_accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_suppliers_updated_at BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_professional_service_commissions_updated_at BEFORE UPDATE ON public.professional_service_commissions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_service_products_updated_at BEFORE UPDATE ON public.service_products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_access_levels_updated_at BEFORE UPDATE ON public.access_levels FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_client_alerts_updated_at BEFORE UPDATE ON public.client_alerts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_commission_settings_updated_at BEFORE UPDATE ON public.commission_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_scheduling_settings_updated_at BEFORE UPDATE ON public.scheduling_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_email_campaigns_updated_at BEFORE UPDATE ON public.email_campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_sms_campaigns_updated_at BEFORE UPDATE ON public.sms_campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_promotions_updated_at BEFORE UPDATE ON public.promotions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 8. ÍNDICES
CREATE INDEX idx_profiles_salon_id ON public.profiles(salon_id);
CREATE INDEX idx_profiles_user_id ON public.profiles(user_id);
CREATE INDEX idx_clients_salon_id ON public.clients(salon_id);
CREATE INDEX idx_clients_name ON public.clients(name);
CREATE INDEX idx_services_salon_id ON public.services(salon_id);
CREATE INDEX idx_professionals_salon_id ON public.professionals(salon_id);
CREATE INDEX idx_appointments_salon_id ON public.appointments(salon_id);
CREATE INDEX idx_appointments_professional_id ON public.appointments(professional_id);
CREATE INDEX idx_appointments_scheduled_at ON public.appointments(scheduled_at);
CREATE INDEX idx_comandas_salon_id ON public.comandas(salon_id);
CREATE INDEX idx_comanda_items_comanda_id ON public.comanda_items(comanda_id);
CREATE INDEX idx_comanda_items_professional_id ON public.comanda_items(professional_id);
CREATE INDEX idx_payments_salon_id ON public.payments(salon_id);
CREATE INDEX idx_financial_transactions_salon_id ON public.financial_transactions(salon_id);
CREATE INDEX idx_financial_transactions_date ON public.financial_transactions(transaction_date);
CREATE INDEX idx_products_salon_id ON public.products(salon_id);
CREATE INDEX idx_user_roles_user_id ON public.user_roles(user_id);

-- 9. UNIQUE INDEX for comanda_items
CREATE UNIQUE INDEX idx_comanda_items_unique_appointment ON public.comanda_items (comanda_id, source_appointment_id) WHERE source_appointment_id IS NOT NULL;

-- 10. STORAGE BUCKET para avatares
INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true) ON CONFLICT (id) DO NOTHING;
CREATE POLICY "Avatar images are publicly accessible" ON storage.objects FOR SELECT USING (bucket_id = 'avatars');
CREATE POLICY "Authenticated users can upload avatars" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'avatars' AND auth.role() = 'authenticated');
CREATE POLICY "Users can update avatars" ON storage.objects FOR UPDATE USING (bucket_id = 'avatars' AND auth.role() = 'authenticated');
CREATE POLICY "Users can delete avatars" ON storage.objects FOR DELETE USING (bucket_id = 'avatars' AND auth.role() = 'authenticated');

-- 11. FUNÇÃO DE VERIFICAÇÃO DE SETUP (necessária para o App.tsx)
CREATE OR REPLACE FUNCTION public.is_setup_done()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS(SELECT 1 FROM public.salons LIMIT 1);
$$;

GRANT EXECUTE ON FUNCTION public.is_setup_done() TO anon;
GRANT EXECUTE ON FUNCTION public.is_setup_done() TO authenticated;

-- ============================================================
-- 12. SISTEMA DE PACOTES
-- ============================================================

CREATE TABLE public.packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID REFERENCES public.salons(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC NOT NULL DEFAULT 0,
  original_price NUMERIC NOT NULL DEFAULT 0,
  discount_percent NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.package_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID REFERENCES public.packages(id) ON DELETE CASCADE NOT NULL,
  service_id UUID REFERENCES public.services(id) ON DELETE CASCADE NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.client_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID REFERENCES public.salons(id) ON DELETE CASCADE NOT NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  package_id UUID REFERENCES public.packages(id) ON DELETE CASCADE NOT NULL,
  purchase_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_paid NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.client_package_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_package_id UUID REFERENCES public.client_packages(id) ON DELETE CASCADE NOT NULL,
  service_id UUID REFERENCES public.services(id) ON DELETE SET NULL,
  used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  professional_id UUID REFERENCES public.professionals(id) ON DELETE SET NULL,
  comanda_id UUID REFERENCES public.comandas(id) ON DELETE SET NULL,
  notes TEXT
);

-- RLS for packages
ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view packages in their salon" ON public.packages FOR SELECT TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can insert packages in their salon" ON public.packages FOR INSERT TO authenticated WITH CHECK (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can update packages in their salon" ON public.packages FOR UPDATE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can delete packages in their salon" ON public.packages FOR DELETE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));

-- RLS for package_items
ALTER TABLE public.package_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view package items" ON public.package_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM packages p WHERE p.id = package_id AND p.salon_id = get_user_salon_id(auth.uid())));
CREATE POLICY "Users can insert package items" ON public.package_items FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM packages p WHERE p.id = package_id AND p.salon_id = get_user_salon_id(auth.uid())));
CREATE POLICY "Users can update package items" ON public.package_items FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM packages p WHERE p.id = package_id AND p.salon_id = get_user_salon_id(auth.uid())));
CREATE POLICY "Users can delete package items" ON public.package_items FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM packages p WHERE p.id = package_id AND p.salon_id = get_user_salon_id(auth.uid())));

-- RLS for client_packages
ALTER TABLE public.client_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view client packages in their salon" ON public.client_packages FOR SELECT TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can insert client packages in their salon" ON public.client_packages FOR INSERT TO authenticated WITH CHECK (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can update client packages in their salon" ON public.client_packages FOR UPDATE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can delete client packages in their salon" ON public.client_packages FOR DELETE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));

-- RLS for client_package_usage
ALTER TABLE public.client_package_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view client package usage" ON public.client_package_usage FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM client_packages cp WHERE cp.id = client_package_id AND cp.salon_id = get_user_salon_id(auth.uid())));
CREATE POLICY "Users can insert client package usage" ON public.client_package_usage FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM client_packages cp WHERE cp.id = client_package_id AND cp.salon_id = get_user_salon_id(auth.uid())));
CREATE POLICY "Users can delete client package usage" ON public.client_package_usage FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM client_packages cp WHERE cp.id = client_package_id AND cp.salon_id = get_user_salon_id(auth.uid())));

-- Triggers for packages
CREATE TRIGGER update_packages_updated_at BEFORE UPDATE ON public.packages FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Indexes for packages
CREATE INDEX idx_packages_salon_id ON public.packages(salon_id);
CREATE INDEX idx_package_items_package_id ON public.package_items(package_id);
CREATE INDEX idx_client_packages_salon_id ON public.client_packages(salon_id);
CREATE INDEX idx_client_packages_client_id ON public.client_packages(client_id);
CREATE INDEX idx_client_package_usage_client_package_id ON public.client_package_usage(client_package_id);

-- ============================================================
-- 13. SISTEMA FINANCEIRO DO CLIENTE (client_balance)
-- ============================================================

CREATE TABLE public.client_balance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID REFERENCES public.salons(id) ON DELETE CASCADE NOT NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('credit', 'debt')),
  amount DECIMAL(10,2) NOT NULL,
  description TEXT,
  comanda_id UUID REFERENCES public.comandas(id),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.client_balance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view client balance in their salon" ON public.client_balance FOR SELECT TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can insert client balance in their salon" ON public.client_balance FOR INSERT TO authenticated WITH CHECK (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can update client balance in their salon" ON public.client_balance FOR UPDATE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));
CREATE POLICY "Users can delete client balance in their salon" ON public.client_balance FOR DELETE TO authenticated USING (salon_id = get_user_salon_id(auth.uid()));

CREATE INDEX idx_client_balance_salon_id ON public.client_balance(salon_id);
CREATE INDEX idx_client_balance_client_id ON public.client_balance(client_id);

-- 14. PRODUTOS CONSUMIDOS POR ITEM DA COMANDA (comanda_item_products)
CREATE TABLE IF NOT EXISTS public.comanda_item_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comanda_item_id UUID REFERENCES public.comanda_items(id) ON DELETE CASCADE NOT NULL,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity_units INTEGER NOT NULL DEFAULT 0,
  quantity_fractional NUMERIC NOT NULL DEFAULT 0,
  unit_of_measure TEXT NOT NULL DEFAULT 'unidade',
  unit_quantity NUMERIC NOT NULL DEFAULT 1,
  cost_per_unit NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.comanda_item_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY cip_select ON public.comanda_item_products FOR SELECT USING (
  EXISTS (SELECT 1 FROM comanda_items ci JOIN comandas c ON c.id = ci.comanda_id WHERE ci.id = comanda_item_products.comanda_item_id AND c.salon_id = get_user_salon_id(auth.uid()))
);
CREATE POLICY cip_insert ON public.comanda_item_products FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM comanda_items ci JOIN comandas c ON c.id = ci.comanda_id WHERE ci.id = comanda_item_products.comanda_item_id AND c.salon_id = get_user_salon_id(auth.uid()))
);
CREATE POLICY cip_update ON public.comanda_item_products FOR UPDATE USING (
  EXISTS (SELECT 1 FROM comanda_items ci JOIN comandas c ON c.id = ci.comanda_id WHERE ci.id = comanda_item_products.comanda_item_id AND c.salon_id = get_user_salon_id(auth.uid()))
);
CREATE POLICY cip_delete ON public.comanda_item_products FOR DELETE USING (
  EXISTS (SELECT 1 FROM comanda_items ci JOIN comandas c ON c.id = ci.comanda_id WHERE ci.id = comanda_item_products.comanda_item_id AND c.salon_id = get_user_salon_id(auth.uid()))
);

CREATE INDEX idx_cip_comanda_item_id ON public.comanda_item_products(comanda_item_id);
CREATE INDEX idx_cip_product_id ON public.comanda_item_products(product_id);

-- ============================================================
-- FILA DIGITAL (CRM Sua Vez Express)
-- ============================================================

CREATE TYPE queue_status AS ENUM ('waiting', 'checked_in', 'in_service', 'completed', 'cancelled', 'no_show');
CREATE TYPE queue_source AS ENUM ('online', 'walk_in');
CREATE TYPE queue_payment_status AS ENUM ('pending', 'confirmed', 'refunded', 'credit');

CREATE TABLE public.queue_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID NOT NULL,
  customer_id UUID,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  service_id UUID NOT NULL,
  status queue_status NOT NULL DEFAULT 'waiting',
  source queue_source NOT NULL DEFAULT 'online',
  position INTEGER NOT NULL,
  payment_id TEXT,
  payment_status queue_payment_status DEFAULT 'pending',
  notify_minutes_before INTEGER DEFAULT 40,
  notify_sent BOOLEAN NOT NULL DEFAULT FALSE,
  notify_next_sent BOOLEAN NOT NULL DEFAULT FALSE,
  estimated_time TIMESTAMPTZ,
  checked_in_at TIMESTAMPTZ,
  assigned_professional_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.queue_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  max_queue_size INTEGER NOT NULL DEFAULT 3,
  notified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.customer_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID NOT NULL,
  customer_id UUID,
  customer_phone TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  origin_queue_entry_id UUID REFERENCES queue_entries(id),
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.queue_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID NOT NULL UNIQUE,
  inflation_factor DECIMAL(3,2) NOT NULL DEFAULT 1.70,
  credit_validity_days INTEGER NOT NULL DEFAULT 30,
  notify_options JSONB NOT NULL DEFAULT '[20, 40, 60, 90]',
  reception_email TEXT,
  zapi_instance_id TEXT,
  zapi_token TEXT,
  asaas_api_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_queue_entries_salon_status ON queue_entries(salon_id, status);
CREATE INDEX idx_queue_entries_position ON queue_entries(salon_id, position);
CREATE INDEX idx_queue_leads_salon ON queue_leads(salon_id, notified);
CREATE INDEX idx_customer_credits_phone ON customer_credits(customer_phone, used, expires_at);

ALTER TABLE queue_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY queue_entries_salon ON queue_entries FOR ALL USING (salon_id IN (SELECT salon_id FROM profiles WHERE user_id = auth.uid()));
CREATE POLICY queue_leads_salon ON queue_leads FOR SELECT USING (salon_id IN (SELECT salon_id FROM profiles WHERE user_id = auth.uid()));
CREATE POLICY queue_leads_update ON queue_leads FOR UPDATE USING (salon_id IN (SELECT salon_id FROM profiles WHERE user_id = auth.uid()));
CREATE POLICY queue_leads_delete ON queue_leads FOR DELETE USING (salon_id IN (SELECT salon_id FROM profiles WHERE user_id = auth.uid()));
CREATE POLICY customer_credits_salon ON customer_credits FOR ALL USING (salon_id IN (SELECT salon_id FROM profiles WHERE user_id = auth.uid()));
CREATE POLICY queue_settings_salon ON queue_settings FOR ALL USING (salon_id IN (SELECT salon_id FROM profiles WHERE user_id = auth.uid()));

CREATE POLICY queue_entries_anon_read ON queue_entries FOR SELECT USING (TRUE);
CREATE POLICY queue_entries_anon_insert ON queue_entries FOR INSERT WITH CHECK (TRUE);
CREATE POLICY queue_leads_anon_insert ON queue_leads FOR INSERT WITH CHECK (TRUE);
CREATE POLICY queue_settings_anon_read ON queue_settings FOR SELECT USING (TRUE);

-- ============================================================
-- Schema criado com sucesso! Agora volte ao instalador.
-- ============================================================
`;
