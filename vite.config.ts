import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { parseAppConfig } from "./src/app/env";

export default defineConfig(({ mode }) => {
  parseAppConfig({
    commandEnv: process.env,
    modeEnv: loadEnv(mode, process.cwd(), ""),
  });

  return {
    plugins: [react()],
    server: { port: 5183 },
    test: {
      environment: "node",
      include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
    },
  };
});
