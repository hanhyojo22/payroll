import { useState, type FormEvent } from "react";
import { ChevronDown, CreditCard, Save } from "lucide-react";
import { isOfflineLikeError } from "../../lib/offlineSync";
import { supabase } from "../../supabase";
import { MoneyField } from "../../shared/components/MoneyField";
import { PageHeader } from "../../shared/components/PageLayout";
import { StatusBadge } from "../../shared/components/StatusBadge";
import type { Notice, QueueOfflineMutation } from "../../shared/types";
import { currency, toNumber } from "../../shared/utils/currency";
import { todayKey } from "../../shared/utils/dates";
import { friendlyError } from "../../shared/utils/errors";
import type { Employee, SalaryBondFormValues } from "../../types";

const emptySalaryBond: SalaryBondFormValues = {
  employee_id: "",
  bond_type: "Salary Advance",
  date_granted: todayKey(),
  start_deduction: todayKey(),
  purpose: "",
  amount: "",
  balance: "",
  deduction_per_payroll: "",
  status: "active",
  notes: "",
};

export function SalaryBondsFeature({
  employees,
  onChange,
  onQueueOfflineMutation,
  setNotice,
  userId,
}: {
  employees: Employee[];
  onChange: () => Promise<void>;
  onQueueOfflineMutation: QueueOfflineMutation;
  setNotice: (notice: Notice) => void;
  userId: string;
}) {
  const [bondForm, setBondForm] = useState<SalaryBondFormValues>(emptySalaryBond);
  const selectedEmployee = employees.find((item) => item.id === bondForm.employee_id);
  const amount = toNumber(bondForm.amount);
  const deductionPerPayroll = toNumber(bondForm.deduction_per_payroll);
  const estimatedDeductions = deductionPerPayroll > 0 ? Math.ceil(amount / deductionPerPayroll) : 0;
  const remainingAfterPayoff = Math.max(0, amount - estimatedDeductions * deductionPerPayroll);
  const estimatedPayoffDate = (() => {
    if (!bondForm.start_deduction || estimatedDeductions === 0) return "Not available";
    const date = new Date(`${bondForm.start_deduction}T00:00:00`);
    date.setDate(date.getDate() + Math.max(0, estimatedDeductions - 1) * 15);
    return date.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
  })();
  const displayDateGranted = bondForm.date_granted
    ? new Date(`${bondForm.date_granted}T00:00:00`).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })
    : "Not set";
  const displayStartDeduction = bondForm.start_deduction
    ? new Date(`${bondForm.start_deduction}T00:00:00`).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })
    : "Not set";

  async function saveSalaryBond(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    if (!selectedEmployee) {
      setNotice({ type: "error", text: "Select an employee for the salary bond." });
      return;
    }

    const balance = bondForm.balance ? toNumber(bondForm.balance) : amount;
    const generatedBondId = `SB-${Date.now().toString(36).toUpperCase()}`;
    const payload = {
      user_id: userId,
      employee_id: selectedEmployee.id,
      employee_name: selectedEmployee.full_name,
      bond_id: generatedBondId,
      bond_type: bondForm.bond_type,
      date_granted: bondForm.date_granted,
      start_deduction: bondForm.start_deduction,
      purpose: bondForm.purpose.trim(),
      amount,
      balance,
      deduction_per_payroll: deductionPerPayroll,
      status: bondForm.status,
      notes: bondForm.notes.trim(),
    };
    if (!navigator.onLine) {
      await onQueueOfflineMutation({
        resource: "salaryBonds",
        affectedResources: ["salaryBonds", "dashboardSummary"],
        operation: "insert",
        table: "salary_bonds",
        payload,
      });
      setBondForm(emptySalaryBond);
      await onChange();
      return;
    }

    const result = await supabase.from("salary_bonds").insert(payload);

    if (result.error) {
      if (isOfflineLikeError(result.error)) {
        await onQueueOfflineMutation({
          resource: "salaryBonds",
          affectedResources: ["salaryBonds", "dashboardSummary"],
          operation: "insert",
          table: "salary_bonds",
          payload,
        });
        setBondForm(emptySalaryBond);
        await onChange();
        return;
      }
      setNotice({ type: "error", text: friendlyError(result.error) });
      return;
    }

    setBondForm(emptySalaryBond);
    setNotice({ type: "success", text: "Salary bond saved." });
    await onChange();
  }

  return (
    <div className="salary-bond-create-page">
      <div className="salary-bond-breadcrumb">
        <span>Salary Bonds</span>
        <ChevronDown size={14} />
        <strong>New Salary Bond</strong>
      </div>
      <PageHeader
        eyebrow=""
        text="Create a salary bond or advance for an employee."
        title="Add Salary Bond"
      />

      <div className="salary-bond-create-layout">
        <section className="salary-bond-create-card">
          <form className="salary-bond-create-form" onSubmit={saveSalaryBond}>
            <label>
              Employee <span>*</span>
              <select
                required
                value={bondForm.employee_id}
                onChange={(event) => setBondForm({ ...bondForm, employee_id: event.target.value })}
              >
                <option value="">Search Employee</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>{employee.full_name}</option>
                ))}
              </select>
            </label>
            <label>
              Bond Type <span>*</span>
              <select value={bondForm.bond_type} onChange={(event) => setBondForm({ ...bondForm, bond_type: event.target.value })}>
                <option value="Salary Advance">Salary Advance</option>
                <option value="Cash Advance">Cash Advance</option>
                <option value="Emergency Loan">Emergency Loan</option>
                <option value="Equipment Bond">Equipment Bond</option>
                <option value="Other">Other</option>
              </select>
            </label>

            {selectedEmployee && (
              <div className="salary-bond-selected-employee">
                <div className="avatar">{selectedEmployee.full_name.slice(0, 1).toUpperCase()}</div>
                <div>
                  <strong>{selectedEmployee.full_name}</strong>
                  <span>EMP-{selectedEmployee.created_at?.slice(0, 4) || "2024"}-0001 - {selectedEmployee.role || "Employee"}</span>
                </div>
                <button aria-label="Clear employee" onClick={() => setBondForm({ ...bondForm, employee_id: "" })} type="button">
                  x
                </button>
              </div>
            )}

            <label>
              Date Granted <span>*</span>
              <input required type="date" value={bondForm.date_granted} onChange={(event) => setBondForm({ ...bondForm, date_granted: event.target.value })} />
            </label>
            <MoneyField label="Amount *" onChange={(amountValue) => setBondForm({ ...bondForm, amount: amountValue, balance: amountValue })} required value={bondForm.amount} />
            <MoneyField label="Deduction Per Payroll *" onChange={(deduction_per_payroll) => setBondForm({ ...bondForm, deduction_per_payroll })} required value={bondForm.deduction_per_payroll} />
            <label>
              Start Deduction <span>*</span>
              <input required type="date" value={bondForm.start_deduction} onChange={(event) => setBondForm({ ...bondForm, start_deduction: event.target.value })} />
              <small>The deduction will start on this date.</small>
            </label>
            <label className="salary-bond-form-wide">
              Purpose
              <input value={bondForm.purpose} onChange={(event) => setBondForm({ ...bondForm, purpose: event.target.value })} />
            </label>
            <label className="salary-bond-form-wide">
              Notes <small>(Optional)</small>
              <textarea placeholder="Enter any additional notes..." value={bondForm.notes} onChange={(event) => setBondForm({ ...bondForm, notes: event.target.value })} />
              <small>Optional notes about this bond.</small>
            </label>
            <div className="salary-bond-form-actions">
              <button className="secondary-button compact" onClick={() => setBondForm(emptySalaryBond)} type="button">
                Cancel
              </button>
              <button className="primary-button compact" type="submit">
                <Save size={16} />
                Save Bond
              </button>
            </div>
          </form>
        </section>

        <aside className="salary-bond-summary-card">
          <h2>Bond Summary</h2>
          <div className="salary-bond-active-banner">
            <CreditCard size={22} />
            <span>This bond will be active once saved.</span>
            <StatusBadge status="active" />
          </div>
          <div className="salary-bond-summary-list">
            <div><span>Employee</span><strong>{selectedEmployee?.full_name || "Not selected"}</strong></div>
            <div><span>Bond Type</span><strong>{bondForm.bond_type}</strong></div>
            <div><span>Date Granted</span><strong>{displayDateGranted}</strong></div>
            <div><span>Amount Granted</span><strong>{currency.format(amount)}</strong></div>
            <div><span>Deduction Per Payroll</span><strong>{currency.format(deductionPerPayroll)}</strong></div>
            <div><span>Start Deduction</span><strong>{displayStartDeduction}</strong></div>
          </div>
          <div className="salary-bond-estimate-card">
            <strong>Estimated Summary</strong>
            <div><span>Estimated Number of Deductions</span><b>{estimatedDeductions} payroll(s)</b></div>
            <div><span>Estimated Payoff Date</span><b>{estimatedPayoffDate}</b></div>
            <div><span>Total Deduction</span><b>{currency.format(estimatedDeductions * deductionPerPayroll)}</b></div>
            <div><span>Remaining Balance After Payoff</span><b>{currency.format(remainingAfterPayoff)}</b></div>
          </div>
          <div className="salary-bond-warning">
            The actual payoff date may vary depending on the payroll schedule and any additional payments.
          </div>
        </aside>
      </div>
    </div>
  );
}
