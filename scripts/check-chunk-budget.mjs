/**
 * check-chunk-budget.mjs
 *
 * Reads the Vite build manifest (dist/.vite/manifest.json) and enforces two
 * independent size budgets:
 *
 *   CHUNK_BUDGET_KB       — maximum uncompressed size of any single JS chunk
 *                           (route chunks AND vendor chunks).  No categorical
 *                           exemption for vendor- prefixed files.
 *
 *   ROUTE_TRANSITIVE_KB   — maximum total uncompressed size of all JS chunks
 *                           transitively reachable from a route entry point.
 *                           This is the real cost a user pays when they first
 *                           land on that route.
 *
 * Why manifest-based rather than filename-based?
 *   The previous approach exempted any chunk whose filename started with
 *   "vendor-", which let vendor-stellar-sdk (908 kB) slip through unchecked.
 *   The manifest records the actual import graph Vite produced, so we can
 *   measure both individual chunk size and per-route transitive load.
 *
 * Usage (run after `vite build`):
 *   node scripts/check-chunk-budget.mjs
 *
 * Exit codes:
 *   0 — all budgets satisfied
 *   1 — one or more budgets violated
 */

import { readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const root = process.cwd();
const manifestPath = join(root, 'dist', '.vite', 'manifest.json');
const assetsDir = join(root, 'dist', 'assets');

/** Maximum uncompressed size (kB) for any single JS chunk, including vendors. */
const CHUNK_BUDGET_KB = 500;

/**
 * Maximum total uncompressed size (kB) for all JS chunks transitively
 * reachable from a route entry point (the sum a cold-cache user downloads).
 */
const ROUTE_TRANSITIVE_KB = 1_500;

// ─── Load manifest ────────────────────────────────────────────────────────────

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch {
  console.error(
    `[chunk-budget] Cannot read ${manifestPath} — run \`pnpm build\` before this check.`,
  );
  process.exit(1);
}

// ─── Build a filename → manifest entry lookup ─────────────────────────────────

/**
 * The manifest keys are source-relative paths (e.g. "src/pages/Stellar.tsx").
 * Each entry has { file, imports?, dynamicImports?, isEntry? }.
 * `file` is the output path relative to dist/ (e.g. "assets/Stellar-abc.js").
 */
const byFile = new Map(); // outputFile (relative to dist/) → entry
for (const entry of Object.values(manifest)) {
  if (entry.file) {
    byFile.set(entry.file, entry);
  }
}

// ─── Chunk size helper ────────────────────────────────────────────────────────

const sizeCache = new Map();

function chunkSizeKB(relativeFile) {
  if (sizeCache.has(relativeFile)) return sizeCache.get(relativeFile);
  const absPath = join(root, 'dist', relativeFile);
  try {
    const kb = statSync(absPath).size / 1024;
    sizeCache.set(relativeFile, kb);
    return kb;
  } catch {
    return 0;
  }
}

// ─── Transitive JS closure ────────────────────────────────────────────────────

/**
 * Collect all JS files transitively reachable from `startFile` (relative to
 * dist/) by following both static `imports` and `dynamicImports` in the
 * manifest.  Returns a Set of relative file paths.
 */
function transitiveJsFiles(startFile, visited = new Set()) {
  if (visited.has(startFile)) return visited;
  if (extname(startFile) !== '.js') return visited;
  visited.add(startFile);

  const entry = byFile.get(startFile);
  if (!entry) return visited;

  for (const dep of entry.imports ?? []) {
    const depEntry = manifest[dep] ?? byFile.get(dep);
    const depFile = depEntry?.file ?? dep;
    transitiveJsFiles(depFile, visited);
  }
  for (const dep of entry.dynamicImports ?? []) {
    const depEntry = manifest[dep] ?? byFile.get(dep);
    const depFile = depEntry?.file ?? dep;
    transitiveJsFiles(depFile, visited);
  }

  return visited;
}

// ─── Identify route entry points ─────────────────────────────────────────────

/**
 * Route entries are manifest entries that have isEntry: true and whose output
 * file is a JS asset.  In a typical Vite SPA build these correspond to the
 * HTML entry (index.html) and each lazy-loaded page chunk that Rollup promoted
 * to an entry because it is the target of a dynamic import from the router.
 */
const routeEntries = Object.values(manifest).filter(
  (e) => e.isEntry && e.file && extname(e.file) === '.js',
);

// ─── Per-chunk size check ─────────────────────────────────────────────────────

let failed = false;
let checkedChunks = 0;

console.log('\n[chunk-budget] ── Per-chunk size check ──────────────────────────────');

for (const entry of Object.values(manifest)) {
  if (!entry.file || extname(entry.file) !== '.js') continue;
  const kb = chunkSizeKB(entry.file);
  if (kb === 0) continue; // file not present (e.g. SSR-only)
  checkedChunks++;

  const label = entry.file.replace('assets/', '');
  if (kb > CHUNK_BUDGET_KB) {
    console.error(
      `[chunk-budget] FAIL  ${label}  ${kb.toFixed(1)} kB  (budget: ${CHUNK_BUDGET_KB} kB)`,
    );
    failed = true;
  } else {
    console.log(`[chunk-budget] ok    ${label}  ${kb.toFixed(1)} kB`);
  }
}

if (checkedChunks === 0) {
  console.error('[chunk-budget] No JS chunks found in manifest — did the build succeed?');
  process.exit(1);
}

// ─── Per-route transitive check ───────────────────────────────────────────────

console.log('\n[chunk-budget] ── Per-route transitive check ────────────────────────');

for (const routeEntry of routeEntries) {
  const allFiles = transitiveJsFiles(routeEntry.file);
  const totalKB = [...allFiles].reduce((sum, f) => sum + chunkSizeKB(f), 0);
  const label = routeEntry.file.replace('assets/', '');

  if (totalKB > ROUTE_TRANSITIVE_KB) {
    console.error(
      `[chunk-budget] FAIL  ${label}  transitive: ${totalKB.toFixed(1)} kB  (budget: ${ROUTE_TRANSITIVE_KB} kB)`,
    );
    console.error(
      `[chunk-budget]       chunks: ${[...allFiles].map((f) => f.replace('assets/', '')).join(', ')}`,
    );
    failed = true;
  } else {
    console.log(
      `[chunk-budget] ok    ${label}  transitive: ${totalKB.toFixed(1)} kB  (${[...allFiles].length} chunks)`,
    );
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────

if (failed) {
  console.error(
    `\n[chunk-budget] Budget violated. Lazy-load heavy dependencies or split vendor chunks.`,
  );
  console.error(
    `[chunk-budget] Run \`pnpm build\` then inspect dist/.vite/manifest.json for the import graph.`,
  );
  process.exit(1);
}

console.log(
  `\n[chunk-budget] All ${checkedChunks} chunks and ${routeEntries.length} route transitive closures are within budget.`,
);
