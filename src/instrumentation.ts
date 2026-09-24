export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getEnv } = await import("./env");
    // Throws with a readable list of problems; Next surfaces it at boot.
    getEnv();
  }
}
