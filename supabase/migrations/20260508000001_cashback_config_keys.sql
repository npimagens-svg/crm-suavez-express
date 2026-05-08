-- Cashback configuration keys in system_config
-- Adds: enabled (toggle global), validity_days (was hardcoded 15), min_purchase (was hardcoded R$100)
-- cashback_percent already exists.

INSERT INTO system_config (key, value)
VALUES
  ('cashback_enabled', 'true'),
  ('cashback_validity_days', '15'),
  ('cashback_min_purchase', '100')
ON CONFLICT (key) DO NOTHING;
