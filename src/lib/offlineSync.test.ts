import { describe, expect, it, beforeEach } from "vitest";
import { isOfflineLikeError } from "./offlineSync";

// isOfflineLikeError reads navigator.onLine, which does not exist in the node test env.
beforeEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine: true },
    configurable: true,
    writable: true,
  });
});

const setOnline = (onLine: boolean) => {
  Object.defineProperty(globalThis, "navigator", { value: { onLine }, configurable: true, writable: true });
};

describe("isOfflineLikeError", () => {
  it("treats real connectivity failures as offline", () => {
    expect(isOfflineLikeError({ message: "TypeError: Failed to fetch" })).toBe(true);
    expect(isOfflineLikeError({ message: "NetworkError when attempting to fetch resource." })).toBe(true);
    expect(isOfflineLikeError({ message: "Network request failed" })).toBe(true);
    expect(isOfflineLikeError({ message: "Load failed" })).toBe(true);
  });

  it("treats our own request timeout as offline", () => {
    expect(isOfflineLikeError({ code: "REQUEST_TIMEOUT", message: "Payroll request timed out" })).toBe(true);
  });

  it("treats anything as offline while the browser reports no connection", () => {
    setOnline(false);
    expect(isOfflineLikeError({ code: "23505", message: "duplicate key value" })).toBe(true);
  });

  // A record whose own text contains "network" must not be mistaken for a connectivity
  // blip -- doing so requeues it forever instead of showing the admin the real error.
  it("does not mistake business data containing the word network for a connectivity failure", () => {
    expect(isOfflineLikeError({
      code: "23505",
      message: "duplicate key value violates unique constraint \"collection_reminders_client_name_key\"",
      details: "Key (client_name)=(Alpha Network Solutions) already exists.",
    })).toBe(false);

    expect(isOfflineLikeError({
      code: "23502",
      message: "null value in column \"client_name\" violates not-null constraint",
      details: "Failing row contains (Metro Network Corp, null).",
    })).toBe(false);
  });

  // A server-assigned code proves the request reached Postgres, so it is a real failure.
  it("never treats a server-coded error as offline", () => {
    expect(isOfflineLikeError({ code: "PGRST116", message: "The result contains 0 rows" })).toBe(false);
    expect(isOfflineLikeError({ code: "42501", message: "new row violates row-level security policy" })).toBe(false);
  });

  it("treats an unrecognised error with no code as a real failure", () => {
    expect(isOfflineLikeError({ message: "Something unexpected happened" })).toBe(false);
    expect(isOfflineLikeError(null)).toBe(false);
  });
});
