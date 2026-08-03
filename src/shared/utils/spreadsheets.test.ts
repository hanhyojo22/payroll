import { describe, expect, it } from "vitest";
import { escapeCsvCell, neutralizeSpreadsheetFormula } from "./spreadsheets";

describe("neutralizeSpreadsheetFormula", () => {
  it.each(["=1+1", "+SUM(A1:A2)", "-2+3", "@SUM(A1:A2)", "\t=1+1", "\r=1+1"])(
    "neutralizes a dangerous prefix in %j",
    (value) => {
      expect(neutralizeSpreadsheetFormula(value)).toBe(`'${value}`);
    },
  );

  it("does not alter ordinary report values", () => {
    expect(neutralizeSpreadsheetFormula("Employee 01")).toBe("Employee 01");
  });
});

describe("escapeCsvCell", () => {
  it("neutralizes formulas and escapes quotes", () => {
    expect(escapeCsvCell('=HYPERLINK("https://example.test")')).toBe(
      '"\'=HYPERLINK(""https://example.test"")"',
    );
  });
});
