-- Migration 003: Add mobile_phone column to customers table
-- This ensures the database schema is up-to-date with the application code.

ALTER TABLE customers
ADD COLUMN IF NOT EXISTS mobile_phone VARCHAR(20);

COMMENT ON COLUMN customers.mobile_phone IS 'Reklam ve SMS için cep telefonu';