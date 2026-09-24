import { describe, expect, it } from "vitest";
import { eventExternalId, parseEventTime, parseEventsCsv, parseForexFactoryCalendar, parseImpact, splitCsvLine } from "./newsCalendar";

describe("Forex-Factory-style calendar parser", () => {
  const feed = [
    { title: "Non-Farm Employment Change", country: "USD", date: "2026-09-25T08:30:00-04:00", impact: "High", forecast: "150K", previous: "142K" },
    { title: "German Prelim CPI m/m", country: "eur", date: "2026-09-28T08:00:00+02:00", impact: "Medium" },
    { title: "Bank Holiday", country: "GBP", date: "2026-09-28T03:00:00-04:00", impact: "Holiday" },
    { title: "OPEC Meetings", country: "All", date: "2026-09-28T00:00:00-04:00", impact: "Low" },
    { title: "No zone", country: "USD", date: "2026-09-25T08:30:00", impact: "High" },
    { title: "", country: "USD", date: "2026-09-25T08:30:00-04:00", impact: "High" },
    null,
    "junk",
  ];

  it("keeps valid economic events with their instant and impact, skipping holidays, non-currencies and malformed rows", () => {
    const rows = parseForexFactoryCalendar(feed);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      title: "Non-Farm Employment Change",
      currency: "USD",
      impact: "HIGH",
      scheduledAt: new Date("2026-09-25T12:30:00.000Z"),
      externalId: "ff:USD:2026-09-25:non-farm-employment-change",
      source: "FOREX_FACTORY",
    });
    expect(rows[1]).toMatchObject({ currency: "EUR", impact: "MEDIUM", scheduledAt: new Date("2026-09-28T06:00:00.000Z") });
  });

  it("gives a stable id per currency/day/title so re-imports upsert (a time change on the same day keeps the id)", () => {
    const a = parseForexFactoryCalendar([feed[0]])[0];
    const b = parseForexFactoryCalendar([{ ...(feed[0] as object), date: "2026-09-25T10:00:00-04:00" }])[0];
    expect(a.externalId).toBe(b.externalId);
    expect(eventExternalId("ff", { currency: "USD", title: "FOMC Statement (Q&A)", scheduledAt: new Date("2026-09-16T18:00:00Z") })).toBe("ff:USD:2026-09-16:fomc-statement-q-a");
  });

  it("returns nothing for a non-array payload", () => {
    expect(parseForexFactoryCalendar({ events: [] })).toEqual([]);
    expect(parseForexFactoryCalendar(null)).toEqual([]);
  });
});

describe("CSV import parser", () => {
  it("parses title,currency,impact,datetime with an optional header, quotes and comments", () => {
    const csv = [
      "title,currency,impact,datetime",
      "Non-Farm Payrolls,USD,HIGH,2026-09-25T08:30:00-04:00",
      '"Powell Speaks, Q&A",usd,high,2026-09-25T14:00:00Z',
      "# a comment",
      "",
      'ECB "Main" Rate,EUR,Medium,2026-09-24T14:15:00+02:00',
    ].join("\r\n");
    const { rows, errors } = parseEventsCsv(csv);
    expect(errors).toEqual([]);
    expect(rows.map((r) => [r.title, r.currency, r.impact, r.scheduledAt.toISOString()])).toEqual([
      ["Non-Farm Payrolls", "USD", "HIGH", "2026-09-25T12:30:00.000Z"],
      ["Powell Speaks, Q&A", "USD", "HIGH", "2026-09-25T14:00:00.000Z"],
      ['ECB "Main" Rate', "EUR", "MEDIUM", "2026-09-24T12:15:00.000Z"],
    ]);
    expect(rows[0].externalId).toBe("csv:USD:2026-09-25:non-farm-payrolls");
  });

  it("reports each bad line with its number and keeps the good ones", () => {
    const { rows, errors } = parseEventsCsv(
      ["CPI,USD,HIGH,2026-09-25T08:30:00-04:00", "Too,few", "GDP,US,HIGH,2026-09-25T08:30:00Z", "GDP,USD,EXTREME,2026-09-25T08:30:00Z", "GDP,USD,HIGH,2026-09-25 08:30", ",USD,HIGH,2026-09-25T08:30:00Z"].join("\n"),
    );
    expect(rows).toHaveLength(1);
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 6]);
    expect(errors[3].message).toMatch(/ISO-8601 with offset/);
  });

  it("splits CSV lines and parses impacts and times defensively", () => {
    expect(splitCsvLine('a,"b,c","""d"""')).toEqual(["a", "b,c", '"d"']);
    expect(splitCsvLine("a , b ,c")).toEqual(["a", "b", "c"]);
    expect(parseImpact(" high ")).toBe("HIGH");
    expect(parseImpact("med")).toBe("MEDIUM");
    expect(parseImpact("Holiday")).toBeNull();
    expect(parseEventTime("2026-09-25T08:30-0400")?.toISOString()).toBe("2026-09-25T12:30:00.000Z");
    expect(parseEventTime("2026-02-30T08:30:00Z")).toBeNull();
    expect(parseEventTime("tomorrow")).toBeNull();
    expect(parseEventTime(123)).toBeNull();
  });
});
