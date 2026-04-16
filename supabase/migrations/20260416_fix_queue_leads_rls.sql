-- Fix: all queue policies used profiles.id instead of profiles.user_id
-- auth.uid() returns the auth user id which maps to profiles.user_id, not profiles.id

-- queue_leads: split FOR ALL into separate + fix user_id
DROP POLICY IF EXISTS queue_leads_salon ON queue_leads;
CREATE POLICY queue_leads_salon ON queue_leads
  FOR SELECT USING (salon_id IN (SELECT salon_id FROM profiles WHERE user_id = auth.uid()));
CREATE POLICY queue_leads_update ON queue_leads
  FOR UPDATE USING (salon_id IN (SELECT salon_id FROM profiles WHERE user_id = auth.uid()));
CREATE POLICY queue_leads_delete ON queue_leads
  FOR DELETE USING (salon_id IN (SELECT salon_id FROM profiles WHERE user_id = auth.uid()));

-- queue_entries
DROP POLICY IF EXISTS queue_entries_salon ON queue_entries;
CREATE POLICY queue_entries_salon ON queue_entries
  FOR ALL USING (salon_id IN (SELECT salon_id FROM profiles WHERE user_id = auth.uid()));

-- customer_credits
DROP POLICY IF EXISTS customer_credits_salon ON customer_credits;
CREATE POLICY customer_credits_salon ON customer_credits
  FOR ALL USING (salon_id IN (SELECT salon_id FROM profiles WHERE user_id = auth.uid()));

-- queue_settings
DROP POLICY IF EXISTS queue_settings_salon ON queue_settings;
CREATE POLICY queue_settings_salon ON queue_settings
  FOR ALL USING (salon_id IN (SELECT salon_id FROM profiles WHERE user_id = auth.uid()));
