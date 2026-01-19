import { createClient } from "@supabase/supabase-js";
import { loadDevEnv } from "./load-dev-env.mjs";

// Load .dev.vars into process.env if present (non-fatal)
await loadDevEnv();

function usage() {
  return `Find board(s) with the largest total letters across all slot words

Usage:
  SUPABASE_URL=... SUPABASE_KEY=... node db-scripts/find-board-most-letters.mjs [--top=N] [--page-size=N]

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
  return null;
}

function lettersCountOfWord(raw) {
  if (!raw || typeof raw !== "string") return 0;
  // Count only alphabetic characters as letters
  const cleaned = raw.replace(/[^A-Za-z]/g, "");
  return cleaned.length;
}

function analyzeSlots(slotsArray) {
  if (!Array.isArray(slotsArray) || slotsArray.length === 0)
    return {
      totalLetters: 0,
      totalSlots: 0,
      avgLetters: 0,
      longestWord: null,
      longestLen: 0,
    };
  let total = 0;
  let longestLen = 0;
  let longestWord = null;
  for (const s of slotsArray) {
    if (!s) continue;
    const w = typeof s.word === "string" ? s.word : "";
    const len = lettersCountOfWord(w);
    total += len;
    if (len > longestLen) {
      longestLen = len;
      longestWord = w;
    }
  }
  const avg =
    slotsArray.length > 0
      ? Math.round((total / slotsArray.length) * 100) / 100
      : 0;
  return {
    totalLetters: total,
    totalSlots: slotsArray.length,
    avgLetters: avg,
    longestWord,
    longestLen,
  };
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
  const stats = [];

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
      const analysis = analyzeSlots(slotsArray);
      stats.push({ id, ...analysis });
    }

    if (rows.length < pageSize) break;
    page += 1;
  }

  if (stats.length === 0) {
    console.log("No boards found.");
    return;
  }

  stats.sort(
    (a, b) => b.totalLetters - a.totalLetters || b.totalSlots - a.totalSlots
  );
  const topN = Math.min(args.top || 1, stats.length);
  console.log(`Top ${topN} board(s) by total letters across slot words:`);
  for (let i = 0; i < topN; i++) {
    const r = stats[i];
    console.log(
      `${i + 1}. id=${r.id} totalLetters=${r.totalLetters} totalSlots=${
        r.totalSlots
      } avgLetters=${r.avgLetters} longestWord="${r.longestWord}"(${
        r.longestLen
      })`
    );
  }

  const totalBoards = stats.length;
  const sumLetters = stats.reduce((s, x) => s + x.totalLetters, 0);
  const avgLettersPerBoard = Math.round((sumLetters / totalBoards) * 100) / 100;
  const maxLetters = stats[0].totalLetters;
  const maxBoards = stats
    .filter((s) => s.totalLetters === maxLetters)
    .map((s) => s.id);

  console.log("---");
  console.log(`Boards scanned: ${totalBoards}`);
  console.log(`Max total letters: ${maxLetters}`);
  console.log(`Boards with max total letters: ${maxBoards.join(", ")}`);
  console.log(`Average total letters per board: ${avgLettersPerBoard}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
