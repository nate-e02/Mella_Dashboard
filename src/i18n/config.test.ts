import { describe, expect, it } from "vitest";
import { isLocale, localeFromAcceptLanguage } from "./config";
import { interpolate } from "./format";
import { dictionaries, en } from "./messages";

describe("i18n", () => {
  it("validates locales", () => {
    expect(isLocale("am")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it("picks the highest-ranked supported Accept-Language", () => {
    expect(localeFromAcceptLanguage("am-ET,am;q=0.9,en;q=0.8")).toBe("am");
    expect(localeFromAcceptLanguage("fr-FR,fr;q=0.9,en;q=0.5,am;q=0.4")).toBe("en");
    expect(localeFromAcceptLanguage("en;q=0.3,am;q=0.7")).toBe("am");
    expect(localeFromAcceptLanguage("fr")).toBeNull();
    expect(localeFromAcceptLanguage(null)).toBeNull();
  });

  it("interpolates variables and leaves unknown ones visible", () => {
    expect(interpolate("Hi {name}, {n} left", { name: "Abebe", n: 3 })).toBe("Hi Abebe, 3 left");
    expect(interpolate("Hi {name}", {})).toBe("Hi {name}");
  });

  it("has a non-empty Amharic string for every English key", () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(dictionaries.am[key], key).toBeTruthy();
    }
  });

  it("keeps the same placeholders in both languages", () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(vars(dictionaries.am[key]), key).toBe(vars(en[key]));
    }
  });
});
