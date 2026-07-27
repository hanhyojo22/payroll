import { describe, expect, it } from "vitest";
import { friendlyError } from "./errors";

describe("friendlyError", () => {
  // Postgres phrases these with the relation, constraint and sometimes the failing row's
  // values. None of that belongs on screen in a payroll app -- name the field and stop.
  it("names the missing field without echoing the raw Postgres message", () => {
    const result = friendlyError({
      code: "23502",
      message: 'null value in column "contact_number" of relation "employees" violates not-null constraint',
      details: "Failing row contains (a1b2, Ana Cruz, 25000.00, null).",
    });
    expect(result).toContain("contact_number");
    expect(result).not.toContain("relation");
    expect(result).not.toContain("not-null constraint");
    expect(result).not.toContain("Ana Cruz");
    expect(result).not.toContain("25000.00");
  });

  it("does not leak the constraint name on a check violation", () => {
    const result = friendlyError({
      code: "23514",
      message: 'new row for relation "employees" violates check constraint "employees_wage_category_check"',
      details: null,
    });
    expect(result).not.toContain("employees_wage_category_check");
    expect(result).not.toContain("relation");
    expect(result.length).toBeGreaterThan(0);
  });

  it("does not leak the failing row on a not-null violation reported without a column", () => {
    const result = friendlyError({
      code: "23502",
      message: "null value in column violates not-null constraint",
      details: "Failing row contains (a1b2, Ana Cruz, 25000.00).",
    });
    expect(result).not.toContain("Ana Cruz");
    expect(result).not.toContain("25000.00");
  });

  // Same false positive as isOfflineLikeError: a client named "... Network ..." must not be
  // reported to the admin as an internet connectivity problem.
  it("does not report a server-coded error as a connection failure just because data says network", () => {
    const result = friendlyError({
      code: "23505",
      message: 'duplicate key value violates unique constraint "collection_reminders_client_name_key"',
      details: "Key (client_name)=(Alpha Network Solutions) already exists.",
    });
    expect(result).not.toContain("internet connection");
    expect(result).toContain("already exists");
  });

  it("still reports a genuine connectivity failure as one", () => {
    expect(friendlyError({ message: "TypeError: Failed to fetch" })).toContain("Unable to connect");
  });

  it("keeps the existing friendly cases intact", () => {
    expect(friendlyError({ message: "Invalid login credentials" })).toBe("Email or password is incorrect.");
    expect(friendlyError({ code: "REQUEST_TIMEOUT", message: "Payroll request timed out", details: "Payroll is taking longer than expected." }))
      .toContain("longer than expected");
    expect(friendlyError(null)).toBe("Something went wrong. Please try again.");
  });
});
