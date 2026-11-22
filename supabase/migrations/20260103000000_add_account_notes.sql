-- ==============================================================================
-- Migration: Add notes column to financial accounts
-- Milestone: 5.1 Account Management
-- Description: Adds an optional user notes field to the accounts table.
-- ==============================================================================

ALTER TABLE public.accounts
ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN public.accounts.notes IS 'Optional user notes or remarks regarding this financial account.';
