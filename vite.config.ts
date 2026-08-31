// Standalone Vite config for Prokon ERP (replaces the former
// @lovable.dev/vite-tanstack-config wrapper, which was removed as part of
// de-Lovabling the project).
//
// Plugin order matters — it mirrors what the Lovable wrapper used to inject:
//   tailwindcss -> tsConfigPaths -> tanstackStart -> nitro (build-only) -> react
import { defineConfig, loadEnv, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig(async ({ command, mode }): Promise<UserConfig> => {
  // Expose VITE_* env vars to the client bundle (import.meta.env.VITE_*)
  const loadedEnv = loadEnv(mode, process.cwd(), "VITE_");
  const envDefine = Object.fromEntries(
    Object.entries(loadedEnv).map(([key, value]) => [
      `import.meta.env.${key}`,
      JSON.stringify(value),
    ]),
  );

  const plugins = [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      // Redirect TanStack Start's bundled server entry to src/server.ts (our
      // SSR error wrapper).
      server: { entry: "server" },
      importProtection: {
        behavior: "error",
        client: {
          files: ["**/server/**"],
          specifiers: ["server-only"],
        },
      },
    }),
  ];

  if (command === "build") {
    // Deploy target. Defaults to Vercel (the production host); override with
    // NITRO_PRESET (e.g. "node-server" for a plain Node build).
    const { nitro } = await import("nitro/vite");
    plugins.push(nitro({ preset: process.env.NITRO_PRESET || "vercel" }));
  }

  plugins.push(react());

  return {
    define: envDefine,
    css: { transformer: "lightningcss" },
    resolve: {
      alias: { "@": `${process.cwd()}/src` },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    build: {
      cssCodeSplit: true,
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks: (id: string) => {
            if (
              id.includes("node_modules/react") ||
              id.includes("node_modules/react-dom") ||
              id.includes("@tanstack/react-router") ||
              id.includes("@tanstack/react-start") ||
              id.includes("@tanstack/react-query") ||
              id.includes("@tanstack/query-core")
            )
              return "vendor";
            if (id.includes("@supabase/")) return "supabase";
            if (id.includes("node_modules/recharts")) return "charts";
          },
        },
      },
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "recharts",
        "@supabase/supabase-js",
      ],
      ignoreOutdatedRequests: true,
    },
    plugins,
    server: {
      host: "::",
      port: 8080,
    },
  };
});
