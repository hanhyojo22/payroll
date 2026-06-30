import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { BadgeDollarSign, CalendarClock, CheckCircle2, ChevronDown, Plus, Search, Users, X } from "lucide-react";
import { Spinner } from "../../shared/components/Spinner";
import {
  attendanceTotalsForEmployee,
  dailyTicketEntriesForPayrollPeriod,
  payrollItemPayloadForEmployee,
} from "../../domain/payroll";
import { netPay, normalizeTicketCount, ticketGrossPay } from "../../domain/tickets";
import { isOfflineLikeError } from "../../lib/offlineSync";
import { supabase } from "../../supabase";
import { FormActions, Modal, TextField } from "../../shared/components/FormLayout";
import { DataTable } from "../../shared/components/DataTable";
import { PageHeader, RecordTitle, Toolbar } from "../../shared/components/PageLayout";
import { StatusBadge } from "../../shared/components/StatusBadge";
import type { Notice, QueueOfflineMutation } from "../../shared/types";
import { currency, toNumber } from "../../shared/utils/currency";
import { currentMonth, currentYear, monthNames, todayKey } from "../../shared/utils/dates";
import { friendlyError } from "../../shared/utils/errors";
import type {
  AttendanceEntry,
  DailyTicketEntry,
  Employee,
  PayrollHistoryRow,
  PayrollPayPeriod,
  PayrollRun,
  PayrollRunFormValues,
  PayrollRunItem,
  PayrollRunWithItems,
  Position,
  SalaryBond,
} from "../../types";

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "E";
}

function EmpAvatar({ employees, employeeId, employeeName }: { employees: Employee[]; employeeId: string | null; employeeName: string }) {
  const emp = employees.find((e) => e.id === employeeId);
  const fallback = initials(employeeName);
  return (
    <div className="employee-list-avatar">
      {emp?.profile_photo_url
        ? <img alt="" src={emp.profile_photo_url} />
        : <span>{fallback}</span>}
    </div>
  );
}

const emptyPayrollRun: PayrollRunFormValues = {
  period_month: currentMonth(),
  period_year: currentYear(),
  pay_period: "first_half",
  generated_date: todayKey(),
  notes: "",
};

type SalaryBondPayrollDeduction = {
  amount: number;
  bond: SalaryBond;
};

function salaryBondDeductionsForEmployee(
  salaryBonds: SalaryBond[],
  employee: Employee,
  payrollDate: string,
) {
  return salaryBonds
    .filter((bond) =>
      bond.status === "active" &&
      bond.employee_id === employee.id &&
      toNumber(bond.balance) > 0 &&
      toNumber(bond.deduction_per_payroll) > 0 &&
      (!bond.start_deduction || bond.start_deduction <= payrollDate)
    )
    .map((bond) => ({
      amount: Math.min(toNumber(bond.balance), toNumber(bond.deduction_per_payroll)),
      bond,
    }))
    .filter((deduction) => deduction.amount > 0);
}

function payrollItemPayloadForEmployeeWithSalaryBonds(
  employee: Employee,
  position: Position | undefined,
  payrollRunId: string,
  userId: string,
  dailyTicketEntries: DailyTicketEntry[],
  salaryBonds: SalaryBond[],
  payrollDate: string,
  attendanceEntries: AttendanceEntry[] = [],
  periodMonth = 0,
  periodYear = 0,
  payPeriod: PayrollPayPeriod = "first_half",
) {
  const payload = payrollItemPayloadForEmployee(
    employee,
    payrollRunId,
    userId,
    dailyTicketEntries,
    position,
    attendanceEntries,
    periodMonth,
    periodYear,
    payPeriod,
  );
  const bondDeductions = salaryBondDeductionsForEmployee(salaryBonds, employee, payrollDate);
  const salaryBondDeduction = bondDeductions.reduce((sum, deduction) => sum + deduction.amount, 0);

  if (salaryBondDeduction === 0) {
    return { bondDeductions, payload };
  }

  const deductions = toNumber(payload.deductions) + salaryBondDeduction;
  const note = `Salary bond deduction: ${currency.format(salaryBondDeduction)}`;

  return {
    bondDeductions,
    payload: {
      ...payload,
      deductions,
      net_pay: netPay(toNumber(payload.gross_pay), toNumber(payload.allowances), deductions),
      notes: [payload.notes, note].filter(Boolean).join(" | "),
    },
  };
}

