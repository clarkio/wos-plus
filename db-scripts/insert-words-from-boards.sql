-- Insert words from boards.slots into the words table
-- This SQL script does the same thing as insert-words-from-boards.mjs
--
-- Usage (via psql or Supabase SQL Editor):
--   \i db-scripts/insert-words-from-boards.sql
--
-- Or run directly in the Supabase SQL Editor

-- Create a temp table to track counts
CREATE TEMP TABLE IF NOT EXISTS _insert_stats (
    words_before INTEGER,
    unique_words_in_boards INTEGER,
    words_after INTEGER
);
TRUNCATE _insert_stats;

-- Count words before insert
INSERT INTO _insert_stats (words_before, unique_words_in_boards, words_after)
SELECT
    (SELECT COUNT(*) FROM words WHERE language_code = 'en'),
    (SELECT COUNT(DISTINCT LOWER(TRIM(slot_obj->>'word')))
     FROM boards, jsonb_array_elements(slots) AS slot_obj
     WHERE slots IS NOT NULL
       AND jsonb_typeof(slots) = 'array'
       AND slot_obj->>'word' IS NOT NULL
       AND TRIM(slot_obj->>'word') != ''),
    0;

-- Insert unique words extracted from boards.slots that don't already exist
INSERT INTO words (id, language_code, word, normalized_word, created_at, updated_at)
SELECT
    gen_random_uuid() AS id,
    'en' AS language_code,
    LOWER(TRIM(slot_word)) AS word,
    LOWER(TRIM(slot_word)) AS normalized_word,
    NOW() AS created_at,
    NOW() AS updated_at
FROM (
    SELECT DISTINCT
        slot_obj->>'word' AS slot_word
    FROM
        boards,
        jsonb_array_elements(slots) AS slot_obj
    WHERE
        slots IS NOT NULL
        AND jsonb_typeof(slots) = 'array'
        AND slot_obj->>'word' IS NOT NULL
        AND TRIM(slot_obj->>'word') != ''
) AS extracted_words
WHERE
    NOT EXISTS (
        SELECT 1
        FROM words w
        WHERE w.language_code = 'en'
          AND w.normalized_word = LOWER(TRIM(slot_word))
    );

-- Update words_after count
UPDATE _insert_stats
SET words_after = (SELECT COUNT(*) FROM words WHERE language_code = 'en');

-- Return results as a table (visible in Supabase SQL Editor)
SELECT
    words_before AS "Words Before",
    unique_words_in_boards AS "Unique Words in Boards",
    (words_after - words_before) AS "Words Inserted",
    (unique_words_in_boards - (words_after - words_before)) AS "Words Skipped (Already Existed)",
    words_after AS "Words After"
FROM _insert_stats;
