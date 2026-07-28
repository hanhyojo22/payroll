// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from "vitest";
import { addToast, dismissToast, getSnapshot } from "./notificationStore";

beforeEach(() => {
  // Drain any toasts left over from a previous test so each test starts from empty state.
  for (const toast of getSnapshot().toasts) dismissToast(toast.id);
  vi.useRealTimers();
});

describe("addToast", () => {
  it("adds a toast that shows up in the snapshot", () => {
    const id = addToast("success", "Saved.", 0);
    expect(getSnapshot().toasts).toEqual([{ id, type: "success", message: "Saved.", duration: 0 }]);
  });

  // Reproduces the bug found in the UI/UX audit: retrying a failing action a few times
  // built up a wall of stacked error banners with no cap.
  it("caps the number of concurrent toasts within the same visual group", () => {
    for (let i = 0; i < 6; i++) addToast("error", `Error ${i}`, 0);

    const messages = getSnapshot().toasts.map((toast) => toast.message);
    expect(messages.length).toBeLessThanOrEqual(4);
    // The most recent ones survive; the oldest are the ones evicted.
    expect(messages).toContain("Error 5");
    expect(messages).not.toContain("Error 0");
  });

  it("does not let an unrelated success toast evict a still-relevant error toast's cap budget", () => {
    for (let i = 0; i < 4; i++) addToast("error", `Error ${i}`, 0);
    addToast("success", "Saved.", 0);

    const errorCount = getSnapshot().toasts.filter((toast) => toast.type === "error").length;
    expect(errorCount).toBe(4);
  });

  // Retrying the same failing action must not pile up N identical banners.
  it("does not duplicate an identical message already showing", () => {
    addToast("error", "Network error.", 0);
    addToast("error", "Network error.", 0);
    addToast("error", "Network error.", 0);

    const matching = getSnapshot().toasts.filter((toast) => toast.message === "Network error.");
    expect(matching).toHaveLength(1);
  });

  it("still allows different messages of the same type to coexist", () => {
    addToast("error", "Network error.", 0);
    addToast("error", "Validation failed.", 0);

    expect(getSnapshot().toasts).toHaveLength(2);
  });

  it("restarts the auto-dismiss timer when deduping instead of leaving the original", () => {
    vi.useFakeTimers();
    const first = addToast("error", "Network error.", 1000);
    vi.advanceTimersByTime(800);
    addToast("error", "Network error.", 1000);
    vi.advanceTimersByTime(800);

    // 1600ms since the second call started its own 1000ms timer, so it should still be up
    // even though 1600ms have passed since the very first call.
    expect(getSnapshot().toasts.map((toast) => toast.id)).toContain(first);
    vi.useRealTimers();
  });
});
