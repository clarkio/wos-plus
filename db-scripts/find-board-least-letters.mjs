import { createClient } from "@supabase/supabase-js";
import { loadDevEnv } from "./load-dev-env.mjs";

// Load .dev.vars into process.env if present (non-fatal)
await loadDevEnv();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_KEY in environment.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

const { data, error } = await supabase.from("boards").select("id, slots");
if (error) {
  console.error(error);
  process.exit(1);
}

const results = data
  .map((row) => {
    const slots = Array.isArray(row.slots) ? row.slots : [];
    const filledSlots = slots.filter((s) => s && s.word && s.word.length > 0);
    const totalLetters = filledSlots.reduce((sum, s) => sum + s.word.length, 0);
    return { id: row.id, filled: filledSlots.length, totalLetters };
  })
  .filter((r) => r.filled > 0);

results.sort((a, b) => a.totalLetters - b.totalLetters);
console.log("Smallest boards by total letters:");
results
  .slice(0, 5)
  .forEach((r, i) =>
    console.log(
      i +
        1 +
        ". id=" +
        r.id +
        " filled=" +
        r.filled +
        " totalLetters=" +
        r.totalLetters,
    ),
  );
