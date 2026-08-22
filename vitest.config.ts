import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Standalone test config — deliberately does NOT reuse vite.config.ts
// (which wires TanStack Start + Nitro). These unit tests exercise pure
// business logic only, so a plain node environment + the "@" path alias
// is all we need.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: true,
  },
});
