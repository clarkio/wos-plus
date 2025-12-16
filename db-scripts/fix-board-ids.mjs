import { createClient } from "@supabase/supabase-js";

function parseArgs(argv) {
  const args = {
    apply: false,
    pageSize: 500,
    limit: Infinity,
  };

  for (const raw of argv) {
    if (raw === "--apply") {
      args.apply = true;
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

    if (raw.startsWith("--limit=")) {
      const value = Number(raw.split("=")[1]);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Invalid --limit value: ${raw}`);
      }
      args.limit = Math.floor(value);
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
  return `Fix boards.id to match last slot word

If an id update fails due to a duplicate key, the script will fetch the existing row
for the desired id and compare its slots to the mismatched row's slots (by slot "word" values).
If they match,
the mismatched row is safe to delete (when running with --apply).

Usage:
  SUPABASE_URL=... SUPABASE_KEY=... node db-scripts/fix-board-ids.mjs [--apply] [--page-size=500] [--limit=1000]

Options:
  --apply            Actually updates rows (default: dry-run)
  --page-size=N      Rows to fetch per page (default: 500)
  --limit=N          Max rows to process (default: unlimited)
`;
}

function normalizeId(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
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

  // Supabase sometimes returns JSON columns as objects already.
  return null;
}

function getLastSlotWord(slotsArray) {
  if (!Array.isArray(slotsArray) || slotsArray.length === 0) return null;
  const last = slotsArray[slotsArray.length - 1];
  if (!last || typeof last !== "object") return null;

  if (typeof last.word === "string" && last.word.trim().length > 0) {
    return last.word;
  }

  return null;
}

function isDuplicateKeyError(error) {
  if (!error) return false;
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message : "";
  const details = typeof error.details === "string" ? error.details : "";

  return (
    code === "23505" ||
    /duplicate key/i.test(message) ||
    /duplicate key/i.test(details) ||
    /already exists/i.test(message)
  );
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }

  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    const out = {};
    for (const key of keys) {
      out[key] = sortKeysDeep(value[key]);
    }
    return out;
  }

  return value;
}

function stableJsonStringify(value) {
  return JSON.stringify(sortKeysDeep(value));
}

function normalizeSlotWord(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function slotsToWordSignature(slotsArray) {
  if (!Array.isArray(slotsArray)) return null;

  return slotsArray.map((slot) => {
    if (!slot || typeof slot !== "object") return "";
    return normalizeSlotWord(slot.word);
  });
}

function stableWordSignatureStringify(slotsArray) {
  const signature = slotsToWordSignature(slotsArray);
  return signature ? JSON.stringify(signature) : null;
}

function formatDiffValue(value) {
  if (typeof value === "string") {
    const trimmed = value.length > 120 ? value.slice(0, 117) + "..." : value;
    return JSON.stringify(trimmed);
  }

  if (value === undefined) return "undefined";
  if (value === null) return "null";

  try {
    const json = JSON.stringify(value);
    return json.length > 180 ? json.slice(0, 177) + "..." : json;
  } catch {
    return String(value);
  }
}

function collectDiffs(a, b, path, out, maxDiffs) {
  if (out.length >= maxDiffs) return;

  if (a === b) return;

  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);

  if (aIsArray || bIsArray) {
    if (!aIsArray || !bIsArray) {
      out.push(`${path}: ${formatDiffValue(a)} !== ${formatDiffValue(b)}`);
      return;
    }

    if (a.length !== b.length) {
      out.push(`${path}.length: ${a.length} !== ${b.length}`);
      if (out.length >= maxDiffs) return;
    }

    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      collectDiffs(a[i], b[i], `${path}[${i}]`, out, maxDiffs);
      if (out.length >= maxDiffs) return;
    }

    return;
  }

  const aIsObject = a && typeof a === "object";
  const bIsObject = b && typeof b === "object";

  if (aIsObject || bIsObject) {
    if (!aIsObject || !bIsObject) {
      out.push(`${path}: ${formatDiffValue(a)} !== ${formatDiffValue(b)}`);
      return;
    }

    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    const keySet = new Set([...aKeys, ...bKeys]);

    for (const key of Array.from(keySet).sort()) {
      if (out.length >= maxDiffs) return;
      if (!(key in a)) {
        out.push(`${path}.${key}: missing in A, B=${formatDiffValue(b[key])}`);
        continue;
      }
      if (!(key in b)) {
        out.push(`${path}.${key}: A=${formatDiffValue(a[key])}, missing in B`);
        continue;
      }
      collectDiffs(a[key], b[key], `${path}.${key}`, out, maxDiffs);
    }

    return;
  }

  out.push(`${path}: ${formatDiffValue(a)} !== ${formatDiffValue(b)}`);
}

function describeSlotsDifference(currentSlots, existingSlots, maxDiffs = 8) {
  const currentWords = slotsToWordSignature(currentSlots);
  const existingWords = slotsToWordSignature(existingSlots);

  const diffs = [];
  collectDiffs(currentWords, existingWords, "slotsWords", diffs, maxDiffs);
  if (diffs.length === 0) {
    return "No diff details available.";
  }

  const suffix = diffs.length >= maxDiffs ? ` (showing first ${maxDiffs})` : "";
  return `${suffix}\n    - ` + diffs.join("\n    - ");
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
      args.apply ? "APPLY (updates will be written)" : "DRY-RUN (no writes)"
    }`
  );
  console.log(`Page size: ${args.pageSize}`);
  console.log(
    `Limit: ${Number.isFinite(args.limit) ? args.limit : "unlimited"}`
  );

  let processed = 0;
  let mismatched = 0;
  let updated = 0;
  let deleted = 0;
  let skipped = 0;
  let page = 0;

  while (processed < args.limit) {
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
      if (processed >= args.limit) break;
      processed += 1;

      const currentId = row?.id;
      const slotsArray = coerceSlots(row?.slots);
      const lastWord = getLastSlotWord(slotsArray);

      if (!currentId || !lastWord) {
        skipped += 1;
        continue;
      }

      const currentIdNorm = normalizeId(currentId);
      const desiredIdNorm = normalizeId(lastWord);

      if (!desiredIdNorm) {
        skipped += 1;
        continue;
      }

      if (currentIdNorm !== desiredIdNorm) {
        mismatched += 1;
        console.log(
          `Mismatch: id=${currentIdNorm} -> slots[last].word=${desiredIdNorm}`
        );

        if (args.apply) {
          const { error: updateError } = await supabase
            .from("boards")
            .update({ id: desiredIdNorm })
            .eq("id", currentId);

          if (updateError) {
            if (isDuplicateKeyError(updateError)) {
              console.warn(
                `  Update failed for id=${currentIdNorm}: duplicate key for ${desiredIdNorm}; checking slots match to dedupe...`
              );

              const { data: existingRow, error: existingError } = await supabase
                .from("boards")
                .select("id, slots")
                .eq("id", desiredIdNorm)
                .maybeSingle();

              if (existingError || !existingRow) {
                skipped += 1;
                console.warn(
                  `  Could not load existing row for id=${desiredIdNorm}: ${
                    existingError?.message || "not found"
                  }`
                );
                continue;
              }

              const existingSlotsArray = coerceSlots(existingRow.slots);

              const currentWordsJson = stableWordSignatureStringify(slotsArray);
              const existingWordsJson =
                stableWordSignatureStringify(existingSlotsArray);

              if (currentWordsJson && currentWordsJson === existingWordsJson) {
                console.log(
                  `  Slot words match for ${desiredIdNorm}; deleting old row id=${currentIdNorm}`
                );

                const { error: deleteError } = await supabase
                  .from("boards")
                  .delete()
                  .eq("id", currentId);

                if (deleteError) {
                  skipped += 1;
                  console.warn(
                    `  Delete failed for id=${currentIdNorm}: ${deleteError.message}`
                  );
                } else {
                  deleted += 1;
                }
              } else {
                skipped += 1;
                const why = describeSlotsDifference(
                  slotsArray,
                  existingSlotsArray,
                  8
                );
                console.warn(
                  `  Existing row id=${desiredIdNorm} has different slot words; leaving id=${currentIdNorm} untouched.`
                );
                console.warn(`  Why slots differ:${why}`);
              }
            } else {
              skipped += 1;
              console.warn(
                `  Update failed for id=${currentIdNorm}: ${updateError.message}`
              );
            }
          } else {
            updated += 1;
          }
        }
      }
    }

    page += 1;

    if (rows.length < args.pageSize) {
      break;
    }
  }

  console.log("---");
  console.log(`Processed:  ${processed}`);
  console.log(`Mismatched: ${mismatched}`);
  console.log(`Updated:    ${updated}`);
  console.log(`Deleted:    ${deleted}`);
  console.log(`Skipped:    ${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
