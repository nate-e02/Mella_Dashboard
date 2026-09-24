"use client";

import { useSyncExternalStore } from "react";

/**
 * Wall clock for time-based UI (rule banners, order-button blocks), advancing
 * in `STEP_MS` steps. Null during SSR and hydration so server and client
 * markup agree; the real time arrives right after without an effect.
 */
const STEP_MS = 5_000;

function subscribe(onChange: () => void) {
  const id = setInterval(onChange, STEP_MS);
  return () => clearInterval(id);
}
const getSnapshot = () => Math.floor(Date.now() / STEP_MS) * STEP_MS;
const getServerSnapshot = () => null;

export function useClock(): number | null {
  return useSyncExternalStore<number | null>(subscribe, getSnapshot, getServerSnapshot);
}
