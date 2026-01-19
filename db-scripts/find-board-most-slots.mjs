import { createClient } from "@supabase/supabase-js";
import { loadDevEnv } from "./load-dev-env.mjs";

// Load .dev.vars into process.env if present (non-fatal)
await loadDevEnv();

function usage() {
  return `Find board(s) with the most filled slots (words)

Usage:
  SUPABASE_URL=... SUPABASE_KEY=... node db-scripts/find-board-most-slots.mjs [--top=N] [--page-size=N]

Options:
  --top=N         Number of top boards to show (default: 1)
  --page-size=N   How many rows to fetch per page (default: 1000)
`;
}

function parseArgs(argv) {
  const opts = { top: 1, pageSize: 1000 };
  for (const raw of argv) {
    if (raw === "--help" || raw === "-h") {
      opts.help = true;
      continue;
    }
    if (raw.startsWith("--top=")) {
      opts.top = Math.max(1, parseInt(raw.split("=")[1], 10) || 1);
      continue;
    }
    if (raw.startsWith("--page-size=")) {
      opts.pageSize = Math.max(1, parseInt(raw.split("=")[1], 10) || 1000);
      continue;
    }
    throw new Error(`Unknown argument: ${raw}`);
  }
  return opts;
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
  // Supabase sometimes returns JSON columns as objects
  return null;
}

function countFilledWords(slotsArray) {
  if (!Array.isArray(slotsArray)) return 0;
  let count = 0;
  for (const s of slotsArray) {
    if (!s) continue;
    const w = typeof s.word === "string" ? s.word : "";
    if (w && String(w).trim().length > 0) count += 1;
  }
  return count;
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

  const pageSize = args.pageSize || 1000;
  let page = 0;
  const results = [];

  while (true) {
    const from = page * pageSize;
    const to = from + pageSize - 1;

    const { data: rows, error } = await supabase
      .from("boards")
      .select("id, slots")
      .range(from, to);

    if (error) {
      console.error("Failed to fetch boards:", error.message || error);
      process.exit(1);
    }

    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      const id = row?.id ?? null;
      const slotsArray = coerceSlots(row?.slots) || [];
      const filled = countFilledWords(slotsArray);
      results.push({
        id,
        filled,
        totalSlots: Array.isArray(slotsArray) ? slotsArray.length : 0,
      });
    }

    if (rows.length < pageSize) break;
    page += 1;
  }

  if (results.length === 0) {
    console.log("No boards found.");
    return;
  }

  // Determine max filled count
  results.sort((a, b) => b.filled - a.filled || b.totalSlots - a.totalSlots);

  const topN = Math.min(args.top || 1, results.length);
  console.log(`Top ${topN} board(s) by filled slots:`);
  for (let i = 0; i < topN; i++) {
    const r = results[i];
    console.log(
      `${i + 1}. id=${r.id} filled=${r.filled} totalSlots=${r.totalSlots}`
    );
  }

  // Also print summary stats
  const totalBoards = results.length;
  const avgFilled =
    Math.round(
      (results.reduce((s, x) => s + x.filled, 0) / totalBoards) * 100
    ) / 100;
  const maxFilled = results[0].filled;
  const maxBoards = results
    .filter((r) => r.filled === maxFilled)
    .map((r) => r.id);

  console.log("---");
  console.log(`Boards scanned: ${totalBoards}`);
  console.log(`Max filled slots: ${maxFilled}`);
  console.log(`Boards with max filled slots: ${maxBoards.join(", ")}`);
  console.log(`Average filled slots: ${avgFilled}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
