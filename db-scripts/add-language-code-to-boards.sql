-- Add a language_code column to the boards table so each board records the
-- language of the words on it (issue #124).
--
-- Words on Stream supports three word languages and indicates the active one
-- on its socket events as a numeric id. The official wos.gg client resolves
-- that id through its /api/language?id=N endpoint:
--   1 -> 'pt' (Português), 2 -> 'en' (English), 4 -> 'fr' (Français)
-- WoS+ maps the id to the two-letter code client-side (see
-- src/lib/board-utils.ts) and sends it when saving a board.
--
-- Usage (via psql or Supabase SQL Editor):
--   \i db-scripts/add-language-code-to-boards.sql
--
-- Or run directly in the Supabase SQL Editor
--
-- The column defaults to 'en': every board saved before language capture
-- existed came from English games (the only language WoS+ supported), so the
-- default both back-fills existing rows and covers clients that predate the
-- language field. The CHECK constraint keeps the column limited to the codes
-- WoS actually supports; extend it if WoS adds languages. This matches the
-- words table, which already stores a language_code per word.

ALTER TABLE boards ADD COLUMN IF NOT EXISTS language_code TEXT NOT NULL DEFAULT 'en';

ALTER TABLE boards DROP CONSTRAINT IF EXISTS boards_language_code_check;

ALTER TABLE boards ADD CONSTRAINT boards_language_code_check
  CHECK (language_code IN ('en', 'pt', 'fr'));
