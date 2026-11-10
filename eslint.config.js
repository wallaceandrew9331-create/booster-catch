import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Transcendental Math functions are "implementation-approximated" in the
// ECMAScript spec and can differ in the last bit between JS engines, which
// would break replay determinism. The sim uses dmath.ts instead.
const nondeterministic = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'exp', 'expm1', 'log', 'log2', 'log10', 'log1p', 'pow', 'hypot', 'cbrt', 'sinh', 'cosh', 'tanh', 'random'].map((property) => ({
  object: 'Math',
  property,
  message: 'Not bit-reproducible across JS engines; use dmath.ts (or seeded rng.ts) in the sim.',
}));

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/web/src/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // The deterministic core: no clock, no ambient randomness, no
    // engine-dependent float functions.
    files: ['packages/sim/src/**/*.ts'],
    rules: {
      'no-restricted-properties': ['error', ...nondeterministic],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'The sim must not read the clock; pass dates in.' },
        { name: 'performance', message: 'The sim must not read the clock.' },
        { name: 'setTimeout', message: 'The sim is stepped, never scheduled.' },
      ],
    },
  },
  {
    // dateKey formats a Date the caller provides; it doesn't read the clock.
    files: ['packages/sim/src/levels.ts'],
    rules: { 'no-restricted-globals': 'off' },
  },
);
