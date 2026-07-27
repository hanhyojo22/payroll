import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  clearOfflineDataForUser,
  getPendingMutations,
  queueMutation,
  readCachedResource,
  writeCachedResource,
} from "./offlineDb";

// queueMutation coalesces per (userId, table, recordId), so giving each test its own
// userId keeps them isolated without reaching into the shared module-level connection.
let userSeq = 0;
const nextUserId = () => `user-${++userSeq}`;

const mutation = (
  userId: string,
  operation: "insert" | "update" | "upsert" | "delete",
  payload: Record<string, unknown> | undefined,
  recordId = "payroll-item-1",
) => ({
  userId,
  resource: "payrollRuns" as const,
  affectedResources: ["payrollRuns" as const],
  operation,
  table: "payroll_run_items",
  recordId,
  payload,
});

describe("offline mutation queue coalescing", () => {
  // Every update payload in the app is a partial patch ({ status }, { allowances, net_pay }),
  // so replacing an earlier queued update with a later one drops the earlier field edits.
  it("merges two partial updates to the same record instead of dropping the first", async () => {
    const userId = nextUserId();
    await queueMutation(mutation(userId, "update", { allowances: 500, gross_pay: 5500, net_pay: 5500 }));
    await queueMutation(mutation(userId, "update", { status: "paid", paid_date: "2026-07-27" }));

    const pending = await getPendingMutations(userId);
    expect(pending).toHaveLength(1);
    expect(pending[0].operation).toBe("update");
    expect(pending[0].payload).toEqual({
      allowances: 500,
      gross_pay: 5500,
      net_pay: 5500,
      status: "paid",
      paid_date: "2026-07-27",
    });
  });

  it("lets a later update win on fields the earlier update also set", async () => {
    const userId = nextUserId();
    await queueMutation(mutation(userId, "update", { allowances: 500, net_pay: 5500 }));
    await queueMutation(mutation(userId, "update", { allowances: 750, net_pay: 5750 }));

    const pending = await getPendingMutations(userId);
    expect(pending).toHaveLength(1);
    expect(pending[0].payload).toEqual({ allowances: 750, net_pay: 5750 });
  });

  it("keeps merging across three queued updates", async () => {
    const userId = nextUserId();
    await queueMutation(mutation(userId, "update", { allowances: 500 }));
    await queueMutation(mutation(userId, "update", { deductions: 200 }));
    await queueMutation(mutation(userId, "update", { status: "paid" }));

    const pending = await getPendingMutations(userId);
    expect(pending).toHaveLength(1);
    expect(pending[0].payload).toEqual({ allowances: 500, deductions: 200, status: "paid" });
  });

  it("still folds an update into a pending insert as a single insert", async () => {
    const userId = nextUserId();
    await queueMutation(mutation(userId, "insert", { id: "payroll-item-1", allowances: 0, status: "pending" }));
    await queueMutation(mutation(userId, "update", { status: "paid" }));

    const pending = await getPendingMutations(userId);
    expect(pending).toHaveLength(1);
    expect(pending[0].operation).toBe("insert");
    expect(pending[0].payload).toEqual({ id: "payroll-item-1", allowances: 0, status: "paid" });
  });

  it("collapses queued updates into a following delete", async () => {
    const userId = nextUserId();
    await queueMutation(mutation(userId, "update", { allowances: 500 }));
    await queueMutation(mutation(userId, "delete", undefined));

    const pending = await getPendingMutations(userId);
    expect(pending).toHaveLength(1);
    expect(pending[0].operation).toBe("delete");
  });

  it("does not merge updates across different records", async () => {
    const userId = nextUserId();
    await queueMutation(mutation(userId, "update", { allowances: 500 }, "payroll-item-1"));
    await queueMutation(mutation(userId, "update", { status: "paid" }, "payroll-item-2"));

    // Order is not asserted: same-millisecond mutations tie on createdAt, and separate
    // records carry no replay dependency on each other.
    const pending = await getPendingMutations(userId);
    expect(pending).toHaveLength(2);
    expect(pending.find((item) => item.recordId === "payroll-item-1")?.payload).toEqual({ allowances: 500 });
    expect(pending.find((item) => item.recordId === "payroll-item-2")?.payload).toEqual({ status: "paid" });
  });

  it("does not merge updates belonging to different users", async () => {
    const userA = nextUserId();
    const userB = nextUserId();
    await queueMutation(mutation(userA, "update", { allowances: 500 }));
    await queueMutation(mutation(userB, "update", { status: "paid" }));

    expect(await getPendingMutations(userA)).toHaveLength(1);
    expect((await getPendingMutations(userA))[0].payload).toEqual({ allowances: 500 });
    expect(await getPendingMutations(userB)).toHaveLength(1);
  });
});

describe("clearing offline data on sign out", () => {
  // Signing out must not leave employee names, salaries and government IDs sitting in
  // IndexedDB for whoever opens the browser next.
  it("removes the signed-out user's cached resources and queued mutations", async () => {
    const userId = nextUserId();
    await writeCachedResource("employees", userId, [{ id: "employee-1", full_name: "Ana Cruz" }]);
    await queueMutation(mutation(userId, "update", { status: "paid" }));

    await clearOfflineDataForUser(userId);

    expect(await readCachedResource("employees", userId)).toBeNull();
    expect(await getPendingMutations(userId)).toHaveLength(0);
  });

  it("leaves another user's cached resources and queued mutations untouched", async () => {
    const signingOut = nextUserId();
    const other = nextUserId();
    await writeCachedResource("employees", signingOut, [{ id: "employee-1" }]);
    await writeCachedResource("employees", other, [{ id: "employee-2" }]);
    await queueMutation(mutation(other, "update", { status: "paid" }));

    await clearOfflineDataForUser(signingOut);

    expect(await readCachedResource("employees", other)).toEqual([{ id: "employee-2" }]);
    expect(await getPendingMutations(other)).toHaveLength(1);
  });

  it("is safe to call for a user that has nothing cached", async () => {
    await expect(clearOfflineDataForUser(nextUserId())).resolves.not.toThrow();
  });
});
