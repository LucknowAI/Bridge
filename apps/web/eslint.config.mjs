import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const config = [
  ...compat.extends("next/core-web-vitals"),
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      // Placeholder route/domain scaffolding carried over from the previous
      // structure. Empty by design; nothing to lint yet.
      "src/**",
    ],
  },
  {
    rules: {
      // The login and match screens use plain <img> for the logo. next/image
      // adds no value for a single small static asset served from /public.
      "@next/next/no-img-element": "off",
    },
  },
];

export default config;
