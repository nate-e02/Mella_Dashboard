/**
 * Trading worker entry point.
 *
 * Runs as `node --conditions=react-server --import tsx src/worker/index.ts`
 * (the react-server condition turns the `server-only` guard into a no-op so
 * the shared services can be imported). Everything real lives in ./main.ts.
 */
import("./main")
  .then((m) => m.main())
  .catch((err: unknown) => {
    console.error("[worker] fatal:", err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
