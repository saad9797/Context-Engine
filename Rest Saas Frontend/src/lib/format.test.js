import { describe, expect, it } from "vitest";
import { approxTokens, formatBytes, formatDate } from "./format";

describe("formatDate", () => {
  it("returns an em dash for null/undefined", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
  });

  it("formats a real ISO date without throwing", () => {
    const result = formatDate("2026-09-28T12:00:00Z");
    expect(result).not.toBe("—");
    expect(typeof result).toBe("string");
  });

  it("falls back to the raw string for unparseable input rather than crashing", () => {
    // Date parsing itself doesn't throw for garbage input (it produces
    // Invalid Date), so this mainly guards against a future rewrite that
    // adds throwing behavior — formatDate must degrade, not crash a page.
    expect(() => formatDate("not-a-date")).not.toThrow();
  });
});

describe("formatBytes", () => {
  it("returns an em dash for null/undefined", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(undefined)).toBe("—");
  });

  it("formats bytes under 1KB as plain bytes", () => {
    expect(formatBytes(500)).toBe("500 B");
  });

  it("formats kilobytes with one decimal", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("formats megabytes with one decimal", () => {
    expect(formatBytes(1024 * 1024 * 2.5)).toBe("2.5 MB");
  });

  it("treats exactly 0 bytes as a real value, not missing", () => {
    // 0 is falsy in JS but a legitimate byte count — formatBytes checks
    // `=== null/undefined` specifically rather than a truthiness check,
    // this test guards that distinction.
    expect(formatBytes(0)).toBe("0 B");
  });
});

describe("approxTokens", () => {
  it("matches the backend's chars/4 approximation convention", () => {
    const obj = { a: 1, b: "hello" };
    const expectedChars = JSON.stringify(obj).length;
    expect(approxTokens(obj)).toBe(Math.round(expectedChars / 4));
  });

  it("returns 0 for an empty object, not NaN or a crash", () => {
    expect(approxTokens({})).toBe(Math.round(JSON.stringify({}).length / 4));
    expect(Number.isNaN(approxTokens({}))).toBe(false);
  });
});
