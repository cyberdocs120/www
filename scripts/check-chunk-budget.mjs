/**
 * check-chunk-budget.mjs
 *
 * Reads the Vite build manifest (dist/.vite/manifest.json) and enforces two
 * independent size budgets:
 *
 *   CHUNK_BUDGET_KB       — maximum uncompressed size of any single JS chunk.
 *                           Named exceptions for known-large third-party
 *                           bundles are declared in CHUNK_ALLOWLIST below.
 *
 *   ROUTE_TRANSITIVE_KB   — maximum total uncompressed size of all JS chunks
 *                           statically reachable from a route entry point
 *                           (following `imports` in the manifest, NOT
 *                           `dynamicImports`).  Dynamic imports are the split
 *                           boundary — they are intentionally excluded so that
 *                           the SPA entry point is not charged for every lazy
 *                           page it can eventually load.
 *
 * Why manifest-based rather than filename-based?
 *   The previous approach exempted any chunk whose filename started with
 *   "vendor-", which let vendor-stellar-sdk (908 kB) slip through unchecked.
 *   The manifest records the actual import graph Vite produced, so we can
 *   measure both individual chunk size and per-route static load.
 *
 * Usage (run after `vite build`):
 *   node scripts/check-chunk-budget.mjs
 *
 * Exit codes:
 *   0 — all budgets satisfied
 *   1 — one or more budgets violated
 */

import { readFileSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const root = process.cwd();
const manifestPath = join(root, 'dist', '.vite', 'manifest.json');

/** Maximum uncompressed size (kB) for any single JS chunk. */
const CHUNK_BUDGET_KB = 500;

/**
 * Maximum total uncompressed size (kB) for all JS chunks statically reachable
 * from a route entry point (static imports only, not dynamic imports).
 */
const ROUTE_TRANSITIVE_KB = 1_500;

/**
 * Named allowlist for chunks that are known to exceed CHUNK_BUDGET_KB due to
 * third-party bundle size outside our control.  Each entry requires a reason
 * and an explicit size ceiling so regressions (e.g. a major version bump that
 * doubles the size) still fail the gate.
 *
 * Key: chunk filename prefix (before the content-hash separator `-`).
 * Value: { maxKB, reason }
 */
const CHUNK_ALLOWLIST = {
  'vendor-stellar-sdk': {
    maxKB: 950,
    reason:
      '@stellar/stellar-sdk ships a large pre-built bundle. It is isolated ' +
      'in its own chunk and only loaded by StellarMetrics (home page, lazy). ' +
      'The /stellar route no longer preloads it.',
  },
};

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

/** Return the allowlist entry for a chunk file, or null if not allowlisted. */
function getAllowlistEntry(relativeFile) {
  const name = basename(relativeFile, '.js');
  // Strip the content-hash suffix: Vite hashes are purely alphanumeric, 8+
  // chars, appended with a hyphen separator (e.g. "vendor-stellar-sdk-Bene0NPw").
  const prefix = name.replace(/-[A-Za-z0-9]{8,}$/, '');
  return CHUNK_ALLOWLIST[prefix] ?? null;
}

// ─── Transitive JS closure (static imports only) ──────────────────────────────

/**
 * Collect all JS files statically reachable from `startFile` (relative to
 * dist/) by following only `imports` (static) in the manifest.
 * `dynamicImports` are intentionally excluded — they are the code-split
 * boundary and should not inflate a route's measured load cost.
 */
function staticJsFiles(startFile, visited = new Set()) {
  if (visited.has(startFile)) return visited;
  if (extname(startFile) !== '.js') return visited;
  visited.add(startFile);

  const entry = byFile.get(startFile);
  if (!entry) return visited;

  for (const dep of entry.imports ?? []) {
    const depEntry = manifest[dep] ?? byFile.get(dep);
    const depFile = depEntry?.file ?? dep;
    staticJsFiles(depFile, visited);
  }

  return visited;
}

// ─── Identify route entry points ─────────────────────────────────────────────

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
  if (kb === 0) continue;
  checkedChunks++;

  const label = entry.file.replace('assets/', '');
  const allowed = getAllowlistEntry(entry.file);

  if (allowed) {
    if (kb > allowed.maxKB) {
      console.error(
        `[chunk-budget] FAIL  ${label}  ${kb.toFixed(1)} kB  ` +
          `(allowlist ceiling: ${allowed.maxKB} kB — ${allowed.reason})`,
      );
      failed = true;
    } else {
      console.log(
        `[chunk-budget] allow ${label}  ${kb.toFixed(1)} kB  (allowlisted: ${allowed.reason.slice(0, 60)}…)`,
      );
    }
  } else if (kb > CHUNK_BUDGET_KB) {
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

// ─── Per-route transitive check (static imports only) ────────────────────────

console.log('\n[chunk-budget] ── Per-route transitive check (static imports) ───────');

for (const routeEntry of routeEntries) {
  const allFiles = staticJsFiles(routeEntry.file);
  const totalKB = [...allFiles].reduce((sum, f) => sum + chunkSizeKB(f), 0);
  const label = routeEntry.file.replace('assets/', '');

  if (totalKB > ROUTE_TRANSITIVE_KB) {
    console.error(
      `[chunk-budget] FAIL  ${label}  static transitive: ${totalKB.toFixed(1)} kB  (budget: ${ROUTE_TRANSITIVE_KB} kB)`,
    );
    console.error(
      `[chunk-budget]       chunks: ${[...allFiles].map((f) => f.replace('assets/', '')).join(', ')}`,
    );
    failed = true;
  } else {
    console.log(
      `[chunk-budget] ok    ${label}  static transitive: ${totalKB.toFixed(1)} kB  (${[...allFiles].length} chunks)`,
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
  `\n[chunk-budget] All ${checkedChunks} chunks and ${routeEntries.length} route static closures are within budget.`,
);
