import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const checkerPath = join(root, 'scripts/check-sdk-size.mjs');
const budgetCheckerPath = join(root, 'scripts/check-chunk-budget.mjs');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Create a minimal Vite manifest + asset files in a temp directory so the
 * budget checker can be exercised without a real build.
 *
 * @param entries  Array of { key, file, sizeKB, isEntry, imports?, dynamicImports? }
 * @returns        { tempDir, assetsDir }
 */
function createFakeManifest(
  entries: Array<{
    key: string;
    file: string;
    sizeKB: number;
    isEntry?: boolean;
    imports?: string[];
    dynamicImports?: string[];
  }>,
): { tempDir: string; assetsDir: string } {
  const tempDir = mkdtempSync(join(tmpdir(), 'wraith-chunk-budget-'));
  const assetsDir = join(tempDir, 'dist', 'assets');
  const viteDir = join(tempDir, 'dist', '.vite');
  mkdirSync(assetsDir, { recursive: true });
  mkdirSync(viteDir, { recursive: true });

  const manifest: Record<string, unknown> = {};
  for (const e of entries) {
    const absFile = join(tempDir, 'dist', e.file);
    mkdirSync(absFile.replace(/\/[^/]+$/, ''), { recursive: true });
    writeFileSync(absFile, Buffer.alloc(Math.round(e.sizeKB * 1024), 'x'));
    manifest[e.key] = {
      file: e.file,
      ...(e.isEntry !== undefined && { isEntry: e.isEntry }),
      ...(e.imports && { imports: e.imports }),
      ...(e.dynamicImports && { dynamicImports: e.dynamicImports }),
    };
  }

  writeFileSync(join(viteDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { tempDir, assetsDir };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

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

    // Budget check must come after `vite build` so dist/.vite/manifest.json exists.
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

  // ── Chunk budget checker: per-chunk gate ─────────────────────────────────

  it('chunk budget checker passes when all chunks are within the 500 kB limit', () => {
    const { tempDir } = createFakeManifest([
      { key: 'src/pages/Stellar.tsx', file: 'assets/Stellar-abc123.js', sizeKB: 100, isEntry: true },
    ]);

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
    const { tempDir } = createFakeManifest([
      {
        key: 'src/pages/Stellar.tsx',
        file: 'assets/Stellar-abc123.js',
        sizeKB: 510,
        isEntry: true,
      },
    ]);

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

  it('chunk budget checker enforces the 500 kB limit on vendor chunks — no categorical exemption', () => {
    // An oversized vendor-stellar-sdk chunk must trigger FAIL, not be skipped.
    const { tempDir } = createFakeManifest([
      {
        key: 'vendor-stellar-sdk',
        file: 'assets/vendor-stellar-sdk-abc123.js',
        sizeKB: 910, // 908 kB real-world size
        isEntry: false,
      },
      {
        key: 'src/pages/Stellar.tsx',
        file: 'assets/Stellar-def456.js',
        sizeKB: 50,
        isEntry: true,
        imports: ['vendor-stellar-sdk'],
      },
    ]);

    try {
      const result = spawnSync(process.execPath, [budgetCheckerPath], {
        encoding: 'utf8',
        cwd: tempDir,
      });

      // Must fail because vendor-stellar-sdk exceeds CHUNK_BUDGET_KB.
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('FAIL');
      expect(result.stderr).toContain('vendor-stellar-sdk');
      // Must NOT say 'skip' for the vendor chunk.
      expect(result.stdout).not.toContain('skip');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // ── Chunk budget checker: per-route transitive gate ──────────────────────

  it('chunk budget checker fails when a route transitive closure exceeds the budget', () => {
    // Stellar route chunk is small, but it imports a fat vendor chunk that
    // takes the transitive total over ROUTE_TRANSITIVE_KB (1 500 kB).
    const { tempDir } = createFakeManifest([
      {
        key: 'vendor-stellar-sdk',
        file: 'assets/vendor-stellar-sdk-abc.js',
        sizeKB: 910,
        isEntry: false,
      },
      {
        key: 'vendor-wraith-sdk',
        file: 'assets/vendor-wraith-sdk-abc.js',
        sizeKB: 650,
        isEntry: false,
      },
      {
        key: 'src/pages/Stellar.tsx',
        file: 'assets/Stellar-def.js',
        sizeKB: 50,
        isEntry: true,
        imports: ['vendor-stellar-sdk', 'vendor-wraith-sdk'],
      },
    ]);

    try {
      const result = spawnSync(process.execPath, [budgetCheckerPath], {
        encoding: 'utf8',
        cwd: tempDir,
      });

      // Total: 910 + 650 + 50 = 1 610 kB > 1 500 kB → must fail.
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('FAIL');
      expect(result.stderr).toMatch(/transitive/i);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('chunk budget checker passes when the Stellar route does NOT preload vendor-stellar-sdk', () => {
    // After the import-boundary fix, StellarDeploymentTable no longer drags
    // vendor-stellar-sdk into the /stellar route's preload graph.
    // vendor-stellar-sdk is only reachable via a dynamic import from
    // StellarMetrics (home page), so the /stellar route's transitive total is
    // within budget.
    const { tempDir } = createFakeManifest([
      // vendor-stellar-sdk exists in the build but is NOT reachable from
      // the Stellar route entry (no static or dynamic import path to it).
      {
        key: 'vendor-stellar-sdk',
        file: 'assets/vendor-stellar-sdk-abc.js',
        sizeKB: 910,
        isEntry: false,
      },
      // Shared utilities reachable from the Stellar route.
      {
        key: 'vendor-wraith-sdk',
        file: 'assets/vendor-wraith-sdk-abc.js',
        sizeKB: 300,
        isEntry: false,
      },
      {
        key: 'src/pages/Stellar.tsx',
        file: 'assets/Stellar-def.js',
        sizeKB: 80,
        isEntry: true,
        // imports vendor-wraith-sdk but NOT vendor-stellar-sdk
        imports: ['vendor-wraith-sdk'],
      },
    ]);

    try {
      const result = spawnSync(process.execPath, [budgetCheckerPath], {
        encoding: 'utf8',
        cwd: tempDir,
      });

      // vendor-stellar-sdk alone would fail the per-chunk gate in this fixture
      // because it's 910 kB; mark it as small to test only the transitive path.
      // Re-create fixture with a small vendor-stellar-sdk to isolate this case.
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }

    // Re-run with a realistic fixture where all individual chunks are small
    // but the Stellar route doesn't import vendor-stellar-sdk.
    const { tempDir: tempDir2 } = createFakeManifest([
      {
        key: 'vendor-stellar-sdk',
        file: 'assets/vendor-stellar-sdk-abc.js',
        sizeKB: 200, // small enough to pass per-chunk gate
        isEntry: false,
      },
      {
        key: 'vendor-wraith-sdk',
        file: 'assets/vendor-wraith-sdk-abc.js',
        sizeKB: 200,
        isEntry: false,
      },
      {
        key: 'src/pages/Stellar.tsx',
        file: 'assets/Stellar-def.js',
        sizeKB: 80,
        isEntry: true,
        imports: ['vendor-wraith-sdk'], // no vendor-stellar-sdk in import chain
      },
    ]);

    try {
      const result = spawnSync(process.execPath, [budgetCheckerPath], {
        encoding: 'utf8',
        cwd: tempDir2,
      });

      // Stellar transitive: 80 + 200 = 280 kB — well within 1 500 kB.
      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain('FAIL');
    } finally {
      rmSync(tempDir2, { recursive: true, force: true });
    }
  });

  it('StellarDeploymentTable does not import from @wraith-protocol/sdk or @stellar/stellar-sdk', () => {
    // Regression assertion: the component must only reference static data from
    // src/data/stellarDeployment.ts, not the SDK directly.
    const source = readFileSync(
      join(root, 'src/components/StellarDeploymentTable.tsx'),
      'utf8',
    );

    // Match `from '...'` clauses (handles multi-line imports); ignore comment prose.
    const fromClauses = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);

    expect(fromClauses.some((m) => m.includes('@wraith-protocol/sdk'))).toBe(false);
    expect(fromClauses.some((m) => m.includes('@stellar/stellar-sdk'))).toBe(false);
    expect(fromClauses.some((m) => m.includes('stellarDeployment'))).toBe(true);
  });

  it('stellarDeployment data file has no import statements at all', () => {
    // The static data file must be entirely import-free so it carries zero
    // transitive bundle weight from the Stellar or Wraith SDKs.
    const source = readFileSync(
      join(root, 'src/data/stellarDeployment.ts'),
      'utf8',
    );

    const importLines = source
      .split('\n')
      .filter((l) => /^\s*import\s/.test(l));

    expect(importLines).toHaveLength(0);
  });
});
