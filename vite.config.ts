/// <reference types="vitest/config" />
import type { IncomingMessage, ServerResponse } from "node:http";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

const API_ROUTES: Record<string, string> = {
  "/api/data": "/api/data.ts",
  "/api/health": "/api/health.ts",
};

/**
 * Serves api/ inside `npm run dev`, on the same port as the app, with no Vercel CLI.
 * Handlers load through ssrLoadModule on every request, so edits apply without a restart.
 */
function apiRoutes(): Plugin {
  return {
    name: "sg-weather-api-routes",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? "").split("?")[0];
        const modulePath = path === undefined ? undefined : API_ROUTES[path];
        if (!modulePath) {
          next();
          return;
        }
        server
          .ssrLoadModule(modulePath)
          .then((mod) => (mod.default as Handler)(req, res))
          .catch((error: unknown) => next(error));
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Only DATAGOV_API_KEY is copied, into process.env, where only api/_lib reads it on the server.
  const env = loadEnv(mode, process.cwd(), "");
  if (env.DATAGOV_API_KEY) process.env.DATAGOV_API_KEY = env.DATAGOV_API_KEY;

  return {
    plugins: [react(), apiRoutes()],
    test: {
      environment: "node",
      include: ["tests/**/*.test.ts"],
    },
  };
});
