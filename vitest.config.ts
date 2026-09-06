import { defineConfig } from "vitest/config";
import path from "node:path";
import "dotenv/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Next.js resolves "server-only" to its no-op `empty.js` build via the
      // "react-server" export condition, which only its own bundler sets.
      // Outside Next (i.e. under Vitest) the package's default export
      // unconditionally throws, so every service module that guards itself
      // with `import "server-only"` would fail to load in tests. Point the
      // same package's own empty module at it here instead of stubbing it
      // out ourselves.
      "server-only": path.resolve(__dirname, "./node_modules/server-only/empty.js"),
    },
  },
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Integration tests share one Postgres database (the local dev DB) and
    // create/tear down their own uniquely-named fixtures, so they must not
    // run in parallel worker processes against the same connection pool.
    fileParallelism: false,
  },
});
