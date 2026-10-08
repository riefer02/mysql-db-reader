import { describe, expect, it } from "vitest";
import {
  assertSafeIdentifier,
  buildOrderBy,
  coerceRows,
  coerceValue,
} from "../src/lib/sql";

describe("assertSafeIdentifier", () => {
  it.each(["users", "user_accounts", "T1", "a1_b2"])(
    "accepts %j",
    (value) => {
      expect(() => assertSafeIdentifier(value, "table")).not.toThrow();
    }
  );

  it.each([
    "users; DROP TABLE x",
    "users`",
    "`users",
    "user accounts",
    "users--",
    "schéma",
    "",
    "users)",
    "users.other",
  ])("rejects %j", (value) => {
    expect(() => assertSafeIdentifier(value, "table")).toThrow();
  });
});

describe("buildOrderBy", () => {
  it("returns null for empty input", () => {
    expect(buildOrderBy()).toBeNull();
    expect(buildOrderBy("   ")).toBeNull();
  });

  it("defaults to ASC", () => {
    expect(buildOrderBy("id")).toBe("ORDER BY `id` ASC");
  });

  it("honours direction case-insensitively", () => {
    expect(buildOrderBy("id desc")).toBe("ORDER BY `id` DESC");
    expect(buildOrderBy("id DESC")).toBe("ORDER BY `id` DESC");
    expect(buildOrderBy("id asc")).toBe("ORDER BY `id` ASC");
  });

  it("rejects injection attempts in the column", () => {
    expect(() => buildOrderBy("id; DROP TABLE users")).toThrow();
    expect(() => buildOrderBy("`id`")).toThrow();
  });

  it("rejects an invalid direction", () => {
    expect(() => buildOrderBy("id sideways")).toThrow();
    expect(() => buildOrderBy("id 1")).toThrow();
  });
});

describe("coerceValue", () => {
  it("converts bigint to string", () => {
    expect(coerceValue(10n)).toBe("10");
  });

  it("converts buffers to base64", () => {
    expect(coerceValue(Buffer.from("hi"))).toBe(Buffer.from("hi").toString("base64"));
  });

  it("recurses into nested objects and arrays", () => {
    const input = {
      a: 1n,
      b: [{ c: 2n }, 3n],
      d: null,
      e: "x",
    };
    expect(coerceValue(input)).toEqual({
      a: "1",
      b: [{ c: "2" }, "3"],
      d: null,
      e: "x",
    });
  });

  it("passes through primitives and dates", () => {
    const date = new Date("2020-01-01T00:00:00Z");
    expect(coerceValue(date)).toBe(date);
    expect(coerceValue(42)).toBe(42);
    expect(coerceValue(true)).toBe(true);
  });
});

describe("coerceRows", () => {
  it("coerces every row", () => {
    expect(coerceRows([{ id: 1n }, { id: 2n }])).toEqual([
      { id: "1" },
      { id: "2" },
    ]);
  });
});
