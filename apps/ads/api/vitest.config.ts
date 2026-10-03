import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const serverOnlyEmpty = fileURLToPath(new URL("../../../node_modules/server-only/empty.js", import.meta.url));

export default defineConfig({
  // Node's default condition loads the throwing build of `server-only`.
  // Tests are not a Client Component. Next still uses the package exports.
  resolve: {
    alias: {
      "server-only": serverOnlyEmpty,
    },
  },
  test: {
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ["./test/setup-database-guard.ts"],
  },
});
