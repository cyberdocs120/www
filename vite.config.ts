/// <reference types="vitest/config" />

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import mdx from '@mdx-js/rollup';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMdxFrontmatter from 'remark-mdx-frontmatter';
import rehypeSlug from 'rehype-slug';

export default defineConfig({
  plugins: [
    {
      enforce: 'pre',
      ...mdx({
        remarkPlugins: [remarkFrontmatter, remarkMdxFrontmatter],
        rehypePlugins: [rehypeSlug],
      }),
    },
    react(),
    tailwindcss(),
  ],
  build: {
    // Raise the warning threshold to 600 kB so only genuinely over-budget
    // chunks (above the limit set in scripts/check-chunk-budget.mjs) surface
    // as warnings during the build. The CI budget check enforces the real
    // limit independently.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Group the Stellar SDK into its own vendor chunk so it is shared
          // between StellarDeploymentTable, StellarMetrics (home page), and
          // any other future consumers without being duplicated.
          if (id.includes('@wraith-protocol/sdk')) {
            return 'vendor-wraith-sdk';
          }
          // Group the Stellar network SDK (stellar-sdk) separately; it is
          // only pulled in by the stellarMetrics utility.
          if (id.includes('@stellar/stellar-sdk')) {
            return 'vendor-stellar-sdk';
          }
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    exclude: ['**/node_modules/**', '**/e2e/**', '**/tests/a11y/**'],
  },
});
