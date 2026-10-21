import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const checkerPath = join(root, 'scripts/check-sdk-size.mjs');
const budgetCheckerPath = join(root, 'scripts/check-chunk-budget.mjs');

describe('build validation gates', () => {
  it('runs content validation and SDK-size validation from one build script', () => {
    const packageSource = readFileSync(join(root, 'package.json'), 'utf8');
    const packageJson = JSON.parse(packageSource) as { scripts: { build: string } };

    expect(packageSource.match(/"build"\s*:/g)).toHaveLength(1);
    expect(packageJson.scripts.build).toMatch(
      /^tsx scripts\/validate-content\.ts && node scripts\/check-sdk-size\.mjs &&/,
    );
  });

  it('includes check-chunk-budget in the build pipeline after vite build', () => {
    const packageSource = readFileSync(join(root, 'package.json'), 'utf8');
    const packageJson = JSON.parse(packageSource) as { scripts: { build: string } };

    // Budget check must come after `vite build` so the dist/assets exist.
    const buildScript = packageJson.scripts.build;
    const viteBuildIdx = buildScript.indexOf('vite build');
    const budgetIdx = buildScript.indexOf('node scripts/check-chunk-budget.mjs');

    expect(viteBuildIdx).toBeGreaterThan(-1);
    expect(budgetIdx).toBeGreaterThan(viteBuildIdx);
  });

  it('rejects a stale generated SDK size', () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), 'wraith-sdk-size-'));
    const generatedFile = join(tempDirectory, 'sdk-size.ts');

    try {
      execFileSync(process.execPath, [checkerPath, '--write', '--generated-file', generatedFile]);

      writeFileSync(generatedFile, 'export const EVM_SDK_ESM_ENTRYPOINT_GZIP_KB = 9999.9;\n');

      const result = spawnSync(process.execPath, [checkerPath, '--generated-file', generatedFile], {
        encoding: 'utf8',
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('SDK size copy is out of date');
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it('chunk budget checker passes when all chunks are within the 500 kB limit', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'wraith-chunk-budget-'));
    const assetsDir = join(tempDir, 'dist', 'assets');
    mkdirSync(assetsDir, { recursive: true });

    // Synthesise a JS chunk that is exactly 100 kB (well within budget).
    const smallChunk = Buffer.alloc(100 * 1024, 'x');
    writeFileSync(join(assetsDir, 'Stellar-abc123.js'), smallChunk);

    try {
      const result = spawnSync(process.execPath, [budgetCheckerPath], {
        encoding: 'utf8',
        cwd: tempDir,
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('ok');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('chunk budget checker fails when a route chunk exceeds 500 kB', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'wraith-chunk-budget-'));
    const assetsDir = join(tempDir, 'dist', 'assets');
    mkdirSync(assetsDir, { recursive: true });

    // Synthesise a JS chunk that is 510 kB (over the 500 kB budget).
    const oversizedChunk = Buffer.alloc(510 * 1024, 'x');
    writeFileSync(join(assetsDir, 'Stellar-abc123.js'), oversizedChunk);

    try {
      const result = spawnSync(process.execPath, [budgetCheckerPath], {
        encoding: 'utf8',
        cwd: tempDir,
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('FAIL');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('chunk budget checker skips vendor chunks regardless of size', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'wraith-chunk-budget-'));
    const assetsDir = join(tempDir, 'dist', 'assets');
    mkdirSync(assetsDir, { recursive: true });

    // Vendor chunk larger than the budget — must be skipped.
    const vendorChunk = Buffer.alloc(900 * 1024, 'x');
    writeFileSync(join(assetsDir, 'vendor-wraith-sdk-abc123.js'), vendorChunk);

    // Regular route chunk within budget.
    const routeChunk = Buffer.alloc(50 * 1024, 'x');
    writeFileSync(join(assetsDir, 'Stellar-abc123.js'), routeChunk);

    try {
      const result = spawnSync(process.execPath, [budgetCheckerPath], {
        encoding: 'utf8',
        cwd: tempDir,
      });

      // Should pass despite the oversized vendor chunk.
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('skip');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
