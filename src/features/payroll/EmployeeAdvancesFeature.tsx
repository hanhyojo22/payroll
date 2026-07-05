import { useState, type FormEvent } from "react";
import { CreditCard, Pencil, Save, X } from "lucide-react";
import { isOfflineLikeError } from "../../lib/offlineSync";
import { supabase } from "../../supabase";
import { DataTable } from "../../shared/components/DataTable";
import { MoneyField } from "../../shared/components/MoneyField";
import { StatusBadge } from "../../shared/components/StatusBadge";
import type { QueueOfflineMutation } from "../../shared/types";
import { NotificationService } from "../../shared/notifications/NotificationService";
import { currency, toNumber } from "../../shared/utils/currency";
import { todayKey } from "../../shared/utils/dates";
import { friendlyError } from "../../shared/utils/errors";
import type { Employee, EmployeeAdvance, EmployeeAdvanceFormValues, EmployeeAdvanceType } from "../../types";

const advanceTypeOptions: EmployeeAdvanceType[] = [
  "Cash Advance",
  "Salary Bond",
  "Salary Loan",
  "Company Loan",
  "Other Loan",
];

const emptyEmployeeAdvance = (employeeId: string): EmployeeAdvanceFormValues => ({
  employee_id: employeeId,
  advance_type: "Salary Bond",
  date_granted: todayKey(),
  start_deduction: todayKey(),
  purpose: "",
  amount: "",
  balance: "",
  deduction_per_payroll: "",
  status: "active",
  notes: "",
});

const valuesFromEmployeeAdvance = (advance: EmployeeAdvance): EmployeeAdvanceFormValues => ({
  employee_id: advance.employee_id ?? "",
  advance_type: advance.advance_type,
  date_granted: advance.date_granted,
  start_deduction: advance.start_deduction,
  purpose: advance.purpose,
  amount: String(advance.amount),
  balance: String(advance.balance),
  deduction_per_payroll: String(advance.deduction_per_payroll),
  status: advance.status,
  notes: advance.notes,
});

