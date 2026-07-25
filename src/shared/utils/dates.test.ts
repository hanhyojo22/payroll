import { describe, expect, it } from "vitest";
import { addDays } from "./dates";

describe("addDays", () => {
  it("adds calendar days without a timezone shift", () => {
    expect(addDays("2026-07-25", 15)).toBe("2026-08-09");
  });

  it("crosses leap-day and year boundaries", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("supports negative offsets and leaves invalid values unchanged", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("", 15)).toBe("");
  });
});
