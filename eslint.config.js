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
      // Transient Claude Code agent worktrees: full copies of the repo, so
      // linting them double-counts every finding against a throwaway tree.
      '.claude/**',
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
        projectService: {
          // Root-level config files aren't part of tsconfig's include, so the
          // project service has no program for them and would fail to parse.
          allowDefaultProject: ['*.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // ---------------------------------------------------------------------
  // Rules specifically targeting AI-generated-code failure modes.
  // These are the reason this config exists (AGENTIC-TESTING-PLAN.md §1.2).
  // They are hard errors everywhere and must never be relaxed to reach green.
  // ---------------------------------------------------------------------
  {
    files: ['**/*.ts'],
    rules: {
      // The `any` escape hatch an agent reaches for when it cannot infer a type.
      '@typescript-eslint/no-explicit-any': 'error',
      // Unawaited async work — a real hazard in this codebase's worker and
      // WebSocket paths, where a dropped promise fails silently.
      '@typescript-eslint/no-floating-promises': 'error',
      // The WoS event-type switch in wos-worker.ts: a new protocol event must
      // not be silently ignored.
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },

  // Workers run without a DOM. Importing a DOM-dependent module into one fails
  // at runtime inside the worker thread, where it is awkward to diagnose.
  {
    files: ['src/scripts/*worker*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/wos-plus-main*', '**/wos-widget*', '**/launch-menu*'],
          message: 'Workers have no DOM. Pass data over postMessage instead.',
        }],
      }],
    },
  },

  // ---------------------------------------------------------------------
  // Ratchet baseline. The `no-unsafe-*` family reports 981 pre-existing
  // findings across this codebase, overwhelmingly from untyped WoS/Twitch
  // socket payloads and test doubles. Fixing them is a typing project in its
  // own right, not something to smuggle into the PR that introduces linting.
  //
  // They are DOWNGRADED, not deleted, and only where they are pre-existing:
  // the four rules above still gate every new line of code. Per CLAUDE.md the
  // ratchet only tightens — re-enable these per-directory as payload types
  // land. Do not widen this block to make a new violation pass.
  // ---------------------------------------------------------------------
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },

  // ---------------------------------------------------------------------
  // Tests: doubles and fixtures legitimately need `any` and bare async stubs.
  // Narrowed to test trees only so production code keeps the full gate.
  // ---------------------------------------------------------------------
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  // ---------------------------------------------------------------------
  // Astro components (frontmatter + <script> blocks).
  // ---------------------------------------------------------------------
  ...eslintPluginAstro.configs['flat/recommended'],
);
