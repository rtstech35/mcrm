-- Migration 001: Add shipping_target and shipping_achieved to user_targets table
-- This script is safe to run on an existing database as it uses IF NOT EXISTS.

ALTER TABLE user_targets
ADD COLUMN IF NOT EXISTS shipping_target INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS shipping_achieved INTEGER DEFAULT 0;

COMMENT ON COLUMN user_targets.shipping_target IS 'Aylık sevkiyat hedefi (adet)';
COMMENT ON COLUMN user_targets.shipping_achieved IS 'Gerçekleşen sevkiyat';