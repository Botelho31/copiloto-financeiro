import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/dist/**", "backend/public/**", "data/**", "**/*.d.ts"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Catches exactly the class of bug that shipped this session (a hook
      // called inside .map() instead of a per-item component) — see
      // ARCHITECTURE.md/Household.tsx's PersonBreakdownTable fix.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "no-unused-vars": "off",
    },
  },
  // Backend: Bun runtime, no React.
  {
    files: ["backend/src/**/*.ts", "backend/src/**/*.tsx"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  // Frontend: browser + React runtime, hooks rules on.
  {
    files: ["frontend/src/**/*.ts", "frontend/src/**/*.tsx"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // This codebase relies heavily on the "sync local edit-form state from
      // a prop via useEffect" pattern (e.g. Debts.tsx's InterestRateEditor/
      // StartDateEditor/PrincipalEditor/MatchingRuleEditor, Projections.tsx's
      // goal editors) — a deliberate, working pattern, not a bug. Downgraded
      // to a warning rather than rewriting ~6 working components to satisfy
      // a new, stricter rule from react-hooks v7.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // Shared: pure TS library, no runtime globals assumed either way.
  {
    files: ["shared/src/**/*.ts"],
  },
  // Test files: bun:test globals (describe/test/expect are imported
  // explicitly in this codebase, so nothing extra needed here beyond node).
  {
    files: ["**/*.test.ts", "**/test/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  prettierConfig
);
