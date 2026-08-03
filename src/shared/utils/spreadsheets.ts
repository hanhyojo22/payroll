const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * Prevent spreadsheet applications from interpreting untrusted report values as formulas.
 * Quoting a CSV field is not sufficient: Excel and similar tools still evaluate a quoted
 * value whose first character is a formula sigil.
 */
export function neutralizeSpreadsheetFormula(value: string) {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

export function escapeCsvCell(value: string) {
  const safeValue = neutralizeSpreadsheetFormula(value);
  return `"${safeValue.replace(/"/g, "\"\"")}"`;
}
