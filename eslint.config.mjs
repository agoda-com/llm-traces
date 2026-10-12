import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  // Ignore generated / tool output
  {
    ignores: [
      'dist/',
      'node_modules/',
      'webpack.config.ts',
      '.config/',
      'scripts/',
      'provisioning/',
      'tests/node-loader.mjs',
    ],
  },

  // TypeScript recommended rules (no type-info required — fast)
  ...tseslint.configs.recommended,

  // Override / extend for src + tests
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.ts'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // ── React Hooks (finds missing deps, conditional hook calls) ────────
      // Using only the classic rules from v4 — the v7 "recommended" config
      // includes Meta-internal experimental rules (purity, immutability, etc.)
      // that are too strict for general React codebases.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // ── TypeScript rules ─────────────────────────────────────────────────
      // Allow `any` in catch blocks and Grafana interop (too noisy to ban)
      '@typescript-eslint/no-explicit-any': 'off',
      // Unused vars: warn, but allow _-prefixed intentional ignores
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Non-null assertions are common in Grafana interop and test files — not actionable
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Disallow `require()` in TS files
      '@typescript-eslint/no-require-imports': 'error',
      // Prevent accidental `Object` / `{}` type usage
      '@typescript-eslint/no-empty-object-type': 'warn',

      // ── Bug-finding: core JS rules ───────────────────────────────────────
      // Duplicate case in switch → always a bug
      'no-duplicate-case': 'error',
      // Code after return/throw is dead code
      'no-unreachable': 'error',
      // Comparing a value to itself (NaN checks, typos)
      'no-self-compare': 'error',
      // `if (true)` / `while (false)` — almost always wrong
      'no-constant-condition': ['warn', { checkLoops: false }],
      // Array literals like [1,,3] are confusing
      'no-sparse-arrays': 'error',
      // Always use Number.isNaN, not isNaN (isNaN coerces strings)
      'use-isnan': 'error',
      // Template literal placeholder in regular string: "${foo}" instead of `${foo}`
      'no-template-curly-in-string': 'warn',
      // Calling Object.prototype methods directly on objects (prototype pollution risk)
      'no-prototype-builtins': 'warn',
      // Fallthrough in switch without intentional comment
      'no-fallthrough': 'error',
      // Assigning to a variable you just declared (likely a typo)
      'no-ex-assign': 'error',
    },
  },
);
