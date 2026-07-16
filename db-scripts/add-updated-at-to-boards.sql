-- Add an updated_at column to the boards table so each board records when it
-- was last updated, and a trigger that stamps it automatically on any UPDATE
-- to a boards row — whether it came from the API (e.g. the self-healing
-- PUT /api/boards/:id), a db-script, or manual SQL.
--
-- Usage (via psql or Supabase SQL Editor):
--   \i db-scripts/add-updated-at-to-boards.sql
--
-- Or run directly in the Supabase SQL Editor
--
-- The column is nullable and has no default: NULL means the board has never
-- been updated since it was saved (created_at already records the save time).
-- The trigger overrides any client-supplied value, so updated_at is always
-- server time and can't be spoofed through the API.

ALTER TABLE boards ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION set_boards_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS boards_set_updated_at ON boards;

-- The WHEN clause skips no-op updates so updated_at only moves when a row's
-- data actually changed.
CREATE TRIGGER boards_set_updated_at
  BEFORE UPDATE ON boards
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_boards_updated_at();
