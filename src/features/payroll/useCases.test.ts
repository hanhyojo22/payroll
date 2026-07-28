import { describe, expect, it, vi } from "vitest";
import { markItemPaid, markItemPending, updatePayrollItem } from "./useCases";
import { fakePayrollRepository } from "../../testing/fakes";
import type { QueueOfflineMutation } from "../../shared/types";
import type { PayrollRunItem, PayrollRunWithItems } from "../../types";

const item = (overrides: Partial<PayrollRunItem> = {}): PayrollRunItem => ({
  id: "i1", user_id: "u1", payroll_run_id: "r1", employee_id: "e1", employee_name: "Ana Cruz",
  position_id: "p1", position_name: "Technician", pay_mode: "ticket", base_pay: 0,
  ticket_pay: 750, daily_rate: 0, days_worked: 0, total_working_days: 0, ticket_details: [],
  installation_tickets: 0, repair_tickets: 3, installation_rate: 0, repair_rate: 0,
  nap_rehab_tickets: 0, nap_rehab_rate: 0, gross_pay: 750, allowances: 0, deductions: 0,
  net_pay: 750, status: "pending", paid_date: null, notes: "",
  created_at: "2026-06-01T00:00:00Z", updated_at: "2026-06-01T00:00:00Z", ...overrides,
});

const run = (items: PayrollRunItem[]): PayrollRunWithItems => ({
  id: "r1", user_id: "u1", period_month: 6, period_year: 2026, pay_period: "first_half",
  generated_date: "2026-06-16", notes: "",
  created_at: "2026-06-16T00:00:00Z", updated_at: "2026-06-16T00:00:00Z", items,
});

function deps({ online = true, confirmed = true } = {}) {
  const payroll = fakePayrollRepository();
  return {
    repos: { payroll },
    queue: vi.fn(async (_mutation: Parameters<QueueOfflineMutation>[0]) => {}),
    notify: {
      success: vi.fn((_message: string) => {}),
      error: vi.fn((_message: string) => {}),
      confirm: vi.fn(async (_options: { title: string; message: string; danger?: boolean }) => confirmed),
    },
    isOnline: () => online,
    reload: vi.fn(async () => {}),
    applyLocalRuns: vi.fn(),
    today: () => "2026-06-20",
  };
}

describe("updatePayrollItem", () => {
  it("queues the patch when offline and applies it optimistically", async () => {
    const d = deps({ online: false });
    const target = item();
    d.repos.payroll.seedItems([target]);

    await updatePayrollItem(d, { item: target, patch: { allowances: 500 }, runs: [run([target])] });

    expect(d.queue).toHaveBeenCalledTimes(1);
    expect(d.queue.mock.calls[0][0]).toMatchObject({
      table: "payroll_run_items", operation: "update", recordId: "i1",
    });
    expect(d.applyLocalRuns).toHaveBeenCalledTimes(1);
    expect(d.repos.payroll.itemsFor("r1")[0].allowances).toBe(0);
  });

  it("writes through and reloads when online", async () => {
    const d = deps();
    const target = item();
    d.repos.payroll.seedItems([target]);

    await updatePayrollItem(d, { item: target, patch: { allowances: 500 }, runs: [run([target])] });

    expect(d.repos.payroll.itemsFor("r1")[0].allowances).toBe(500);
    expect(d.reload).toHaveBeenCalledTimes(1);
    expect(d.queue).not.toHaveBeenCalled();
  });

  it("falls back to the queue on a connectivity failure", async () => {
    const d = deps();
    const target = item();
    d.repos.payroll.seedItems([target]);
    d.repos.payroll.failNext({ message: "Failed to fetch" });

    await updatePayrollItem(d, { item: target, patch: { allowances: 500 }, runs: [run([target])] });

    expect(d.queue).toHaveBeenCalledTimes(1);
    expect(d.notify.error).not.toHaveBeenCalled();
  });

  it("surfaces a server error without queueing", async () => {
    const d = deps();
    const target = item();
    d.repos.payroll.seedItems([target]);
    d.repos.payroll.failNext({ code: "42501", message: "row-level security" });

    await updatePayrollItem(d, { item: target, patch: { allowances: 500 }, runs: [run([target])] });

    expect(d.notify.error).toHaveBeenCalled();
    expect(d.queue).not.toHaveBeenCalled();
    expect(d.reload).not.toHaveBeenCalled();
  });
});

describe("markItemPaid / markItemPending", () => {
  it("stamps today's date when marking paid", async () => {
    const d = deps();
    const target = item();
    d.repos.payroll.seedItems([target]);

    await markItemPaid(d, { item: target, runs: [run([target])] });

    const saved = d.repos.payroll.itemsFor("r1")[0];
    expect(saved.status).toBe("paid");
    expect(saved.paid_date).toBe("2026-06-20");
  });

  it("clears the paid date when reverting to pending", async () => {
    const d = deps();
    const target = item({ status: "paid", paid_date: "2026-06-20" });
    d.repos.payroll.seedItems([target]);

    await markItemPending(d, { item: target, runs: [run([target])] });

    const saved = d.repos.payroll.itemsFor("r1")[0];
    expect(saved.status).toBe("pending");
    expect(saved.paid_date).toBeNull();
  });
});
