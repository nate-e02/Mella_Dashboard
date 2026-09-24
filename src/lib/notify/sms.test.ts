import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendSms, smsConfigured } from "@/lib/notify/sms";

const ENV_KEYS = ["SMS_PROVIDER", "AFROMESSAGE_TOKEN", "AFROMESSAGE_IDENTIFIER_ID", "AFROMESSAGE_SENDER_NAME", "SMS_GATEWAY_URL", "SMS_API_KEY", "SMS_SENDER_ID"] as const;
const saved: Record<string, string | undefined> = {};
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("provider selection", () => {
  it("is unconfigured without any settings and does not call out", async () => {
    expect(smsConfigured()).toBe(false);
    expect(await sendSms({ to: "+251911234567", message: "hi" })).toEqual({ delivered: false, provider: "console" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the generic gateway when SMS_PROVIDER is unset but the gateway is configured", () => {
    process.env.SMS_GATEWAY_URL = "https://sms.example.test/send";
    process.env.SMS_API_KEY = "k";
    expect(smsConfigured()).toBe(true);
  });

  it("treats afromessage without a token or identifier as unconfigured", () => {
    process.env.SMS_PROVIDER = "afromessage";
    process.env.AFROMESSAGE_TOKEN = "t";
    expect(smsConfigured()).toBe(false);
    process.env.AFROMESSAGE_IDENTIFIER_ID = "id";
    expect(smsConfigured()).toBe(true);
  });

  it("treats an unknown SMS_PROVIDER as unconfigured", () => {
    process.env.SMS_PROVIDER = "carrier-pigeon";
    process.env.SMS_GATEWAY_URL = "https://sms.example.test/send";
    process.env.SMS_API_KEY = "k";
    expect(smsConfigured()).toBe(false);
  });
});

describe("AfroMessage", () => {
  beforeEach(() => {
    process.env.SMS_PROVIDER = "afromessage";
    process.env.AFROMESSAGE_TOKEN = "afro-token";
    process.env.AFROMESSAGE_IDENTIFIER_ID = "ident-1";
    process.env.AFROMESSAGE_SENDER_NAME = "MellaFx";
  });

  it("posts from/sender/to/message with the bearer token and a timeout", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ acknowledge: "success", response: { status: "Send in progress", message_id: "m1" } }));
    const result = await sendSms({ to: "+251911234567", message: "MellaFx code: 123456" });
    expect(result).toEqual({ delivered: true, provider: "afromessage" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.afromessage.com/api/send");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer afro-token");
    expect(JSON.parse(String(init?.body))).toEqual({ from: "ident-1", sender: "MellaFx", to: "+251911234567", message: "MellaFx code: 123456" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports an HTTP 200 with acknowledge=error as not delivered, without logging the message", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValue(jsonResponse({ acknowledge: "error", response: { errors: ["insufficient balance"] } }));
    const result = await sendSms({ to: "+251911234567", message: "MellaFx code: 654321" });
    expect(result).toEqual({ delivered: false, provider: "afromessage" });
    const logged = errorLog.mock.calls.flat().join(" ");
    expect(logged).toContain("insufficient balance");
    expect(logged).not.toContain("654321");
    expect(logged).not.toContain("911234567"); // number is masked
  });

  it("survives a timeout / network error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockRejectedValue(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
    expect(await sendSms({ to: "+251911234567", message: "x" })).toEqual({ delivered: false, provider: "afromessage" });
  });
});

describe("generic gateway", () => {
  beforeEach(() => {
    process.env.SMS_PROVIDER = "generic";
    process.env.SMS_GATEWAY_URL = "https://sms.example.test/send";
    process.env.SMS_API_KEY = "generic-key";
    process.env.SMS_SENDER_ID = "MELLAFX";
  });

  it("posts {to, message, sender_id} with the bearer key", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    expect(await sendSms({ to: "+251911234567", message: "hello" })).toEqual({ delivered: true, provider: "generic" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://sms.example.test/send");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer generic-key");
    expect(JSON.parse(String(init?.body))).toEqual({ to: "+251911234567", message: "hello", sender_id: "MELLAFX" });
  });

  it("reports a non-2xx answer as not delivered", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    expect(await sendSms({ to: "+251911234567", message: "hello" })).toEqual({ delivered: false, provider: "generic" });
  });
});

describe("no provider", () => {
  it("prints the message only in development and never in production", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = process.env as Record<string, string>;
    const original = env.NODE_ENV;
    try {
      env.NODE_ENV = "development";
      await sendSms({ to: "+251911234567", message: "MellaFx code: 111222" });
      expect(log.mock.calls.flat().join(" ")).toContain("111222");

      log.mockClear();
      env.NODE_ENV = "production";
      await sendSms({ to: "+251911234567", message: "MellaFx code: 333444" });
      const printed = [...log.mock.calls, ...warn.mock.calls].flat().join(" ");
      expect(printed).not.toContain("333444");
    } finally {
      env.NODE_ENV = original;
    }
  });
});
