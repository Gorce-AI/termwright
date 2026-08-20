import tseslint from 'typescript-eslint';

/**
 * ESLint 9 no longer discovers legacy `.eslintrc` files. Keep this deliberately
 * syntax-oriented: package typechecks own the type-aware rules, while this gate
 * catches unsafe JavaScript/TypeScript patterns and unused code across every
 * public package source tree.
 */
export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['packages/*/src/**/*.{ts,tsx}'],
    rules: {
      // Public wire boundaries intentionally accept `unknown`, but several
      // framework shims must model opaque upstream internals as `any`.
      '@typescript-eslint/no-explicit-any': 'off',
      // `session` aliases make getters in frozen API objects readable and do
      // not escape the method that creates them.
      '@typescript-eslint/no-this-alias': 'off',
      // Empty extensions are used for public declaration merging and branded
      // recursive collection types; replacing them changes emitted `.d.ts`.
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-sparse-arrays': 'error',
    },
  },
);
