import { createRequire } from "node:module";
import pino from "pino";

function prettyAvailable(): boolean {
  try {
    createRequire(path())("pino-pretty");
    return true;
  } catch {
    return false;
  }
}

function path(): string {
  return `${process.cwd()}/package.json`;
}

export function createLogger(): pino.Logger {
  const level = process.env.LOG_LEVEL || "info";
  const pretty = process.env.NODE_ENV !== "production" && process.env.LOG_PRETTY !== "false" && prettyAvailable();
  if (pretty) {
    return pino({ level, transport: { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss.l", ignore: "pid,hostname" } } });
  }
  return pino({ level, base: { service: "trading-worker" } });
}

export type Logger = pino.Logger;
