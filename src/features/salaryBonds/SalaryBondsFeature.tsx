import { useState, type FormEvent } from "react";
import { useDialog } from "../../shared/components/useDialog";
import { Archive, History, Pencil, Plus, RotateCcw, Wallet, X } from "lucide-react";
import { validateSalaryBondWithdrawal } from "../../domain/salaryBonds";
import { isOfflineLikeError } from "../../lib/offlineSync";
import { supabase } from "../../supabase";
import { DataTable } from "../../shared/components/DataTable";
import { Modal } from "../../shared/components/FormLayout";
import { MoneyField } from "../../shared/components/MoneyField";
import { PageHeader } from "../../shared/components/PageLayout";
import { StatusBadge } from "../../shared/components/StatusBadge";
import type { QueueOfflineMutation } from "../../shared/types";
import { NotificationService } from "../../shared/notifications/NotificationService";
import { currency, toNumber } from "../../shared/utils/currency";
import { todayKey } from "../../shared/utils/dates";
import { friendlyError } from "../../shared/utils/errors";
import type {
  Employee,
  SalaryBond,
  SalaryBondFormValues,
  SalaryBondWithdrawalFormValues,
} from "../../types";
import {
  archiveSalaryBond,
  reactivateSalaryBond,
  recordSalaryBondWithdrawal,
  saveSalaryBond,
} from "./salaryBondRepository";

const emptyBondForm = (employeeId: string): SalaryBondFormValues => ({
  employee_id: employeeId,
  target_amount: "10000",
  deduction_per_payroll: "",
  start_deduction: todayKey(),
  notes: "",
});

const emptyWithdrawalForm = (): SalaryBondWithdrawalFormValues => ({
  amount: "",
  transaction_date: todayKey(),
  note: "",
});

