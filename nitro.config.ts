import { defineNitroConfig } from "nitro/config";

// `@lovable.dev/mcp-js` (the Lovable MCP server) dynamically imports
// `cloudflare:workers` to read Worker bindings. That module only exists in the
// Cloudflare Workers runtime — the import is wrapped in a try/catch + `.catch()`,
// so it degrades gracefully elsewhere (falls back to `process.env`).
//
// On a non-Cloudflare deploy (e.g. the `vercel` preset) Nitro's Rollup build
// can't resolve `cloudflare:workers`, which fails the build. Externalize it so
// Rollup leaves the dynamic import as-is and the server resolves it at runtime
// (it stays external — and correct — on Cloudflare Workers too).
export default defineNitroConfig({
  rollupConfig: {
    external: ["cloudflare:workers"],
  },
});
