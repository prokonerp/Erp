import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      GET: async () => {
        return Response.json({
          name: "Prokon ERP",
          version: "1.0",
          capabilities: [],
        });
      },
    },
  },
});