export function SalaryBondsFeature({
  employee,
  employees,
  onChange,
  onQueueOfflineMutation,
  salaryBonds,
  userId,
}: {
  employee?: Employee;
  employees: Employee[];
  onChange: () => Promise<void>;
  onQueueOfflineMutation: QueueOfflineMutation;
  salaryBonds: SalaryBond[];
  userId: string;
}) {
  const [bondForm, setBondForm] = useState<SalaryBondFormValues>(() => emptyBondForm(employee?.id ?? ""));
  const [editingBond, setEditingBond] = useState<SalaryBond | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const bondFormDialog = useDialog({
    label: `${editingBond ? "Edit" : "Add"} salary bond`,
    onClose: () => setFormOpen(false),
    open: formOpen,
  });
  const [withdrawingBond, setWithdrawingBond] = useState<SalaryBond | null>(null);
  const [withdrawalForm, setWithdrawalForm] = useState<SalaryBondWithdrawalFormValues>(emptyWithdrawalForm);
  const [withdrawalBusy, setWithdrawalBusy] = useState(false);
  const [historyBond, setHistoryBond] = useState<SalaryBond | null>(null);

  const scopedBonds = (employee ? salaryBonds.filter((bond) => bond.employee_id === employee.id) : salaryBonds)
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const employeesById = new Map(employees.map((item) => [item.id, item]));

  function openNewBondForm() {
    setEditingBond(null);
    setBondForm(emptyBondForm(employee?.id ?? ""));
    setFormOpen(true);
  }

  function openEditBondForm(bond: SalaryBond) {
    setEditingBond(bond);
    setBondForm({
      employee_id: bond.employee_id ?? "",
      target_amount: String(bond.target_amount),
      deduction_per_payroll: String(bond.deduction_per_payroll),
      start_deduction: bond.start_deduction,
      notes: bond.notes,
    });
    setFormOpen(true);
  }

  async function saveBond(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    const targetEmployee = employee ?? employeesById.get(bondForm.employee_id);
    if (!targetEmployee) {
      NotificationService.showError("Select an employee for this salary bond.");
      return;
    }
    if (!navigator.onLine) {
      NotificationService.showError("Connect to the internet to save a salary bond.");
      return;
    }
    const result = await saveSalaryBond(supabase, bondForm, userId, targetEmployee, editingBond?.id);
    if (result.error) {
      NotificationService.showError(friendlyError(result.error));
      return;
    }
    setFormOpen(false);
    setEditingBond(null);
    NotificationService.showSuccess(editingBond ? "Salary bond updated." : "Salary bond created.");
    await onChange();
  }

  async function toggleArchiveBond(bond: SalaryBond) {
    if (!supabase || !navigator.onLine) {
      NotificationService.showError("Connect to the internet to update this salary bond.");
      return;
    }
    const result = bond.status === "archived"
      ? await reactivateSalaryBond(supabase, bond.id)
      : await archiveSalaryBond(supabase, bond.id);
    if (result.error) {
      NotificationService.showError(friendlyError(result.error));
      return;
    }
    NotificationService.showSuccess(bond.status === "archived" ? "Salary bond reactivated." : "Salary bond archived.");
    await onChange();
  }

  function openWithdrawalForm(bond: SalaryBond) {
    setWithdrawingBond(bond);
    setWithdrawalForm(emptyWithdrawalForm());
  }

  async function submitWithdrawal(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !withdrawingBond) return;
    if (!navigator.onLine) {
      NotificationService.showError("Connect to the internet to record an emergency withdrawal.");
      return;
    }
    const amount = toNumber(withdrawalForm.amount);
    const validationError = validateSalaryBondWithdrawal({
      amount,
      archived: withdrawingBond.status === "archived",
      balance: withdrawingBond.balance,
      note: withdrawalForm.note,
      withdrawalDate: withdrawalForm.transaction_date,
      today: todayKey(),
    });
    if (validationError) {
      NotificationService.showError(validationError);
      return;
    }
    setWithdrawalBusy(true);
    try {
      const transactionId = crypto.randomUUID();
      const result = await recordSalaryBondWithdrawal(supabase, withdrawingBond.id, transactionId, withdrawalForm);
      if (result.error) {
        NotificationService.showError(isOfflineLikeError(result.error) ? "Connect to the internet to record an emergency withdrawal." : friendlyError(result.error));
        return;
      }
      NotificationService.showSuccess("Emergency withdrawal recorded.");
      setWithdrawingBond(null);
      await onChange();
    } finally {
      setWithdrawalBusy(false);
    }
  }

  const showEmployeeColumn = !employee;
  const headers = [
    ...(showEmployeeColumn ? ["Employee"] : []),
    "Reference", "Target", "Balance", "Remaining", "Deduction/Payroll", "Status", "Actions",
  ];

  return (
    <section className="page-stack">
      <PageHeader
        action={(
          <button className="primary-button compact" onClick={openNewBondForm} type="button">
            <Plus size={16} /> New Bond
          </button>
        )}
        eyebrow="Forced savings"
        title="Salary Bonds"
        text="Automatic payroll deductions accumulate toward a target balance; emergency withdrawals reduce it and deductions auto-resume."
      />

      <DataTable
        empty="No salary bonds yet."
        headers={headers}
        rows={scopedBonds.map((bond) => [
          ...(showEmployeeColumn ? [employeesById.get(bond.employee_id ?? "")?.full_name ?? bond.employee_name] : []),
          bond.bond_reference,
          currency.format(bond.target_amount),
          currency.format(bond.balance),
          currency.format(bond.remaining_to_target),
          currency.format(bond.deduction_per_payroll),
          <StatusBadge key="status" status={bond.status} />,
          <div className="row-actions" key="actions">
            <button aria-label="Emergency withdrawal" disabled={bond.status === "archived" || bond.balance <= 0} onClick={() => openWithdrawalForm(bond)} title="Emergency withdrawal" type="button">
              <Wallet size={14} />
            </button>
            <button aria-label="Transaction history" onClick={() => setHistoryBond(bond)} title="Transaction history" type="button">
              <History size={14} />
            </button>
            <button aria-label="Edit bond" onClick={() => openEditBondForm(bond)} title="Edit bond" type="button">
              <Pencil size={14} />
            </button>
            <button aria-label={bond.status === "archived" ? "Reactivate bond" : "Archive bond"} onClick={() => toggleArchiveBond(bond)} title={bond.status === "archived" ? "Reactivate bond" : "Archive bond"} type="button">
              {bond.status === "archived" ? <RotateCcw size={14} /> : <Archive size={14} />}
            </button>
          </div>,
        ])}
      />

      {formOpen && (
        <div className="modal-backdrop" {...bondFormDialog.backdropProps}>
          <div className="modal billing-form-modal subcon-form-modal" {...bondFormDialog.dialogProps}>
            <div className="modal-header">
              <h3>{editingBond ? "Edit" : "Add"} Salary Bond</h3>
              <button aria-label="Close" onClick={() => setFormOpen(false)} type="button"><X size={18} /></button>
            </div>
            <form className="billing-form-body" onSubmit={saveBond}>
              <div className="billing-form-fields subcon-form-fields">
                {employee ? (
                  <div className="employee-advance-selected-employee full">
                    <div className="avatar">{employee.full_name.slice(0, 1).toUpperCase()}</div>
                    <div>
                      <strong>{employee.full_name}</strong>
                      <span>{employee.role || "Employee"}</span>
                    </div>
                  </div>
                ) : (
                  <label className="full">
                    Employee
                    <select disabled={Boolean(editingBond)} required value={bondForm.employee_id} onChange={(event) => setBondForm({ ...bondForm, employee_id: event.target.value })}>
                      <option value="">Select employee</option>
                      {employees.map((item) => (
                        <option key={item.id} value={item.id}>{item.full_name}</option>
                      ))}
                    </select>
                  </label>
                )}
                <MoneyField label="Target Amount *" onChange={(value) => setBondForm({ ...bondForm, target_amount: value })} required value={bondForm.target_amount} />
                <MoneyField label="Deduction Per Payroll *" onChange={(value) => setBondForm({ ...bondForm, deduction_per_payroll: value })} required value={bondForm.deduction_per_payroll} />
                <label>
                  Start Deduction
                  <input required type="date" value={bondForm.start_deduction} onChange={(event) => setBondForm({ ...bondForm, start_deduction: event.target.value })} />
                </label>
                <label className="full">
                  Notes
                  <textarea rows={2} value={bondForm.notes} onChange={(event) => setBondForm({ ...bondForm, notes: event.target.value })} />
                </label>
              </div>
              <div className="form-actions">
                <button className="billing-btn outline" onClick={() => setFormOpen(false)} type="button">Cancel</button>
                <button className="billing-btn primary" type="submit">{editingBond ? "Update" : "Add"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {withdrawingBond && (
        <Modal onClose={() => setWithdrawingBond(null)} title={`Emergency withdrawal — ${withdrawingBond.employee_name}`}>
          <form className="form-grid" onSubmit={submitWithdrawal}>
            <p>Current balance: <strong>{currency.format(withdrawingBond.balance)}</strong></p>
            <MoneyField label="Amount *" onChange={(value) => setWithdrawalForm({ ...withdrawalForm, amount: value })} required value={withdrawalForm.amount} />
            <label>
              Withdrawal Date <span>*</span>
              <input required type="date" value={withdrawalForm.transaction_date} onChange={(event) => setWithdrawalForm({ ...withdrawalForm, transaction_date: event.target.value })} />
            </label>
            <label className="employee-advance-form-wide">
              Reason <span>*</span>
              <textarea placeholder="e.g. medical emergency, requested by employee" required value={withdrawalForm.note} onChange={(event) => setWithdrawalForm({ ...withdrawalForm, note: event.target.value })} />
            </label>
            <div className="form-actions full">
              <button className="secondary-button" onClick={() => setWithdrawingBond(null)} type="button">Cancel</button>
              <button className="primary-button compact" disabled={withdrawalBusy} type="submit">{withdrawalBusy ? "Recording..." : "Record Withdrawal"}</button>
            </div>
          </form>
        </Modal>
      )}

      {historyBond && (
        <Modal onClose={() => setHistoryBond(null)} title={`Transaction history — ${historyBond.employee_name}`}>
          <DataTable
            empty="No transactions recorded for this bond yet."
            headers={["Date", "Type", "Amount", "Note", "Status"]}
            rows={historyBond.transactions
              .slice()
              .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date) || b.created_at.localeCompare(a.created_at))
              .map((transaction) => [
                transaction.transaction_date,
                transaction.type === "deduction" ? "Payroll deduction" : "Emergency withdrawal",
                currency.format(transaction.amount),
                transaction.note || "—",
                <StatusBadge key="status" status={transaction.is_void ? "voided" : "recorded"} />,
              ])}
          />
        </Modal>
      )}
    </section>
  );
}