export function EmployeeAdvancesFeature({
  employee,
  employeeAdvances,
  onChange,
  onQueueOfflineMutation,
  userId,
}: {
  employee: Employee;
  employeeAdvances: EmployeeAdvance[];
  onChange: () => Promise<void>;
  onQueueOfflineMutation: QueueOfflineMutation;
  userId: string;
}) {
  const [advanceForm, setAdvanceForm] = useState<EmployeeAdvanceFormValues>(() => emptyEmployeeAdvance(employee.id));
  const [editingAdvance, setEditingAdvance] = useState<EmployeeAdvance | null>(null);
  const amount = toNumber(advanceForm.amount);
  const deductionPerPayroll = toNumber(advanceForm.deduction_per_payroll);
  const estimatedDeductions = deductionPerPayroll > 0 ? Math.ceil(amount / deductionPerPayroll) : 0;
  const remainingAfterPayoff = Math.max(0, amount - estimatedDeductions * deductionPerPayroll);
  const employeeScopedAdvances = employeeAdvances
    .filter((item) => item.employee_id === employee.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  async function saveEmployeeAdvance(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;

    const balance = advanceForm.balance ? toNumber(advanceForm.balance) : amount;
    const generatedAdvanceId = `EA-${Date.now().toString(36).toUpperCase()}`;
    const payload = {
      user_id: userId,
      employee_id: employee.id,
      employee_name: employee.full_name,
      advance_id: editingAdvance?.advance_id ?? generatedAdvanceId,
      advance_type: advanceForm.advance_type,
      date_granted: advanceForm.date_granted,
      start_deduction: advanceForm.start_deduction,
      purpose: advanceForm.purpose.trim(),
      amount,
      balance,
      deduction_per_payroll: deductionPerPayroll,
      status: advanceForm.status,
      notes: advanceForm.notes.trim(),
    };
    const operation = editingAdvance ? "update" : "insert";

    if (!navigator.onLine) {
      await onQueueOfflineMutation({
        resource: "employeeAdvances",
        affectedResources: ["employeeAdvances", "dashboardSummary"],
        operation,
        table: "employee_advances",
        recordId: editingAdvance?.id,
        payload,
      });
      setEditingAdvance(null);
      setAdvanceForm(emptyEmployeeAdvance(employee.id));
      await onChange();
      return;
    }

    const result = editingAdvance
      ? await supabase.from("employee_advances").update(payload).eq("id", editingAdvance.id)
      : await supabase.from("employee_advances").insert(payload);
    if (result.error) {
      if (isOfflineLikeError(result.error)) {
        await onQueueOfflineMutation({
          resource: "employeeAdvances",
          affectedResources: ["employeeAdvances", "dashboardSummary"],
          operation,
          table: "employee_advances",
          recordId: editingAdvance?.id,
          payload,
        });
        setEditingAdvance(null);
        setAdvanceForm(emptyEmployeeAdvance(employee.id));
        await onChange();
        return;
      }
      NotificationService.showError(friendlyError(result.error));
      return;
    }

    setEditingAdvance(null);
    setAdvanceForm(emptyEmployeeAdvance(employee.id));
    NotificationService.showSuccess(editingAdvance ? "Employee advance updated." : "Employee advance saved.");
    await onChange();
  }

  function editEmployeeAdvance(advance: EmployeeAdvance) {
    setEditingAdvance(advance);
    setAdvanceForm(valuesFromEmployeeAdvance(advance));
  }

  function clearEmployeeAdvanceForm() {
    setEditingAdvance(null);
    setAdvanceForm(emptyEmployeeAdvance(employee.id));
  }

  return (
    <section className="emp-content-card history-stack">
      <div className="ticket-section-heading">
        <div>
          <h3>Employee Advances</h3>
          <p>Track cash advances, salary bonds, loans, balances, and payroll deductions.</p>
        </div>
      </div>

      <div className="employee-advance-layout">
        <section className="employee-advance-card">
          <form className="employee-advance-form" onSubmit={saveEmployeeAdvance}>
            <div className="employee-advance-selected-employee">
              <div className="avatar">{employee.full_name.slice(0, 1).toUpperCase()}</div>
              <div>
                <strong>{employee.full_name}</strong>
                <span>{employee.role || "Employee"} | {employee.department || "Unassigned department"}</span>
              </div>
              {editingAdvance && (
                <button aria-label="Cancel editing advance" onClick={clearEmployeeAdvanceForm} title="Cancel editing" type="button">
                  <X size={15} />
                </button>
              )}
            </div>

            <label>
              Advance Type <span>*</span>
              <select value={advanceForm.advance_type} onChange={(event) => setAdvanceForm({ ...advanceForm, advance_type: event.target.value as EmployeeAdvanceType })}>
                {advanceTypeOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <label>
              Date Granted <span>*</span>
              <input required type="date" value={advanceForm.date_granted} onChange={(event) => setAdvanceForm({ ...advanceForm, date_granted: event.target.value })} />
            </label>
            <MoneyField label="Amount *" onChange={(amountValue) => setAdvanceForm({ ...advanceForm, amount: amountValue, balance: amountValue })} required value={advanceForm.amount} />
            <MoneyField label="Deduction Per Payroll *" onChange={(value) => setAdvanceForm({ ...advanceForm, deduction_per_payroll: value })} required value={advanceForm.deduction_per_payroll} />
            <label>
              Start Deduction <span>*</span>
              <input required type="date" value={advanceForm.start_deduction} onChange={(event) => setAdvanceForm({ ...advanceForm, start_deduction: event.target.value })} />
              <small>The deduction will begin on this date.</small>
            </label>
            <label className="employee-advance-form-wide">
              Purpose
              <input value={advanceForm.purpose} onChange={(event) => setAdvanceForm({ ...advanceForm, purpose: event.target.value })} />
            </label>
            <label className="employee-advance-form-wide">
              Notes <small>(Optional)</small>
              <textarea placeholder="Enter any additional notes..." value={advanceForm.notes} onChange={(event) => setAdvanceForm({ ...advanceForm, notes: event.target.value })} />
            </label>
            <div className="employee-advance-form-actions">
              <button className="secondary-button compact" onClick={clearEmployeeAdvanceForm} type="button">
                {editingAdvance ? "Cancel" : "Clear"}
              </button>
              <button className="primary-button compact" type="submit">
                <Save size={16} />
                {editingAdvance ? "Update Advance" : "Save Advance"}
              </button>
            </div>
          </form>
        </section>

        <aside className="employee-advance-summary-card">
          <h2>Advance Summary</h2>
          <div className="employee-advance-active-banner">
            <CreditCard size={22} />
            <span>This advance will be active once saved.</span>
            <StatusBadge status="active" />
          </div>
          <div className="employee-advance-summary-list">
            <div><span>Employee</span><strong>{employee.full_name}</strong></div>
            <div><span>Advance Type</span><strong>{advanceForm.advance_type}</strong></div>
            <div><span>Amount Granted</span><strong>{currency.format(amount)}</strong></div>
            <div><span>Deduction Per Payroll</span><strong>{currency.format(deductionPerPayroll)}</strong></div>
            <div><span>Outstanding Balance</span><strong>{currency.format(toNumber(advanceForm.balance) || amount)}</strong></div>
          </div>
          <div className="employee-advance-estimate-card">
            <strong>Estimated Summary</strong>
            <div><span>Estimated Number of Deductions</span><b>{estimatedDeductions} payroll(s)</b></div>
            <div><span>Total Deduction</span><b>{currency.format(estimatedDeductions * deductionPerPayroll)}</b></div>
            <div><span>Remaining Balance After Payoff</span><b>{currency.format(remainingAfterPayoff)}</b></div>
          </div>
          <div className="employee-advance-warning">
            Automated payroll deductions apply to all employee advance types when active and due.
          </div>
        </aside>
      </div>

      <DataTable
        empty="No employee advances for this employee yet."
        headers={["Reference", "Type", "Purpose", "Amount", "Balance", "Deduction/Payroll", "Status", "Actions"]}
        rows={employeeScopedAdvances.map((advance) => [
          advance.advance_id,
          advance.advance_type,
          advance.purpose || advance.advance_type,
          currency.format(toNumber(advance.amount)),
          currency.format(toNumber(advance.balance)),
          currency.format(toNumber(advance.deduction_per_payroll)),
          <StatusBadge key="status" status={advance.status} />,
          <div className="row-actions" key="actions">
            <button aria-label="Edit advance" onClick={() => editEmployeeAdvance(advance)} title="Edit advance" type="button">
              <Pencil size={14} />
            </button>
          </div>,
        ])}
      />
    </section>
  );
}
