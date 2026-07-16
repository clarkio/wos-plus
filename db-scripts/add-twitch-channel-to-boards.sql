-- Add a twitch_channel column to the boards table so each board records the
-- Twitch channel it was captured from.
--
-- Usage (via psql or Supabase SQL Editor):
--   \i db-scripts/add-twitch-channel-to-boards.sql
--
-- Or run directly in the Supabase SQL Editor
--
-- The column is nullable because boards saved before this change have no
-- channel information. The self-healing update path (PUT /api/boards/:id)
-- back-fills it when a corrupted board is replaced with a clean capture.

ALTER TABLE boards ADD COLUMN IF NOT EXISTS twitch_channel TEXT;
