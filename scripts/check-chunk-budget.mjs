/**
 * check-chunk-budget.mjs
 *
 * Walks the Vite build output in `dist/assets/` and fails if any single JS
 * chunk (excluding vendor chunks) exceeds ROUTE_CHUNK_BUDGET_KB kilobytes
 * (uncompressed). Vendor chunks are allowed to be larger — they are shared
 * across routes and cached independently by the browser.
 *
 * Usage (run after `vite build`):
 *   node scripts/check-chunk-budget.mjs
 *
 * Exit codes:
 *   0 — all route chunks are within budget
 *   1 — one or more chunks exceed the budget
 */

import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const assetsDir = join(process.cwd(), 'dist', 'assets');

/** Maximum uncompressed size (kB) for any single non-vendor JS chunk. */
const ROUTE_CHUNK_BUDGET_KB = 500;

/** Vendor chunk names produced by the manualChunks config in vite.config.ts. */
const VENDOR_PREFIXES = ['vendor-'];

function isVendorChunk(filename) {
  return VENDOR_PREFIXES.some((prefix) => filename.startsWith(prefix));
}

let failed = false;
let checked = 0;

let entries;
try {
  entries = readdirSync(assetsDir);
} catch {
  console.error(`[chunk-budget] Cannot read ${assetsDir} — run \`pnpm build\` before this check.`);
  process.exit(1);
}

for (const entry of entries) {
  if (extname(entry) !== '.js') continue;
  if (isVendorChunk(entry)) {
    console.log(`[chunk-budget] skip  ${entry} (vendor)`);
    continue;
  }

  const filePath = join(assetsDir, entry);
  const sizeBytes = statSync(filePath).size;
  const sizeKB = sizeBytes / 1024;
  checked++;

  if (sizeKB > ROUTE_CHUNK_BUDGET_KB) {
    console.error(
      `[chunk-budget] FAIL  ${entry}  ${sizeKB.toFixed(1)} kB  (budget: ${ROUTE_CHUNK_BUDGET_KB} kB)`,
    );
    failed = true;
  } else {
    console.log(`[chunk-budget] ok    ${entry}  ${sizeKB.toFixed(1)} kB`);
  }
}

if (checked === 0) {
  console.error('[chunk-budget] No JS chunks found — did the build succeed?');
  process.exit(1);
}

if (failed) {
  console.error(
    `\n[chunk-budget] One or more route chunks exceed the ${ROUTE_CHUNK_BUDGET_KB} kB budget.`,
  );
  console.error(
    '[chunk-budget] Lazy-load heavy dependencies or move them into a manualChunks vendor group.',
  );
  process.exit(1);
}

console.log(
  `\n[chunk-budget] All ${checked} route chunks are within the ${ROUTE_CHUNK_BUDGET_KB} kB budget.`,
);