async function applySalaryBondPayrollDeductions(deductions: SalaryBondPayrollDeduction[]) {
  if (!supabase || deductions.length === 0) return null;
  const client = supabase;

  const updates = deductions.map(({ amount, bond }) => {
    const balance = Math.max(0, toNumber(bond.balance) - amount);
    return client
      .from("salary_bonds")
      .update({
        balance,
        status: balance === 0 ? "completed" : bond.status,
      })
      .eq("id", bond.id);
  });
  const results = await Promise.all(updates);
  return results.find((result) => result.error)?.error ?? null;
}

export function PayrollFeature({
  attendanceEntries,
  dailyTicketEntries,
  employees,
  ensurePayrollRunItems,
  onLocalPayrollRunsChange,
  onChange,
  onQueueOfflineMutation,
  payrollRuns,
  positions,
  salaryBonds,
  setNotice,
  tabs,
  userId,
}: {
  attendanceEntries: AttendanceEntry[];
  dailyTicketEntries: DailyTicketEntry[];
  employees: Employee[];
  ensurePayrollRunItems: (payrollRunId: string) => Promise<void>;
  onLocalPayrollRunsChange: (payrollRuns: PayrollRunWithItems[]) => void;
  onChange: () => Promise<void>;
  onQueueOfflineMutation: QueueOfflineMutation;
  payrollRuns: PayrollRunWithItems[];
  positions: Position[];
  salaryBonds: SalaryBond[];
  setNotice: (notice: Notice) => void;
  tabs?: ReactNode;
  userId: string;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState(payrollRuns[0]?.id ?? "");
  const selectedRun = payrollRuns.find((run) => run.id === selectedRunId) ?? payrollRuns[0];
  const activeEmployees = employees.filter((employee) => employee.status === "active");
  const existingEmployeeIds = new Set(
    (selectedRun?.items ?? [])
      .map((item) => item.employee_id)
      .filter((id): id is string => Boolean(id)),
  );
  const missingEmployees = selectedRun
    ? activeEmployees.filter((employee) => !existingEmployeeIds.has(employee.id))
    : [];

  useEffect(() => {
    if (!selectedRunId && payrollRuns[0]) {
      setSelectedRunId(payrollRuns[0].id);
    }
  }, [payrollRuns, selectedRunId]);

  useEffect(() => {
    if (selectedRun?.id && selectedRun.items.length === 0) {
      void ensurePayrollRunItems(selectedRun.id);
    }
  }, [selectedRun?.id, selectedRun?.items.length]);

  function createOfflinePayrollItems(payloads: Array<Omit<PayrollRunItem, "id" | "created_at" | "updated_at">>) {
    const now = new Date().toISOString();
    const detailPayloads: Array<Record<string, unknown>> = [];
    const items = payloads.map((payload) => {
      const id = crypto.randomUUID();
      const ticketDetails = payload.ticket_details.map((detail) => {
        const savedDetail = {
          ...detail,
          id: crypto.randomUUID(),
          payroll_run_item_id: id,
          created_at: now,
        };
        detailPayloads.push(savedDetail);
        return savedDetail;
      });
      return { ...payload, id, ticket_details: ticketDetails, created_at: now, updated_at: now } as PayrollRunItem;
    });
    const itemPayloads = items.map(({ ticket_details: _ticketDetails, created_at: _createdAt, updated_at: _updatedAt, ...item }) => item);
    return { detailPayloads, itemPayloads, items };
  }

  async function insertPayrollItems(payloads: Array<Omit<PayrollRunItem, "id" | "created_at" | "updated_at">>) {
    if (!supabase) return { error: null };
    for (const payload of payloads) {
      const { ticket_details: ticketDetails, ...itemPayload } = payload;
      const itemResult = await supabase.from("payroll_run_items").insert(itemPayload).select("id").single();
      if (itemResult.error) return { error: itemResult.error };
      if (ticketDetails.length > 0) {
        const detailResult = await supabase.from("payroll_run_item_ticket_details").insert(
          ticketDetails.map(({ id: _id, created_at: _createdAt, ...detail }) => ({
            ...detail,
            id: crypto.randomUUID(),
            payroll_run_item_id: itemResult.data.id,
          })),
        );
        if (detailResult.error) return { error: detailResult.error };
      }
    }
    return { error: null };
  }

  async function createRun(values: PayrollRunFormValues) {
    if (!supabase) return;
    const activeTeamEmployees = employees.filter((employee) => employee.status === "active");
    if (activeTeamEmployees.length === 0) {
      setNotice({ type: "error", text: "Add at least one active employee first." });
      return;
    }
    const invalidEmployees = activeTeamEmployees.filter((employee) => {
      const position = positions.find((item) => item.id === employee.position_id);
      return !position || position.status !== "active";
    });
    if (invalidEmployees.length > 0) {
      setNotice({ type: "error", text: `Assign an active position to: ${invalidEmployees.map((employee) => employee.full_name).join(", ")}.` });
      return;
    }

    const periodMonth = Number(values.period_month);
    const periodYear = Number(values.period_year);
    const payPeriod = values.pay_period;

    const missingAttendanceEmployees = activeTeamEmployees.filter((emp) => {
      const pos = positions.find((p) => p.id === emp.position_id);
      if (pos?.pay_mode !== "daily") return false;
      const totals = attendanceTotalsForEmployee(attendanceEntries, emp.id, periodMonth, periodYear, payPeriod);
      return totals.presentDays + totals.halfDays + totals.absentDays === 0;
    });

    if (missingAttendanceEmployees.length > 0) {
      setNotice({
        type: "error",
        text: `Attendance not recorded for: ${missingAttendanceEmployees.map((e) => e.full_name).join(", ")}. Please log attendance before generating payroll.`,
      });
      return;
    }

    const runPayload = {
      user_id: userId,
      period_month: Number(values.period_month),
      period_year: Number(values.period_year),
      pay_period: values.pay_period,
      generated_date: values.generated_date,
      notes: values.notes.trim(),
    };
    const existingRun = payrollRuns.find(
      (run) =>
        run.period_month === runPayload.period_month &&
        run.period_year === runPayload.period_year &&
        run.pay_period === runPayload.pay_period,
    );
    if (existingRun) {
      setSelectedRunId(existingRun.id);
      setFormOpen(false);
      setNotice({ type: "success", text: "Payroll for this pay period already exists and is now selected." });
      return;
    }

    if (!navigator.onLine) {
      const offlineRunId = crypto.randomUUID();
      const offlineRun = {
        ...runPayload,
        id: offlineRunId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as PayrollRun;
      const periodDailyEntries = dailyTicketEntriesForPayrollPeriod(
        dailyTicketEntries,
        offlineRun.period_month,
        offlineRun.period_year,
        offlineRun.pay_period,
      );
      const employeePayrollItems = activeTeamEmployees.map((employee) =>
        payrollItemPayloadForEmployeeWithSalaryBonds(
          employee,
          positions.find((position) => position.id === employee.position_id),
          offlineRun.id,
          userId,
          periodDailyEntries,
          salaryBonds,
          offlineRun.generated_date,
          attendanceEntries,
          offlineRun.period_month,
          offlineRun.period_year,
          offlineRun.pay_period,
        ),
      );
      const { detailPayloads, itemPayloads, items: offlineItems } = createOfflinePayrollItems(employeePayrollItems.map((item) => item.payload));
      const salaryBondUpdates = employeePayrollItems
        .flatMap((item) => item.bondDeductions)
        .map(({ amount, bond }) => {
          const balance = Math.max(0, toNumber(bond.balance) - amount);
          return {
            id: bond.id,
            payload: {
              balance,
              status: balance === 0 ? "completed" : bond.status,
            },
          };
        });

      await onQueueOfflineMutation({
        resource: "payrollRuns",
        affectedResources: ["payrollRuns", "payrollHistory", "salaryBonds", "dashboardSummary"],
        operation: "payroll_group",
        table: "payroll_runs",
        payload: {
          runPayload: offlineRun,
          itemPayloads,
          detailPayloads,
          salaryBondUpdates,
        },
      });
      onLocalPayrollRunsChange([
        { ...offlineRun, items: offlineItems },
        ...payrollRuns,
      ]);
      setFormOpen(false);
      setSelectedRunId(offlineRunId);
      return;
    }

    const runResult = await supabase.from("payroll_runs").insert(runPayload).select().single();
    if (runResult.error) {
      if (isOfflineLikeError(runResult.error)) {
        const offlineRunId = crypto.randomUUID();
        const offlineRun = {
          ...runPayload,
          id: offlineRunId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as PayrollRun;
        const periodDailyEntries = dailyTicketEntriesForPayrollPeriod(
          dailyTicketEntries,
          offlineRun.period_month,
          offlineRun.period_year,
          offlineRun.pay_period,
        );
        const employeePayrollItems = activeTeamEmployees.map((employee) =>
          payrollItemPayloadForEmployeeWithSalaryBonds(
            employee,
            positions.find((position) => position.id === employee.position_id),
            offlineRun.id,
            userId,
            periodDailyEntries,
            salaryBonds,
            offlineRun.generated_date,
            attendanceEntries,
            offlineRun.period_month,
            offlineRun.period_year,
            offlineRun.pay_period,
          ),
        );
        const { detailPayloads, itemPayloads, items: offlineItems } = createOfflinePayrollItems(employeePayrollItems.map((item) => item.payload));
        const salaryBondUpdates = employeePayrollItems
          .flatMap((item) => item.bondDeductions)
          .map(({ amount, bond }) => {
            const balance = Math.max(0, toNumber(bond.balance) - amount);
            return {
              id: bond.id,
              payload: {
                balance,
                status: balance === 0 ? "completed" : bond.status,
              },
            };
          });

        await onQueueOfflineMutation({
          resource: "payrollRuns",
          affectedResources: ["payrollRuns", "payrollHistory", "salaryBonds", "dashboardSummary"],
          operation: "payroll_group",
          table: "payroll_runs",
          payload: {
            runPayload: offlineRun,
            itemPayloads,
            detailPayloads,
            salaryBondUpdates,
          },
        });
        onLocalPayrollRunsChange([
          { ...offlineRun, items: offlineItems },
          ...payrollRuns,
        ]);
        setFormOpen(false);
        setSelectedRunId(offlineRunId);
        return;
      }
      const errMsg = `${runResult.error.message ?? ""} ${runResult.error.details ?? ""}`.toLowerCase();
      if (errMsg.includes("duplicate key") || errMsg.includes("payroll_runs_user_id_period")) {
        await onChange();
        const existing = await supabase
          .from("payroll_runs")
          .select("id")
          .eq("period_month", runPayload.period_month)
          .eq("period_year", runPayload.period_year)
          .eq("pay_period", runPayload.pay_period)
          .single();
        if (existing.data) {
          setSelectedRunId(existing.data.id);
          setFormOpen(false);
          setNotice({ type: "success", text: "Payroll for this pay period already exists and has been selected." });
        } else {
          setNotice({ type: "error", text: friendlyError(runResult.error) });
        }
        return;
      }
      setNotice({ type: "error", text: friendlyError(runResult.error) });
      return;
    }

    const newRun = runResult.data as PayrollRun;
    const periodDailyEntries = dailyTicketEntriesForPayrollPeriod(
      dailyTicketEntries,
      newRun.period_month,
      newRun.period_year,
      newRun.pay_period,
    );
    const employeePayrollItems = activeTeamEmployees.map((employee) =>
      payrollItemPayloadForEmployeeWithSalaryBonds(
        employee,
        positions.find((position) => position.id === employee.position_id),
        newRun.id,
        userId,
        periodDailyEntries,
        salaryBonds,
        newRun.generated_date,
        attendanceEntries,
        newRun.period_month,
        newRun.period_year,
        newRun.pay_period,
      ),
    );
    const itemPayloads = employeePayrollItems.map((item) => item.payload);
    const itemResult = await insertPayrollItems(itemPayloads);
    if (itemResult.error) {
      setNotice({ type: "error", text: friendlyError(itemResult.error) });
      return;
    }

    const bondDeductions = employeePayrollItems.flatMap((item) => item.bondDeductions);
    const bondError = await applySalaryBondPayrollDeductions(bondDeductions);
    if (bondError) {
      setNotice({ type: "error", text: friendlyError(bondError) });
      return;
    }

    setNotice({ type: "success", text: "Payroll run generated." });
    setFormOpen(false);
    setSelectedRunId(newRun.id);
    await onChange();
  }

  async function updateItem(item: PayrollRunItem, patch: Partial<PayrollRunItem>) {
    if (!supabase) return;
    const installationTickets = normalizeTicketCount(patch.installation_tickets ?? item.installation_tickets);
    const repairTickets = normalizeTicketCount(patch.repair_tickets ?? item.repair_tickets);
    const installationRate = toNumber(patch.installation_rate ?? item.installation_rate);
    const repairRate = toNumber(patch.repair_rate ?? item.repair_rate);
    const allowances = toNumber(patch.allowances ?? item.allowances);
    const deductions = toNumber(patch.deductions ?? item.deductions);
    const ticketFieldsChanged = patch.installation_tickets !== undefined || patch.repair_tickets !== undefined ||
      patch.installation_rate !== undefined || patch.repair_rate !== undefined;
    const ticketPay = ticketFieldsChanged
      ? ticketGrossPay(installationTickets, repairTickets, installationRate, repairRate)
      : toNumber(item.ticket_pay);
    const basePay = toNumber(item.base_pay);
    const gross = basePay + ticketPay;
    const payload = {
      ...patch,
      installation_tickets: installationTickets,
      repair_tickets: repairTickets,
      installation_rate: installationRate,
      repair_rate: repairRate,
      base_pay: basePay,
      ticket_pay: ticketPay,
      gross_pay: gross,
      net_pay: netPay(gross, allowances, deductions),
    };
    if (!navigator.onLine) {
      onLocalPayrollRunsChange(payrollRuns.map((run) => ({
        ...run,
        items: run.items.map((runItem) => runItem.id === item.id ? { ...runItem, ...payload } : runItem),
      })));
      await onQueueOfflineMutation({
        resource: "payrollRuns",
        affectedResources: ["payrollRuns", "payrollHistory", "dashboardSummary"],
        operation: "update",
        table: "payroll_run_items",
        recordId: item.id,
        payload,
      });
      return;
    }
    const { error } = await supabase.from("payroll_run_items").update(payload).eq("id", item.id);
    if (error && isOfflineLikeError(error)) {
      onLocalPayrollRunsChange(payrollRuns.map((run) => ({
        ...run,
        items: run.items.map((runItem) => runItem.id === item.id ? { ...runItem, ...payload } : runItem),
      })));
      await onQueueOfflineMutation({
        resource: "payrollRuns",
        affectedResources: ["payrollRuns", "payrollHistory", "dashboardSummary"],
        operation: "update",
        table: "payroll_run_items",
        recordId: item.id,
        payload,
      });
      return;
    }
    setNotice(error ? { type: "error", text: friendlyError(error) } : { type: "success", text: "Payroll item updated." });
    await onChange();
  }

  async function addMissingEmployees() {
    if (!supabase || !selectedRun || missingEmployees.length === 0) return;

    const periodDailyEntries = dailyTicketEntriesForPayrollPeriod(
      dailyTicketEntries,
      selectedRun.period_month,
      selectedRun.period_year,
      selectedRun.pay_period,
    );
    const employeePayrollItems = missingEmployees.map((employee) =>
      payrollItemPayloadForEmployeeWithSalaryBonds(
        employee,
        positions.find((position) => position.id === employee.position_id),
        selectedRun.id,
        userId,
        periodDailyEntries,
        salaryBonds,
        selectedRun.generated_date,
        attendanceEntries,
        selectedRun.period_month,
        selectedRun.period_year,
        selectedRun.pay_period,
      ),
    );
    const itemPayloads = employeePayrollItems.map((item) => item.payload);
    if (!navigator.onLine) {
      const { detailPayloads, itemPayloads: offlineItemPayloads, items: offlineItems } = createOfflinePayrollItems(itemPayloads);
      onLocalPayrollRunsChange(payrollRuns.map((run) =>
        run.id === selectedRun.id ? { ...run, items: [...run.items, ...offlineItems] } : run,
      ));
      await onQueueOfflineMutation({
        resource: "payrollRuns",
        affectedResources: ["payrollRuns", "payrollHistory", "salaryBonds", "dashboardSummary"],
        operation: "payroll_items_group",
        table: "payroll_run_items",
        payload: { itemPayloads: offlineItemPayloads, detailPayloads },
      });
      return;
    }
    const { error } = await insertPayrollItems(itemPayloads);
    if (error) {
      if (isOfflineLikeError(error)) {
        const { detailPayloads, itemPayloads: offlineItemPayloads, items: offlineItems } = createOfflinePayrollItems(itemPayloads);
        onLocalPayrollRunsChange(payrollRuns.map((run) =>
          run.id === selectedRun.id ? { ...run, items: [...run.items, ...offlineItems] } : run,
        ));
        await onQueueOfflineMutation({
          resource: "payrollRuns",
          affectedResources: ["payrollRuns", "payrollHistory", "salaryBonds", "dashboardSummary"],
          operation: "payroll_items_group",
          table: "payroll_run_items",
          payload: { itemPayloads: offlineItemPayloads, detailPayloads },
        });
        return;
      }
      setNotice({ type: "error", text: friendlyError(error) });
      return;
    }

    const bondDeductions = employeePayrollItems.flatMap((item) => item.bondDeductions);
    const bondError = await applySalaryBondPayrollDeductions(bondDeductions);
    if (bondError) {
      setNotice({ type: "error", text: friendlyError(bondError) });
      return;
    }

    setNotice({
      type: "success",
      text: `${missingEmployees.length} employee${missingEmployees.length === 1 ? "" : "s"} added to payroll.`,
    });
    await onChange();
  }

  const allItems = selectedRun?.items ?? [];
  const pendingItems = allItems.filter((item) => item.status !== "paid");
  const paidItems = allItems.filter((item) => item.status === "paid");
  const allTotals = allItems.reduce(
    (sum, item) => ({ gross: sum.gross + toNumber(item.gross_pay), net: sum.net + toNumber(item.net_pay) }),
    { gross: 0, net: 0 },
  );
  const pendingTotals = pendingItems.reduce(
    (sum, item) => ({ net: sum.net + toNumber(item.net_pay) }),
    { net: 0 },
  );
  const paidTotals = paidItems.reduce(
    (sum, item) => ({ net: sum.net + toNumber(item.net_pay) }),
    { net: 0 },
  );

  return (
    <div className="page-stack">
      <PageHeader
        action={(
          <button className="primary-button compact" onClick={() => setFormOpen(true)} type="button">
            <Plus size={16} />
            Generate payroll
          </button>
        )}
        eyebrow="Pay-period runs"
        text="Generate first-half or second-half payroll for all active employees."
        title="Payroll"
      />

      {selectedRun && (
        <section className="payroll-metrics">
          <div className="payroll-metric">
            <div className="payroll-metric-icon neutral"><Users size={18} /></div>
            <div className="payroll-metric-text"><span>Employees</span><strong>{allItems.length}</strong></div>
          </div>
          <div className="payroll-metric">
            <div className="payroll-metric-icon neutral"><BadgeDollarSign size={18} /></div>
            <div className="payroll-metric-text"><span>Total Gross</span><strong>{currency.format(allTotals.gross)}</strong></div>
          </div>
          <div className="payroll-metric warning">
            <div className="payroll-metric-icon warning"><CalendarClock size={18} /></div>
            <div className="payroll-metric-text"><span>Unpaid</span><strong>{currency.format(pendingTotals.net)}</strong></div>
          </div>
          <div className="payroll-metric success">
            <div className="payroll-metric-icon success"><CheckCircle2 size={18} /></div>
            <div className="payroll-metric-text"><span>Paid</span><strong>{currency.format(paidTotals.net)}</strong></div>
          </div>
        </section>
      )}

      {tabs}

      {selectedRun && missingEmployees.length > 0 && (
        <div className="payroll-missing-banner">
          <span>⚠ {missingEmployees.length} active employee{missingEmployees.length !== 1 ? "s" : ""} not in this run</span>
          <button className="secondary-button compact" onClick={addMissingEmployees} type="button">
            <Plus size={14} /> Add missing
          </button>
        </div>
      )}

      {selectedRun ? (
        <PayrollItemsTable employees={employees} items={allItems} onUpdate={updateItem} />
      ) : (
        <div className="panel">
          <p className="muted">No payroll has been generated yet.</p>
        </div>
      )}

      {formOpen && (
        <PayrollRunForm onClose={() => setFormOpen(false)} onSubmit={createRun} />
      )}
    </div>
  );
}

function PayrollItemsTable({
  employees,
  items,
  onUpdate,
}: {
  employees: Employee[];
  items: PayrollRunItem[];
  onUpdate: (item: PayrollRunItem, patch: Partial<PayrollRunItem>) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "paid">("pending");

  const visibleItems = items
    .filter((i) => statusFilter === "all" || i.status === statusFilter)
    .filter((i) => `${i.employee_name} ${i.position_name}`.toLowerCase().includes(query.toLowerCase()));

  const employeeCodeMap = useMemo(() => {
    const sorted = [...employees].sort((a, b) => a.created_at.localeCompare(b.created_at));
    return new Map(sorted.map((e, i) => [e.id, `EMP-${String(i + 1).padStart(3, "0")}`]));
  }, [employees]);
  const empCode = (id: string | null) => (id ? employeeCodeMap.get(id) ?? "—" : "—");

  function payBasis(item: PayrollRunItem): string {
    if (item.pay_mode === "daily") {
      return `${toNumber(item.days_worked)} days × ${currency.format(toNumber(item.daily_rate))}`;
    }
    if (item.pay_mode === "fixed") {
      return `Base ${currency.format(toNumber(item.base_pay))}`;
    }
    const ticketCount = item.ticket_details && item.ticket_details.length > 0
      ? item.ticket_details.reduce((sum, d) => sum + (d.ticket_count ?? 0), 0)
      : toNumber(item.installation_tickets) + toNumber(item.repair_tickets);
    if (item.pay_mode === "ticket") return `${ticketCount} tickets`;
    if (item.pay_mode === "hybrid") return `Base ${currency.format(toNumber(item.base_pay))} + ${ticketCount} tickets`;
    return "—";
  }

  return (
    <div className="page-stack" style={{ gap: 8 }}>
      <div className="toolbar">
        <label className="search-box">
          <Search size={17} />
          <input
            placeholder="Search employees…"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
          <option value="all">All status</option>
          <option value="pending">Pending</option>
          <option value="paid">Paid</option>
        </select>
      </div>

      <DataTable
        empty="No payroll items match the current filter."
        headers={["No.", "Employee ID", "Employee", "Pay Basis", "Gross", "Deductions", "Net", "Status", "Actions"]}
        rows={visibleItems.map((item, index) => [
          index + 1,
          empCode(item.employee_id ?? null),
          <div key="employee" className="employee-list-identity">
            <EmpAvatar employees={employees} employeeId={item.employee_id ?? null} employeeName={item.employee_name} />
            <RecordTitle title={item.employee_name} notes={employees.find((e) => e.id === item.employee_id)?.email || "No email"} />
          </div>,
          <div key="basis" className="payroll-basis-cell">
            <span>{payBasis(item)}</span>
            {item.notes && <small>{item.notes}</small>}
          </div>,
          currency.format(toNumber(item.gross_pay)),
          toNumber(item.deductions) > 0 ? currency.format(toNumber(item.deductions)) : "—",
          <div key="net" className="payroll-net-cell">
            <strong>{currency.format(toNumber(item.net_pay))}</strong>
            {toNumber(item.allowances) > 0 && (
              <span className="payroll-net-allowance">+{currency.format(toNumber(item.allowances))} allowance</span>
            )}
          </div>,
          <span key="status" className={item.status === "paid" ? "emp-status-pill active" : "emp-status-pill inactive"}>
            {item.status === "paid" ? "Paid" : "Pending"}
          </span>,
          <div className="row-actions" key="actions">
            {item.status !== "paid" ? (
              <button aria-label="Mark paid" onClick={() => onUpdate(item, { status: "paid", paid_date: todayKey() })} title="Mark paid" type="button">
                <CheckCircle2 size={16} />
              </button>
            ) : (
              <button aria-label="Mark pending" onClick={() => onUpdate(item, { status: "pending", paid_date: null })} title="Mark pending" type="button">
                <CalendarClock size={16} />
              </button>
            )}
          </div>,
        ])}
      />
    </div>
  );
}

export function PayrollHistoryFeature({ employees, rows, tabs }: { employees: Employee[]; rows: PayrollHistoryRow[]; tabs?: ReactNode }) {
  const [query, setQuery] = useState("");
  const [collapsedPeriods, setCollapsedPeriods] = useState<Set<string>>(new Set());

  const employeeCodeMap = useMemo(() => {
    const sorted = [...employees].sort((a, b) => a.created_at.localeCompare(b.created_at));
    return new Map(sorted.map((e, i) => [e.id, `EMP-${String(i + 1).padStart(3, "0")}`]));
  }, [employees]);
  const empCode = (id: string | null) => (id ? employeeCodeMap.get(id) ?? "—" : "—");

  const filteredRows = rows.filter((row) => row.searchText.includes(query.toLowerCase()));

  // Group by payPeriod, preserving the order they appear (already sorted newest-first)
  const groups: Array<{ period: string; rows: PayrollHistoryRow[] }> = [];
  const seen = new Map<string, PayrollHistoryRow[]>();
  for (const row of filteredRows) {
    if (!seen.has(row.payPeriod)) {
      seen.set(row.payPeriod, []);
      groups.push({ period: row.payPeriod, rows: seen.get(row.payPeriod)! });
    }
    seen.get(row.payPeriod)!.push(row);
  }

  function togglePeriod(period: string) {
    setCollapsedPeriods((prev) => {
      const next = new Set(prev);
      if (next.has(period)) next.delete(period); else next.add(period);
      return next;
    });
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Payroll records"
        text="Review every employee payroll record by pay period."
        title="Payroll History"
      />
      {tabs}
      <Toolbar query={query} setQuery={setQuery} />
      {rows.length === 0 ? (
        <div className="panel"><p className="muted">No paid payroll history yet.</p></div>
      ) : filteredRows.length === 0 ? (
        <div className="panel"><p className="muted">No records match your search.</p></div>
      ) : (
        groups.map(({ period, rows: groupRows }) => {
          const collapsed = collapsedPeriods.has(period);
          const gross = groupRows.reduce((s, r) => s + r.grossPay, 0);
          const net = groupRows.reduce((s, r) => s + r.netPay, 0);
          return (
            <section key={period} className="ph-group">
              <button className="ph-group-header" type="button" onClick={() => togglePeriod(period)}>
                <div className="ph-group-title">
                  <ChevronDown size={15} className={collapsed ? "ph-chevron collapsed" : "ph-chevron"} />
                  <strong>{period}</strong>
                  <span className="ph-group-count">{groupRows.length} employee{groupRows.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="ph-group-totals">
                  <span>Gross <strong>{currency.format(gross)}</strong></span>
                  <span>Net <strong>{currency.format(net)}</strong></span>
                </div>
              </button>
              {!collapsed && (
                <div className="table-wrap">
                  <table className="ph-table">
                    <thead>
                      <tr>
                        <th>Payroll No.</th>
                        <th>Employee ID</th>
                        <th>Employee</th>
                        <th>Department</th>
                        <th>Gross Pay</th>
                        <th>Deductions</th>
                        <th>Net Pay</th>
                        <th>Date Processed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupRows.map((row) => (
                        <tr key={row.payrollNo}>
                          <td className="ph-no">{row.payrollNo}</td>
                          <td>{empCode(row.employeeId)}</td>
                          <td>
                            <div className="employee-list-identity">
                              <EmpAvatar employees={employees} employeeId={row.employeeId} employeeName={row.employeeName} />
                              <RecordTitle title={row.employeeName} notes={employees.find((e) => e.id === row.employeeId)?.email || "No email"} />
                            </div>
                          </td>
                          <td>{row.department}</td>
                          <td>{currency.format(row.grossPay)}</td>
                          <td>{row.deductions > 0 ? currency.format(row.deductions) : "—"}</td>
                          <td><strong>{currency.format(row.netPay)}</strong></td>
                          <td>{row.processedDate}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}

function PayrollRunForm({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (values: PayrollRunFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<PayrollRunFormValues>(emptyPayrollRun);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    await onSubmit(values);
    setBusy(false);
  }

  return (
    <Modal onClose={onClose} title="Generate payroll">
      <form className="form-grid" onSubmit={handleSubmit}>
        <label>
          Payroll month
          <select value={values.period_month} onChange={(event) => setValues({ ...values, period_month: event.target.value })}>
            {monthNames.map((month, index) => (
              <option key={month} value={index + 1}>
                {month}
              </option>
            ))}
          </select>
        </label>
        <TextField label="Payroll year" max="2200" min="1900" onChange={(period_year) => setValues({ ...values, period_year })} required type="number" value={values.period_year} />
        <label>
          Pay period
          <select value={values.pay_period} onChange={(event) => setValues({ ...values, pay_period: event.target.value as PayrollRunFormValues["pay_period"] })}>
            <option value="first_half">First half</option>
            <option value="second_half">Second half</option>
          </select>
        </label>
        <TextField label="Generated date" onChange={(generated_date) => setValues({ ...values, generated_date })} required type="date" value={values.generated_date} />
        <label className="full">
          Notes
          <textarea rows={3} value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} />
        </label>
        <FormActions busy={busy} onClose={onClose} />
      </form>
    </Modal>
  );
}
