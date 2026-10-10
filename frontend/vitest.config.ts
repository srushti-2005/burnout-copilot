import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

// Separate from vite.config so the TanStack Start plugins are not loaded during tests.
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: { environment: "jsdom" },
});