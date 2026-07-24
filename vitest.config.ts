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
    ],
  },

  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@scripts': resolve(__dirname, './src/scripts'),
      '@components': resolve(__dirname, './src/components'),
      '@layouts': resolve(__dirname, './src/layouts'),
      '@pages': resolve(__dirname, './src/pages'),
    },
  },
});
