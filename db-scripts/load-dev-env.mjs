import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function parseEnvContents(contents) {
  const out = {};
  const lines = String(contents).split(/\r?\n/);
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    let key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // Remove surrounding quotes
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export async function loadDevEnv(options = {}) {
  const { path = "../.dev.vars", overwrite = false } = options;
  try {
    // Resolve relative to this script so callers can import with ./load-dev-env.mjs
    const base = dirname(
      new URL(import.meta.url).pathname.replace(/^\/[A-Za-z]:/, "")
    );
    const resolved = resolve(base, path);
    const contents = await readFile(resolved, { encoding: "utf8" });
    const parsed = parseEnvContents(contents);
    for (const [k, v] of Object.entries(parsed)) {
      if (
        overwrite ||
        typeof process.env[k] === "undefined" ||
        process.env[k] === ""
      ) {
        process.env[k] = v;
      }
    }
    return parsed;
  } catch (err) {
    // Fail silently — caller will still check required env vars and report errors
    return {};
  }
}

export function loadDevEnvSync(options = {}) {
  // Convenience sync loader using require('fs').readFileSync when needed
  const { readFileSync } = require("fs");
  const { path = "../.dev.vars", overwrite = false } = options;
  try {
    const base = dirname(
      new URL(import.meta.url).pathname.replace(/^\/[A-Za-z]:/, "")
    );
    const resolved = resolve(base, path);
    const contents = readFileSync(resolved, { encoding: "utf8" });
    const parsed = parseEnvContents(contents);
    for (const [k, v] of Object.entries(parsed)) {
      if (
        overwrite ||
        typeof process.env[k] === "undefined" ||
        process.env[k] === ""
      ) {
        process.env[k] = v;
      }
    }
    return parsed;
  } catch (err) {
    return {};
  }
}
