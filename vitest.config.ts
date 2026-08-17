import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    // Test environment
    environment: 'happy-dom',

    // Global test setup
    globals: true,

    // Setup file
    setupFiles: ['./tests/setup.ts'],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],

      // Report on every source file, not just the ones a test happens to
      // import. Without `all`, untested modules are silently absent from the
      // report and the headline number flatters us.
      all: true,

      // NOTE: this `include` is the *coverage* file set (which source files to
      // instrument and report). It is distinct from `test.include` below,
      // which is the *test* file pattern.
      include: ['src/**/*.ts'],

      exclude: [
        'node_modules/',
        'dist/',
        '.astro/',
        '**/*.config.*',
        '**/types.d.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
        'tests/',
      ],

      // Ratchet-only floor (CLAUDE.md §4 / AGENTIC-TESTING-PLAN.md #155):
      // set just below the measured baseline so ordinary churn doesn't trip
      // it, but a real regression fails the build. Raising a threshold is
      // fine any time; lowering one is a deliberate, reviewed act — never
      // do it just to get CI green.
      thresholds: {
        statements: 91,
        branches: 86,
        functions: 88,
        lines: 91,

        // Per-file floors for the crown jewels, measured at PR #155
        // (statements/branches/functions/lines: 96.77/91.67/95.24/98.78).
        'src/scripts/wos-words.ts': {
          statements: 96,
          branches: 90,
          functions: 94,
          lines: 98,
        },
        // Applies per-file, not aggregated: the floor here is set by
        // launch-menu.ts (86.84/63.64/100/91.67), the weakest file in
        // src/lib — board-utils.ts and cors.ts are both at 100%.
        'src/lib/**': {
          statements: 86,
          branches: 63,
          functions: 100,
          lines: 91,
        },
      },
    },

    // Test file patterns
    include: [
      'src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      'tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
    ],

    // Exclude patterns
    exclude: [
      'node_modules',
      'dist',
      '.astro',
      '.idea',
      '.git',
      '.cache',
      // Playwright specs (tests/e2e/**), run via `pnpm run test:e2e`, not
      // Vitest — they use @playwright/test's own `test`/`expect`, which
      // collides with Vitest's globals if picked up here.
      'tests/e2e',
    ],
  },

  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@scripts': resolve(__dirname, './src/scripts'),
      '@components': resolve(__dirname, './src/components'),
      '@layouts': resolve(__dirname, './src/layouts'),
      '@pages': resolve(__dirname, './src/pages'),
      // Workers-runtime virtual module; unresolvable under Vitest, which
      // dropped every route importing it from the coverage report.
      'cloudflare:workers': resolve(__dirname, './tests/stubs/cloudflare-workers.ts'),
    },
  },
});
