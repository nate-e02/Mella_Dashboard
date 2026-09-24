import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-hosted container build: .next/standalone + server.js (see Dockerfile).
  output: "standalone",
  poweredByHeader: false,
  // Native / long-lived Node packages must not be bundled by the server compiler.
  serverExternalPackages: ["bcrypt", "ioredis", "pino", "pino-pretty", "@prisma/client", "prisma"],
  images: { remotePatterns: [] },
};

export default nextConfig;
