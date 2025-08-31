-- Migration 002: Change quantity column type in delivery_note_items
-- This migration changes the quantity column from INTEGER to DECIMAL(10, 2)
-- to match the order_items table and allow for fractional quantities.

ALTER TABLE delivery_note_items
ALTER COLUMN quantity TYPE DECIMAL(10, 2);