// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintPluginAstro from 'eslint-plugin-astro';

/**
 * WoS+ ESLint flat config.
 *
 * See CLAUDE.md §2.5: rules that can be enforced mechanically live here rather
 * than in prose. `pnpm run lint` runs at `--max-warnings 0`, so anything below
 * is a hard gate — there is no "warning" tier that quietly accumulates.
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      '.astro/**',
      '.wrangler/**',
      'coverage/**',
      'node_modules/**',
      'public/**',
    ],
  },

  // ---------------------------------------------------------------------
  // Plain JS (config files, db scripts, Sentry init). No type information.
  // ---------------------------------------------------------------------
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
  },

  // ---------------------------------------------------------------------
  // TypeScript, type-aware.
  // ---------------------------------------------------------------------
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        // Type-aware linting. `projectService` picks up tsconfig.json per file
        // and is what makes rules like no-floating-promises possible.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // ---------------------------------------------------------------------
  // Astro components (frontmatter + <script> blocks).
  // ---------------------------------------------------------------------
  ...eslintPluginAstro.configs['flat/recommended'],
);
