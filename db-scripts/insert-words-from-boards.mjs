import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

function parseArgs(argv) {
  const args = {
    apply: false,
    pageSize: 500,
    limit: Infinity,
    insertChunkSize: 500,
    languageCode: "en",
    preloadExisting: true,
  };

  for (const raw of argv) {
    if (raw === "--apply") {
      args.apply = true;
      continue;
    }

    if (raw === "--no-preload-existing") {
      args.preloadExisting = false;
      continue;
    }

    if (raw.startsWith("--page-size=")) {
      const value = Number(raw.split("=")[1]);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Invalid --page-size value: ${raw}`);
      }
      args.pageSize = Math.floor(value);
      continue;
    }

    if (raw.startsWith("--insert-chunk-size=")) {
      const value = Number(raw.split("=")[1]);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Invalid --insert-chunk-size value: ${raw}`);
      }
      args.insertChunkSize = Math.floor(value);
      continue;
    }

    if (raw.startsWith("--limit=")) {
      const value = Number(raw.split("=")[1]);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Invalid --limit value: ${raw}`);
      }
      args.limit = Math.floor(value);
      continue;
    }

    if (raw.startsWith("--language-code=")) {
      const value = String(raw.split("=")[1] ?? "").trim();
      if (!value) {
        throw new Error(`Invalid --language-code value: ${raw}`);
      }
      args.languageCode = value;
      continue;
    }

    if (raw === "--help" || raw === "-h") {
      args.help = true;
      continue;
    }

    throw new Error(`Unknown argument: ${raw}`);
  }

  return args;
}

function usage() {
  return `Insert words from boards.slots into words table

Reads each row from the boards table, extracts slot.word values, normalizes them,
and inserts new words into the words table.

Usage:
  SUPABASE_URL=... SUPABASE_KEY=... node db-scripts/insert-words-from-boards.mjs [options]

Options:
  --apply                    Actually inserts rows (default: dry-run)
  --page-size=N              Boards rows to fetch per page (default: 500)
  --limit=N                  Max boards rows to process (default: unlimited)
  --insert-chunk-size=N      Max words rows per insert call (default: 500)
  --language-code=CODE       Language code to store (default: en)
  --no-preload-existing      Skip loading existing words to avoid duplicates (default: false)
`;
}

function coerceSlots(slots) {
  if (slots == null) return null;
  if (Array.isArray(slots)) return slots;

  if (typeof slots === "string") {
    try {
      const parsed = JSON.parse(slots);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeWord(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function chunk(array, chunkSize) {
  const out = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    out.push(array.slice(i, i + chunkSize));
  }
  return out;
}

async function fetchExistingNormalizedWordsForBatch(
  supabase,
  languageCode,
  normalizedWords
) {
  const normalized = normalizedWords
    .map((value) => normalizeWord(value))
    .filter(Boolean);

  if (normalized.length === 0) {
    return new Set();
  }

  const { data: rows, error } = await supabase
    .from("words")
    .select("normalized_word")
    .eq("language_code", languageCode)
    .in("normalized_word", normalized);

  if (error) {
    throw new Error(
      `Failed to fetch existing words for batch: ${error.message}`
    );
  }

  const existing = new Set();
  for (const row of rows ?? []) {
    const value = normalizeWord(row?.normalized_word);
    if (value) existing.add(value);
  }
  return existing;
}

async function loadExistingNormalizedWords(
  supabase,
  languageCode,
  pageSize = 5000
) {
  const existing = new Set();

  // Use deterministic keyset pagination instead of range pagination.
  // Range pagination without an explicit order can miss rows.
  // Also, many PostgREST setups cap max rows returned; keep pageSize <= 1000.
  const effectivePageSize = Math.min(Math.max(1, pageSize), 1000);
  let lastNormalized = null;
  let page = 0;

  while (true) {
    let query = supabase
      .from("words")
      .select("normalized_word")
      .eq("language_code", languageCode)
      .not("normalized_word", "is", null)
      .order("normalized_word", { ascending: true })
      .limit(effectivePageSize);

    if (lastNormalized) {
      query = query.gt("normalized_word", lastNormalized);
    }

    const { data: rows, error } = await query;

    if (error) {
      throw new Error(
        `Failed to fetch existing words (page ${page}, after=${JSON.stringify(
          lastNormalized
        )}): ${error.message}`
      );
    }

    if (!rows || rows.length === 0) {
      break;
    }

    for (const row of rows) {
      const normalized = normalizeWord(row?.normalized_word);
      if (normalized) {
        existing.add(normalized);
      }
    }

    lastNormalized = rows[rows.length - 1]?.normalized_word ?? lastNormalized;
    page += 1;

    if (rows.length < effectivePageSize) {
      break;
    }
  }

  return existing;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(usage());
    process.exit(0);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_KEY in environment.");
    console.error(usage());
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  console.log(
    `Mode: ${
      args.apply ? "APPLY (inserts will be written)" : "DRY-RUN (no writes)"
    }`
  );
  console.log(`Boards page size: ${args.pageSize}`);
  console.log(`Insert chunk size: ${args.insertChunkSize}`);
  console.log(`Language code: ${args.languageCode}`);
  console.log(`Preload existing: ${args.preloadExisting ? "yes" : "no"}`);

  const nowIso = new Date().toISOString();

  let existingNormalizedWords = new Set();
  if (args.preloadExisting) {
    console.log("Loading existing words...");
    existingNormalizedWords = await loadExistingNormalizedWords(
      supabase,
      args.languageCode
    );
    console.log(
      `Loaded ${existingNormalizedWords.size} existing normalized words.`
    );
  }

  let processedBoards = 0;
  let processedSlots = 0;
  let extractedWords = 0;

  const discoveredNormalized = new Set();
  const normalizedToWord = new Map();

  let page = 0;
  while (processedBoards < args.limit) {
    const from = page * args.pageSize;
    const to = from + args.pageSize - 1;

    const { data: rows, error } = await supabase
      .from("boards")
      .select("id, slots")
      .range(from, to);

    if (error) {
      throw new Error(
        `Failed to fetch boards rows (range ${from}-${to}): ${error.message}`
      );
    }

    if (!rows || rows.length === 0) {
      break;
    }

    for (const row of rows) {
      if (processedBoards >= args.limit) break;
      processedBoards += 1;

      const slots = coerceSlots(row?.slots);
      if (!Array.isArray(slots) || slots.length === 0) {
        continue;
      }

      for (const slot of slots) {
        processedSlots += 1;

        const rawWord = slot && typeof slot === "object" ? slot.word : null;
        const normalized = normalizeWord(rawWord);

        if (!normalized) {
          continue;
        }

        extractedWords += 1;

        if (existingNormalizedWords.has(normalized)) {
          continue;
        }

        if (discoveredNormalized.has(normalized)) {
          continue;
        }

        discoveredNormalized.add(normalized);
        normalizedToWord.set(normalized, normalized);
      }
    }

    page += 1;
    if (rows.length < args.pageSize) {
      break;
    }
  }

  const toInsert = Array.from(discoveredNormalized)
    .sort((a, b) => a.localeCompare(b))
    .map((normalized) => {
      const word = normalizedToWord.get(normalized) || normalized;
      return {
        id: crypto.randomUUID(),
        language_code: args.languageCode,
        word,
        normalized_word: normalized,
        created_at: nowIso,
        updated_at: nowIso,
      };
    });

  console.log("---");
  console.log(`Boards processed: ${processedBoards}`);
  console.log(`Slots processed:  ${processedSlots}`);
  console.log(`Words observed:   ${extractedWords}`);
  console.log(`Words to insert:  ${toInsert.length}`);

  if (!args.apply) {
    const preview = toInsert.slice(0, 25).map((row) => row.word);
    if (preview.length > 0) {
      console.log("Preview (first 25):");
      for (const word of preview) {
        console.log(`  - ${word}`);
      }
    }
    return;
  }

  if (toInsert.length === 0) {
    console.log("No new words to insert.");
    return;
  }

  let inserted = 0;
  let skippedExisting = 0;

  const batches = chunk(toInsert, args.insertChunkSize);
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    // Always check the DB for existing words in this batch so the script is safe to re-run,
    // even when --no-preload-existing is used.
    const existingInDb = await fetchExistingNormalizedWordsForBatch(
      supabase,
      args.languageCode,
      batch.map((row) => row.normalized_word)
    );

    if (existingInDb.size > 0) {
      for (const normalized of existingInDb) {
        existingNormalizedWords.add(normalized);
      }
    }

    const batchToInsert = batch.filter(
      (row) => !existingNormalizedWords.has(normalizeWord(row.normalized_word))
    );

    skippedExisting += batch.length - batchToInsert.length;

    if (batchToInsert.length === 0) {
      console.log(
        `Batch ${i + 1}/${batches.length}: all ${
          batch.length
        } already exist; skipping.`
      );
      continue;
    }

    const { error: insertError } = await supabase
      .from("words")
      .insert(batchToInsert);

    if (insertError) {
      throw new Error(
        `Insert failed for batch ${i + 1}/${batches.length} (size ${
          batch.length
        }): ${insertError.message}`
      );
    }

    inserted += batchToInsert.length;

    // Update local set so later batches (and re-runs without preload) skip properly.
    for (const row of batchToInsert) {
      const normalized = normalizeWord(row.normalized_word);
      if (normalized) existingNormalizedWords.add(normalized);
    }

    console.log(
      `Inserted ${inserted}/${toInsert.length} (skipped existing so far: ${skippedExisting})...`
    );
  }

  console.log("---");
  console.log(`Total inserted: ${inserted}`);
  console.log(`Total skipped (already existed): ${skippedExisting}`);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
