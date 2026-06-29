import { useMemo, useState } from "react";
import { Pencil, Plus, Settings, Trash2, X } from "lucide-react";
import { supabase } from "../../supabase";
import { isOfflineLikeError } from "../../lib/offlineSync";
import type { Notice, QueueOfflineMutation } from "../../shared/types";
import { currency, toNumber } from "../../shared/utils/currency";
import { currentMonth, currentYear, monthNames, todayKey } from "../../shared/utils/dates";
import type { Employee, Expense, ExpenseCategory } from "../../types";
import { deleteExpense, saveExpense, saveExpenseCategory } from "./expenseRepository";

type ExpenseFormValues = {
  employee_id: string;
  category_id: string;
  amount: string;
  expense_date: string;
  notes: string;
};

export function ExpensesFeature({
  employees,
  expenseCategories,
  expenses,
  onChange,
  onQueueOfflineMutation,
  setNotice,
  userId,
}: {
  employees: Employee[];
  expenseCategories: ExpenseCategory[];
  expenses: Expense[];
  onChange: () => Promise<void>;
  onQueueOfflineMutation: QueueOfflineMutation;
  setNotice: (notice: Notice) => void;
  userId: string;
}) {
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState(String(currentMonth()));
  const [yearFilter, setYearFilter] = useState(String(currentYear()));
  const [formOpen, setFormOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const activeEmployees = employees.filter((employee) => employee.status === "active");
  const activeCategories = expenseCategories.filter((category) => category.status === "active");

  const filteredExpenses = useMemo(() => {
    return expenses.filter((expense) => {
      const [year, month] = expense.expense_date.split("-").map(Number);
      const matchesEmployee = employeeFilter === "all" || expense.employee_id === employeeFilter;
      const matchesMonth = month === Number(monthFilter);
      const matchesYear = year === Number(yearFilter);
      return matchesEmployee && matchesMonth && matchesYear;
    });
  }, [employeeFilter, expenses, monthFilter, yearFilter]);

  const totalExpenses = filteredExpenses.reduce((sum, expense) => sum + toNumber(expense.amount), 0);

  async function handleSaveExpense(values: ExpenseFormValues) {
    if (!supabase) return;
    const employee = activeEmployees.find((item) => item.id === values.employee_id);
    const category = activeCategories.find((item) => item.id === values.category_id);
    if (!employee || !category) {
      setNotice({ type: "error", text: "Select a valid employee and category." });
      return;
    }

    const payload = {
      id: editingExpense?.id ?? crypto.randomUUID(),
      user_id: userId,
      employee_id: employee.id,
      employee_name: employee.full_name,
      category_id: category.id,
      category_name: category.name,
      amount: toNumber(values.amount),
      expense_date: values.expense_date,
      notes: values.notes.trim(),
    };

    if (!navigator.onLine) {
      await onQueueOfflineMutation({
        resource: "expenses",
        affectedResources: ["expenses"],
        operation: "upsert",
        table: "expenses",
        recordId: payload.id,
        payload,
      });
      setFormOpen(false);
      setEditingExpense(null);
      setNotice({ type: "success", text: "Expense saved locally. It will sync when online." });
      return;
    }

    const result = await saveExpense(supabase, payload);
    if (result.error) {
      if (isOfflineLikeError(result.error)) {
        await onQueueOfflineMutation({
          resource: "expenses",
          affectedResources: ["expenses"],
          operation: "upsert",
          table: "expenses",
          recordId: payload.id,
          payload,
        });
        setFormOpen(false);
        setEditingExpense(null);
        setNotice({ type: "success", text: "Expense saved locally. It will sync when online." });
        return;
      }
      setNotice({ type: "error", text: result.error.message ?? "Failed to save expense." });
      return;
    }

    setFormOpen(false);
    setEditingExpense(null);
    setNotice({ type: "success", text: "Expense saved." });
    await onChange();
  }

  async function handleDeleteExpense(expense: Expense) {
    if (!supabase || !window.confirm("Delete this expense?")) return;

    if (!navigator.onLine) {
      await onQueueOfflineMutation({
        resource: "expenses",
        affectedResources: ["expenses"],
        operation: "delete",
        table: "expenses",
        recordId: expense.id,
      });
      setNotice({ type: "success", text: "Expense deleted locally. It will sync when online." });
      return;
    }

    const result = await deleteExpense(supabase, expense.id);
    if (result.error) {
      setNotice({ type: "error", text: result.error.message ?? "Failed to delete expense." });
      return;
    }
    setNotice({ type: "success", text: "Expense deleted." });
    await onChange();
  }

  return (
    <div className="billing-page">
      <header className="billing-header">
        <div>
          <p className="eyebrow">Finance visibility</p>
          <h2>Expenses</h2>
        </div>
        <div className="billing-header-actions">
          <button className="billing-btn outline" onClick={() => setSettingsOpen(true)} type="button">
            <Settings size={15} /> Categories
          </button>
          <button className="billing-btn primary" onClick={() => { setEditingExpense(null); setFormOpen(true); }} type="button">
            <Plus size={15} /> Add expense
          </button>
        </div>
      </header>

      <section className="billing-summary expense-summary">
        <label>
          Employee
          <select value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)}>
            <option value="all">All employees</option>
            {activeEmployees.map((employee) => (
              <option key={employee.id} value={employee.id}>{employee.full_name}</option>
            ))}
          </select>
        </label>
        <label>
          Month
          <select value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)}>
            {monthNames.map((name, index) => (
              <option key={name} value={String(index + 1)}>{name}</option>
            ))}
          </select>
        </label>
        <label>
          Year
          <input type="number" min="2020" max="2200" value={yearFilter} onChange={(event) => setYearFilter(event.target.value)} />
        </label>
        <div className="billing-stat accent">
          <span className="billing-stat-label">Total expenses</span>
          <strong className="billing-stat-value">{currency.format(totalExpenses)}</strong>
        </div>
      </section>

      {filteredExpenses.length === 0 ? (
        <div className="billing-empty">
          <Pencil size={32} />
          <p>No expenses found</p>
          <span>Add an expense or adjust the filters to see records here.</span>
        </div>
      ) : (
        <div className="billing-table-wrap">
          <table className="billing-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Employee</th>
                <th>Category</th>
                <th className="num">Amount</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredExpenses.map((expense) => (
                <tr key={expense.id}>
                  <td>{expense.expense_date}</td>
                  <td>
                    <div className="ticket-emp-cell">
                      <div className="employee-list-avatar">
                        {(() => {
                          const emp = employees.find((e) => e.id === expense.employee_id);
                          return emp?.profile_photo_url
                            ? <img alt="" src={emp.profile_photo_url} />
                            : <span>{expense.employee_name.split(" ").filter(Boolean).slice(0, 2).map((p: string) => p[0]).join("").toUpperCase() || "E"}</span>;
                        })()}
                      </div>
                      {expense.employee_name}
                    </div>
                  </td>
                  <td>{expense.category_name}</td>
                  <td className="num">{currency.format(expense.amount)}</td>
                  <td>{expense.notes || "—"}</td>
                  <td>
                    <div className="billing-row-actions">
                      <button onClick={() => { setEditingExpense(expense); setFormOpen(true); }} title="Edit" type="button"><Pencil size={14} /></button>
                      <button onClick={() => void handleDeleteExpense(expense)} title="Delete" type="button"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && (
        <ExpenseFormModal
          activeCategories={activeCategories}
          activeEmployees={activeEmployees}
          initial={editingExpense}
          onClose={() => { setFormOpen(false); setEditingExpense(null); }}
          onSubmit={handleSaveExpense}
        />
      )}

      {settingsOpen && (
        <ExpenseCategoriesModal
          categories={expenseCategories}
          onChange={onChange}
          onClose={() => setSettingsOpen(false)}
          onQueueOfflineMutation={onQueueOfflineMutation}
          setNotice={setNotice}
          userId={userId}
        />
      )}
    </div>
  );
}

function ExpenseFormModal({
  activeCategories,
  activeEmployees,
  initial,
  onClose,
  onSubmit,
}: {
  activeCategories: ExpenseCategory[];
  activeEmployees: Employee[];
  initial: Expense | null;
  onClose: () => void;
  onSubmit: (values: ExpenseFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<ExpenseFormValues>({
    employee_id: initial?.employee_id ?? activeEmployees[0]?.id ?? "",
    category_id: initial?.category_id ?? activeCategories[0]?.id ?? "",
    amount: initial ? String(initial.amount) : "",
    expense_date: initial?.expense_date ?? todayKey(),
    notes: initial?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal billing-form-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h3>{initial ? "Edit Expense" : "Add Expense"}</h3>
          <button aria-label="Close" onClick={onClose} type="button"><X size={18} /></button>
        </div>
        <form
          className="billing-form-body"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            await onSubmit(values);
            setBusy(false);
          }}
        >
          <div className="billing-form-fields">
            <label>
              Employee
              <select value={values.employee_id} onChange={(event) => setValues((current) => ({ ...current, employee_id: event.target.value }))} required>
                {activeEmployees.map((employee) => (
                  <option key={employee.id} value={employee.id}>{employee.full_name}</option>
                ))}
              </select>
            </label>
            <label>
              Category
              <select value={values.category_id} onChange={(event) => setValues((current) => ({ ...current, category_id: event.target.value }))} required>
                {activeCategories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </label>
            <label>
              Amount
              <input inputMode="decimal" min="0" placeholder="0.00" step="0.01" type="number" value={values.amount} onChange={(event) => setValues((current) => ({ ...current, amount: event.target.value }))} required />
            </label>
            <label>
              Date
              <input type="date" value={values.expense_date} onChange={(event) => setValues((current) => ({ ...current, expense_date: event.target.value }))} required />
            </label>
          </div>
          <label>
            Notes
            <textarea rows={3} value={values.notes} onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))} />
          </label>
          <div className="form-actions">
            <button className="billing-btn outline" onClick={onClose} type="button">Cancel</button>
            <button className="billing-btn primary" disabled={busy || activeEmployees.length === 0 || activeCategories.length === 0} type="submit">
              {busy ? "Saving..." : initial ? "Update Expense" : "Save Expense"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ExpenseCategoriesModal({
  categories,
  onChange,
  onClose,
  onQueueOfflineMutation,
  setNotice,
  userId,
}: {
  categories: ExpenseCategory[];
  onChange: () => Promise<void>;
  onClose: () => void;
  onQueueOfflineMutation: QueueOfflineMutation;
  setNotice: (notice: Notice) => void;
  userId: string;
}) {
  const [editing, setEditing] = useState<ExpenseCategory | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSaveCategory(status: "active" | "archived" = "active") {
    if (!supabase || !name.trim()) return;
    setBusy(true);
    const payload = { id: editing?.id, name: name.trim(), status };

    if (!navigator.onLine) {
      await onQueueOfflineMutation({
        resource: "expenseCategories",
        affectedResources: ["expenseCategories"],
        operation: "upsert",
        table: "expense_categories",
        recordId: editing?.id,
        payload: editing?.id ? payload : { ...payload, id: crypto.randomUUID(), user_id: userId },
      });
      setBusy(false);
      setEditing(null);
      setName("");
      setNotice({ type: "success", text: "Expense category saved locally. It will sync when online." });
      return;
    }

    const result = await saveExpenseCategory(supabase, userId, payload);
    setBusy(false);
    if (result.error) {
      setNotice({ type: "error", text: result.error.message ?? "Failed to save expense category." });
      return;
    }
    setEditing(null);
    setName("");
    setNotice({ type: "success", text: "Expense category saved." });
    await onChange();
  }

  async function toggleArchive(category: ExpenseCategory) {
    if (!supabase) return;
    const status = category.status === "active" ? "archived" : "active";
    const result = await saveExpenseCategory(supabase, userId, { id: category.id, name: category.name, status });
    if (result.error) {
      setNotice({ type: "error", text: result.error.message ?? "Failed to update expense category." });
      return;
    }
    setNotice({ type: "success", text: `Category ${status === "archived" ? "archived" : "restored"}.` });
    await onChange();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal billing-settings-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h3>Expense Categories</h3>
          <button aria-label="Close" onClick={onClose} type="button"><X size={18} /></button>
        </div>
        <div className="billing-settings-body">
          <section className="billing-subcon-settings">
            <div className="billing-subcon-settings-header">
              <h4>Categories</h4>
              <button
                className="billing-btn outline"
                onClick={() => {
                  setEditing(null);
                  setName("");
                }}
                type="button"
              >
                <Plus size={14} /> New
              </button>
            </div>
            {categories.map((category) => (
              <div className="billing-subcon-row" key={category.id}>
                <div className="billing-subcon-info">
                  <strong>{category.name}</strong>
                  <span>{category.status}</span>
                </div>
                <div className="billing-row-actions">
                  <button onClick={() => { setEditing(category); setName(category.name); }} title="Edit" type="button"><Pencil size={14} /></button>
                  <button onClick={() => void toggleArchive(category)} title={category.status === "active" ? "Archive" : "Restore"} type="button"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
            <div className="billing-subcon-form">
              <label>
                Category name
                <input type="text" value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <div className="billing-subcon-form-actions">
                <button className="billing-btn outline" onClick={() => { setEditing(null); setName(""); }} type="button">Clear</button>
                <button className="billing-btn primary" disabled={busy || !name.trim()} onClick={() => void handleSaveCategory(editing?.status ?? "active")} type="button">
                  {busy ? "Saving..." : editing ? "Update" : "Add Category"}
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
