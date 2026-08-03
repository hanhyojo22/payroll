import { useDialog } from "../../shared/components/useDialog";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Ban, CalendarClock, CheckCircle2, Eye, MoreVertical, Pencil, Plus, Receipt, Square, Tag, Trash2, X } from "lucide-react";
import { isOfflineLikeError } from "../../lib/offlineSync";
import { MoneyField } from "../../shared/components/MoneyField";
import { RequiredMark } from "../../shared/components/FormLayout";
import { PageHeader, RecordTitle, Toolbar } from "../../shared/components/PageLayout";
import { StatusBadge } from "../../shared/components/StatusBadge";
import { NotificationService } from "../../shared/notifications/NotificationService";
import type { QueueOfflineMutation } from "../../shared/types";
import { currency, toNumber } from "../../shared/utils/currency";
import { monthNames, todayKey } from "../../shared/utils/dates";
import { friendlyError } from "../../shared/utils/errors";
import {
  expenseDisplayStatus,
  expenseDurationCount,
  expensePaymentsTotal,
  expenseRemainingBalance,
  expenseTotalAmount,
  formatExpenseDuration,
  isExpenseOverdue,
  nextExpenseCompletionState,
  paymentMethodLabel,
  validateExpensePayment,
} from "../../domain/expenses";
import { normalizeSubcontractorPayoutTitle } from "../../domain/paymentReminders";
import type { CollectionPaymentMethod, Employee, Expense, ExpenseCategory, ExpenseCategoryType, ExpenseFrequency, ExpenseInstallmentPayment } from "../../types";
import { useRepositories } from "../../app/RepositoriesProvider";
import { notificationServiceNotifier } from "../../adapters/notifications/notifier";
import {
  cancelExpense as cancelExpenseUseCase,
  deleteExpense as deleteExpenseUseCase,
  deleteInstallmentPayment as deleteInstallmentPaymentUseCase,
  endRecurringExpense as endRecurringExpenseUseCase,
  payInstallment as payInstallmentUseCase,
  saveExpense as saveExpenseUseCase,
  type ExpenseDeps,
  type ExpenseFormValues,
  type InstallmentPaymentFormValues,
} from "./useCases";

const ORDINAL_SUFFIXES: Record<number, string> = { 1: "st", 2: "nd", 3: "rd" };

function ordinalDay(day: number) {
  if (day >= 11 && day <= 13) return `${day}th`;
  return `${day}${ORDINAL_SUFFIXES[day % 10] ?? "th"}`;
}

type ExpenseStatusFilter = "all" | "active" | "paid" | "overdue";

const STATUS_FILTER_OPTIONS: Array<{ value: ExpenseStatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
];

const EXPENSES_PAGE_SIZE = 10;

function isLegacyExpensesStatusConstraintError(error: { message?: string | null; details?: string | null } | null | undefined) {
  const message = `${error?.message ?? ""} ${error?.details ?? ""}`.toLowerCase();
  return message.includes("expenses_status_check");
}

function isLegacyExpensesFrequencyConstraintError(error: { message?: string | null; details?: string | null } | null | undefined) {
  const message = `${error?.message ?? ""} ${error?.details ?? ""}`.toLowerCase();
  return message.includes("expenses_frequency_check");
}

type ExpensesFeatureProps = {
  categoryScope: ExpenseCategoryType;
  employees: Employee[];
  expenseCategories: ExpenseCategory[];
  expenses: Expense[];
  onChange: () => Promise<void>;
  onQueueOfflineMutation: QueueOfflineMutation;
  userId: string;
};

export function ExpensesFeature({
  categoryScope,
  employees,
  expenseCategories: allExpenseCategories,
  expenses: allExpenses,
  onChange,
  onQueueOfflineMutation,
  userId,
}: ExpensesFeatureProps) {
  const expenseCategories = useMemo(
    () => allExpenseCategories.filter((category) => category.type === categoryScope),
    [allExpenseCategories, categoryScope],
  );
  const expenses = useMemo(
    () => allExpenses.filter((expense) => allExpenseCategories.find((category) => category.id === expense.category_id)?.type === categoryScope),
    [allExpenses, allExpenseCategories, categoryScope],
  );
  const [statusFilter, setStatusFilter] = useState<ExpenseStatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [payingInstallmentExpense, setPayingInstallmentExpense] = useState<Expense | null>(null);
  const [viewingExpense, setViewingExpense] = useState<Expense | null>(null);
  const [deletingExpense, setDeletingExpense] = useState<Expense | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const activeEmployees = employees.filter((employee) => employee.status === "active");
  const activeCategories = expenseCategories.filter((category) => category.status === "active");

  const filteredExpenses = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const today = todayKey();
    return expenses.filter((expense) => {
      const displayStatus = expenseDisplayStatus(expense, expense.installment_payments);
      const isOverdue = isExpenseOverdue(expense, expense.installment_payments, today);
      const matchesStatus = statusFilter === "all"
        ? true
        : statusFilter === "active"
          ? displayStatus === "unpaid" || displayStatus === "partial"
          : statusFilter === "paid"
            ? displayStatus === "paid"
            : isOverdue;
      const matchesQuery = !query
        || expense.employee_name.toLowerCase().includes(query)
        || expense.category_name.toLowerCase().includes(query)
        || expense.notes.toLowerCase().includes(query);
      return matchesStatus && matchesQuery;
    });
  }, [expenses, statusFilter, searchQuery]);

  const recordCount = filteredExpenses.length;
  const pageCount = Math.max(1, Math.ceil(recordCount / EXPENSES_PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, pageCount);
  const pageStart = (safeCurrentPage - 1) * EXPENSES_PAGE_SIZE;
  const pageEnd = Math.min(pageStart + EXPENSES_PAGE_SIZE, recordCount);
  const paginatedExpenses = filteredExpenses.slice(pageStart, pageEnd);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, categoryScope]);

  useEffect(() => {
    if (currentPage > pageCount) {
      setCurrentPage(pageCount);
    }
  }, [currentPage, pageCount]);

  const kpis = useMemo(() => {
    const monthKey = todayKey().slice(0, 7);
    const today = todayKey();
    const active = expenses.filter((expense) => expense.status !== "cancelled");
    const totalExpensesAmount = active.reduce((sum, expense) => sum + (expenseTotalAmount(expense) ?? toNumber(expense.amount)), 0);
    const outstanding = active.reduce((sum, expense) => sum + (expenseRemainingBalance(expense, expense.installment_payments) ?? 0), 0);
    const paidThisMonth = expenses.reduce(
      (sum, expense) => sum + expense.installment_payments
        .filter((payment) => payment.payment_date.startsWith(monthKey))
        .reduce((paymentSum, payment) => paymentSum + toNumber(payment.amount), 0),
      0,
    );
    const overdue = active.filter((expense) => isExpenseOverdue(expense, expense.installment_payments, today));
    const overdueTotal = overdue.reduce((sum, expense) => sum + (expenseRemainingBalance(expense, expense.installment_payments) ?? toNumber(expense.amount)), 0);
    return { totalExpensesAmount, outstanding, paidThisMonth, overdueTotal, overdueCount: overdue.length };
  }, [expenses]);

  const repos = useRepositories();

  // The use-cases hold the orchestration and are unit-tested against fakes; this component
  // only renders and delegates.
  const useCaseDeps: ExpenseDeps = useMemo(() => ({
    repos,
    queue: onQueueOfflineMutation,
    notify: notificationServiceNotifier,
    isOnline: () => navigator.onLine,
    reload: onChange,
    newId: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
    today: () => todayKey(),
  }), [repos, onQueueOfflineMutation, onChange]);

  async function handleSaveExpense(values: ExpenseFormValues) {
    const saved = await saveExpenseUseCase(useCaseDeps, {
      values, editing: editingExpense, activeCategories, activeEmployees, userId,
    });
    if (saved) {
      setFormOpen(false);
      setEditingExpense(null);
    }
  }

  async function handleDeleteExpense(expense: Expense) {
    const deleted = await deleteExpenseUseCase(useCaseDeps, { expense });
    if (deleted) setDeletingExpense(null);
  }

  async function handleCancelExpense(expense: Expense) {
    await cancelExpenseUseCase(useCaseDeps, { expense });
  }

  async function handlePayInstallment(expense: Expense, values: InstallmentPaymentFormValues) {
    const paid = await payInstallmentUseCase(useCaseDeps, { expense, values, userId });
    if (paid) setPayingInstallmentExpense(null);
  }

  async function handleDeleteInstallmentPayment(expense: Expense, payment: ExpenseInstallmentPayment) {
    await deleteInstallmentPaymentUseCase(useCaseDeps, { expense, payment });
  }

  async function handleEndRecurringExpense(expense: Expense) {
    await endRecurringExpenseUseCase(useCaseDeps, { expense });
  }

  return (
    <div className="billing-page">
      <PageHeader
        action={(
          <div className="billing-header-actions">
            <button
              className="billing-btn primary"
              onClick={() => { setEditingExpense(null); setFormOpen(true); }}
              type="button"
            >
              <Plus size={15} /> Add expense
            </button>
          </div>
        )}
        eyebrow={categoryScope === "personal" ? "Personal visibility" : "Finance visibility"}
        title={categoryScope === "personal" ? "Personal Expenses" : "Expenses"}
        text={categoryScope === "personal"
          ? "Track personal costs you're keeping alongside the business books."
          : "Track reimbursable costs and filter expenses by employee and status."}
      />

      <div className="expense-status-filter" role="group" aria-label="Filter by status">
        {STATUS_FILTER_OPTIONS.map((option) => (
          <button
            className={`expense-status-chip${statusFilter === option.value ? " active" : ""}`}
            key={option.value}
            onClick={() => setStatusFilter(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>

      <section className="expense-kpi-row">
        <div className="billing-stat billing-stat-outstanding">
          <div className="billing-stat-icon"><CalendarClock size={21} /></div>
          <div className="billing-stat-text">
            <span className="billing-stat-label">Upcoming</span>
            <strong className="billing-stat-value">{currency.format(kpis.outstanding)}</strong>
            <span className="billing-stat-helper">Remaining balance</span>
          </div>
        </div>
        <div className="billing-stat billing-stat-paid-month">
          <div className="billing-stat-icon"><CheckCircle2 size={21} /></div>
          <div className="billing-stat-text">
            <span className="billing-stat-label">This Month's Spending</span>
            <strong className="billing-stat-value">{currency.format(kpis.paidThisMonth)}</strong>
            <span className="billing-stat-helper">{monthNames[Number(todayKey().slice(5, 7)) - 1]}</span>
          </div>
        </div>
        <div className="billing-stat billing-stat-overdue">
          <div className="billing-stat-icon"><Ban size={21} /></div>
          <div className="billing-stat-text">
            <span className="billing-stat-label">Overdue</span>
            <strong className="billing-stat-value">{currency.format(kpis.overdueTotal)}</strong>
            <span className="billing-stat-helper">{kpis.overdueCount} expense{kpis.overdueCount === 1 ? "" : "s"}</span>
          </div>
        </div>
      </section>

      <Toolbar query={searchQuery} setQuery={setSearchQuery} />

      {recordCount === 0 ? (
        <div className="billing-empty">
          <Receipt size={32} />
          <p>No expenses found</p>
          <span>Add an expense or adjust the filters to see records here.</span>
        </div>
      ) : (
        <>
        <div className="billing-table-wrap expense-list-table-wrap">
          <table className="billing-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>{categoryScope === "personal" ? "Name" : "Employee"}</th>
                {categoryScope === "personal" && <th>Due date</th>}
                {categoryScope === "company" && <th>Payment date</th>}
                <th className="num">Total</th>
                <th className="num">Paid</th>
                <th className="num">Remaining</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {paginatedExpenses.map((expense) => {
                const displayStatus = expenseDisplayStatus(expense, expense.installment_payments);
                const totalAmount = expenseTotalAmount(expense);
                const remainingBalance = expenseRemainingBalance(expense, expense.installment_payments);
                const isOverdue = isExpenseOverdue(expense, expense.installment_payments, todayKey());
                const hasPayments = expense.installment_payments.length > 0;
                const canRecordPayment = displayStatus !== "paid" && displayStatus !== "cancelled";
                const isSystemManaged = expense.payroll_run_id !== null || expense.subcontractor_payment_reminder_id !== null;
                const isOpenEndedRecurring = expense.frequency !== "one_time" && !expense.duration_months;
                const expenseDisplayName = expense.subcontractor_payment_reminder_id !== null
                  ? normalizeSubcontractorPayoutTitle(expense.employee_name)
                  : expense.employee_name;
                return (
                <tr key={expense.id}>
                  <td>{expense.expense_date}</td>
                  <td>{expense.category_name}</td>
                  <td>
                    {categoryScope === "personal" ? (
                      expense.employee_name
                    ) : (
                      <div className="employee-list-identity">
                        <div className="employee-list-avatar">
                          {(() => {
                            const emp = employees.find((e) => e.id === expense.employee_id);
                            const avatarName = expense.subcontractor_payment_reminder_id !== null
                              ? normalizeSubcontractorPayoutTitle(expense.employee_name)
                              : expense.employee_name;
                            return emp?.profile_photo_url
                              ? <img alt="" src={emp.profile_photo_url} />
                              : <span>{avatarName.split(" ").filter(Boolean).slice(0, 2).map((p: string) => p[0]).join("").toUpperCase() || "E"}</span>;
                          })()}
                        </div>
                        <RecordTitle
                          title={expenseDisplayName}
                          notes={
                            expense.subcontractor_payment_reminder_id !== null
                              ? expense.notes
                              : employees.find((e) => e.id === expense.employee_id)?.email || "No email"
                          }
                        />
                      </div>
                    )}
                  </td>
                  {categoryScope === "personal" && (
                    <td className={isOverdue ? "expense-overdue" : ""}>{expense.due_date ?? "—"}</td>
                  )}
                  {categoryScope === "company" && (
                    <td className={isOverdue ? "expense-overdue" : ""}>{expense.payment_date ?? "—"}</td>
                  )}
                  <td className="num">
                    {totalAmount == null ? "Ongoing" : currency.format(totalAmount)}
                    {expense.frequency !== "one_time" && expense.duration_months != null && (
                      <small className="expense-installment-progress">{expense.installment_payments.length} of {expense.duration_months} paid</small>
                    )}
                  </td>
                  <td className="num">{currency.format(expensePaymentsTotal(expense.installment_payments))}</td>
                  <td className="num">{remainingBalance == null ? "—" : currency.format(remainingBalance)}</td>
                  <td><StatusBadge status={displayStatus} /></td>
                  <td>
                    <div className="billing-row-actions">
                      <button onClick={() => setViewingExpense(expense)} title="View details" type="button">
                        <Eye size={14} />
                      </button>
                      {!isSystemManaged && canRecordPayment && (
                        <button onClick={() => setPayingInstallmentExpense(expense)} title="Record payment" type="button">
                          <CheckCircle2 size={14} />
                        </button>
                      )}
                      {!isSystemManaged && canRecordPayment && isOpenEndedRecurring && (
                        <button onClick={() => void handleEndRecurringExpense(expense)} title="End expense" type="button">
                          <Square size={14} />
                        </button>
                      )}
                      {!isSystemManaged && (
                        <button
                          disabled={hasPayments}
                          onClick={() => { setEditingExpense(expense); setFormOpen(true); }}
                          title={hasPayments ? "Locked — payments already recorded against this expense." : "Edit"}
                          type="button"
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                      {!isSystemManaged && canRecordPayment && (
                        <button
                          disabled={hasPayments}
                          onClick={() => void handleCancelExpense(expense)}
                          title={hasPayments ? "Can't cancel — payments already recorded against this expense." : "Cancel expense"}
                          type="button"
                        >
                          <Ban size={14} />
                        </button>
                      )}
                      {!isSystemManaged && (
                        <button
                          disabled={hasPayments}
                          onClick={() => setDeletingExpense(expense)}
                          title={hasPayments ? "Can't delete — payments already recorded against this expense." : "Delete"}
                          type="button"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ExpenseMobileCardList
          categoryScope={categoryScope}
          expenses={paginatedExpenses}
          onCancelExpense={(expense) => void handleCancelExpense(expense)}
          onDeleteExpense={(expense) => setDeletingExpense(expense)}
          onEditExpense={(expense) => { setEditingExpense(expense); setFormOpen(true); }}
          onEndRecurringExpense={(expense) => void handleEndRecurringExpense(expense)}
          onOpenDetails={(expense) => setViewingExpense(expense)}
          onRecordPayment={(expense) => setPayingInstallmentExpense(expense)}
        />
        {recordCount > EXPENSES_PAGE_SIZE && (
          <div className="attendance-footer">
            <span>
              Showing {pageStart + 1} to {pageEnd} of {recordCount} expense{recordCount === 1 ? "" : "s"}
            </span>
            <div>
              <button
                disabled={safeCurrentPage === 1}
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                type="button"
              >
                {"<"}
              </button>
              {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
                <button
                  className={page === safeCurrentPage ? "active" : undefined}
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  type="button"
                >
                  {page}
                </button>
              ))}
              <button
                disabled={safeCurrentPage === pageCount}
                onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))}
                type="button"
              >
                {">"}
              </button>
            </div>
          </div>
        )}
        </>
      )}

      {formOpen && (
        <ExpenseFormModal
          activeCategories={activeCategories}
          activeEmployees={activeEmployees}
          categoryScope={categoryScope}
          initial={editingExpense}
          onClose={() => { setFormOpen(false); setEditingExpense(null); }}
          onSubmit={handleSaveExpense}
        />
      )}
      {payingInstallmentExpense && (
        <InstallmentPaymentForm
          categoryScope={categoryScope}
          expense={payingInstallmentExpense}
          onClose={() => setPayingInstallmentExpense(null)}
          onSubmit={(values) => handlePayInstallment(payingInstallmentExpense, values)}
        />
      )}
      {viewingExpense && (
        <ExpenseDetailsModal
          categoryScope={categoryScope}
          expense={expenses.find((item) => item.id === viewingExpense.id) ?? viewingExpense}
          onClose={() => setViewingExpense(null)}
          onDeletePayment={(payment) => handleDeleteInstallmentPayment(viewingExpense, payment)}
          onRecordPayment={() => setPayingInstallmentExpense(viewingExpense)}
        />
      )}
      {deletingExpense && (
        <ConfirmDeleteExpenseModal
          expense={deletingExpense}
          onCancel={() => setDeletingExpense(null)}
          onConfirm={() => handleDeleteExpense(deletingExpense)}
        />
      )}
    </div>
  );
}

function ExpenseMobileCardList({
  categoryScope,
  expenses,
  onCancelExpense,
  onDeleteExpense,
  onEditExpense,
  onEndRecurringExpense,
  onOpenDetails,
  onRecordPayment,
}: {
  categoryScope: ExpenseCategoryType;
  expenses: Expense[];
  onCancelExpense: (expense: Expense) => void;
  onDeleteExpense: (expense: Expense) => void;
  onEditExpense: (expense: Expense) => void;
  onEndRecurringExpense: (expense: Expense) => void;
  onOpenDetails: (expense: Expense) => void;
  onRecordPayment: (expense: Expense) => void;
}) {
  const [openMenuId, setOpenMenuId] = useState("");
  const [menuOpensUp, setMenuOpensUp] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenuId) return;
    function handleClick(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpenMenuId("");
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openMenuId]);

  useLayoutEffect(() => {
    if (!openMenuId) {
      setMenuOpensUp(false);
      return;
    }
    const dropdown = menuRef.current?.querySelector<HTMLElement>(".ticket-menu-dropdown");
    if (!dropdown) return;
    setMenuOpensUp(dropdown.getBoundingClientRect().bottom > window.innerHeight);
  }, [openMenuId]);

  const today = todayKey();

  return (
    <div className="expense-mobile-list">
      {expenses.map((expense) => {
        const displayStatus = expenseDisplayStatus(expense, expense.installment_payments);
        const totalAmount = expenseTotalAmount(expense);
        const remainingBalance = expenseRemainingBalance(expense, expense.installment_payments);
        const isOverdue = isExpenseOverdue(expense, expense.installment_payments, today);
        const hasPayments = expense.installment_payments.length > 0;
        const canRecordPayment = displayStatus !== "paid" && displayStatus !== "cancelled";
        const isSystemManaged = expense.payroll_run_id !== null || expense.subcontractor_payment_reminder_id !== null;
        const isOpenEndedRecurring = expense.frequency !== "one_time" && !expense.duration_months;
        const expenseDisplayName = expense.subcontractor_payment_reminder_id !== null
          ? normalizeSubcontractorPayoutTitle(expense.employee_name)
          : expense.employee_name;
        const dateLabel = categoryScope === "company"
          ? (expense.payment_date ? `Payment: ${expense.payment_date}` : `Due: ${expense.expense_date}`)
          : (expense.due_date ? `Due: ${expense.due_date}` : `Logged ${expense.expense_date}`);
        const installmentNote = expense.frequency !== "one_time" && expense.duration_months != null
          ? ` · ${expense.installment_payments.length} of ${expense.duration_months} paid`
          : "";
        const frequencyLabel = expense.frequency === "monthly" ? "Monthly" : expense.frequency === "daily" ? "Daily" : "One-time";
        const primaryAmount = remainingBalance != null
          ? currency.format(remainingBalance)
          : totalAmount == null ? "Ongoing" : currency.format(totalAmount);
        const secondaryAmount = remainingBalance != null && totalAmount != null && remainingBalance !== totalAmount
          ? `of ${currency.format(totalAmount)}`
          : frequencyLabel;
        const showKebab = !isSystemManaged;

        return (
          <div className="expense-mobile-card" key={expense.id}>
            <div
              className="expense-mobile-tap"
              onClick={() => onOpenDetails(expense)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpenDetails(expense);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className="employee-list-avatar">
                {categoryScope === "company" ? <Receipt size={18} /> : <Tag size={18} />}
              </div>
              <div className="expense-mobile-main">
                <div className="expense-mobile-title-row">
                  <strong>{expense.category_name}</strong>
                  <StatusBadge status={displayStatus} />
                </div>
                <span className="expense-mobile-subtitle">{expenseDisplayName}</span>
                <span className={`expense-mobile-meta${isOverdue ? " expense-overdue" : ""}`}>
                  {dateLabel}{installmentNote}
                </span>
              </div>
              <div className="expense-mobile-side">
                <strong>{primaryAmount}</strong>
                <small>{secondaryAmount}</small>
              </div>
            </div>
            {showKebab && (
              <div className="ticket-menu-wrap expense-mobile-kebab-wrap" ref={openMenuId === expense.id ? menuRef : undefined}>
                <button
                  aria-label="More actions"
                  className="expense-mobile-kebab"
                  onClick={() => setOpenMenuId((prev) => prev === expense.id ? "" : expense.id)}
                  type="button"
                >
                  <MoreVertical size={16} />
                </button>
                {openMenuId === expense.id && (
                  <div className={`ticket-menu-dropdown${menuOpensUp ? " ticket-menu-dropdown--up" : ""}`}>
                    {canRecordPayment && (
                      <button onClick={() => { onRecordPayment(expense); setOpenMenuId(""); }} type="button">
                        <CheckCircle2 size={14} /> Record payment
                      </button>
                    )}
                    {canRecordPayment && isOpenEndedRecurring && (
                      <button onClick={() => { onEndRecurringExpense(expense); setOpenMenuId(""); }} type="button">
                        <Square size={14} /> End expense
                      </button>
                    )}
                    <button
                      disabled={hasPayments}
                      onClick={() => { onEditExpense(expense); setOpenMenuId(""); }}
                      title={hasPayments ? "Locked — payments already recorded against this expense." : undefined}
                      type="button"
                    >
                      <Pencil size={14} /> Edit
                    </button>
                    {canRecordPayment && (
                      <button
                        disabled={hasPayments}
                        onClick={() => { onCancelExpense(expense); setOpenMenuId(""); }}
                        title={hasPayments ? "Can't cancel — payments already recorded against this expense." : undefined}
                        type="button"
                      >
                        <Ban size={14} /> Cancel expense
                      </button>
                    )}
                    <button
                      disabled={hasPayments}
                      onClick={() => { onDeleteExpense(expense); setOpenMenuId(""); }}
                      title={hasPayments ? "Can't delete — payments already recorded against this expense." : undefined}
                      type="button"
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ExpenseFormModal({
  activeCategories,
  activeEmployees,
  categoryScope,
  initial,
  onClose,
  onSubmit,
}: {
  activeCategories: ExpenseCategory[];
  activeEmployees: Employee[];
  categoryScope: ExpenseCategoryType;
  initial: Expense | null;
  onClose: () => void;
  onSubmit: (values: ExpenseFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<ExpenseFormValues>({
    employee_id: initial?.employee_id ?? activeEmployees[0]?.id ?? "",
    employee_name: categoryScope === "personal" ? initial?.employee_name ?? "" : "",
    category_id: initial?.category_id ?? activeCategories[0]?.id ?? "",
    amount: initial ? String(initial.amount) : "",
    frequency: initial?.frequency ?? "one_time",
    expense_date: initial?.expense_date ?? todayKey(),
    due_date: initial?.due_date ?? "",
    payment_date: initial?.payment_date ?? "",
    notes: initial?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const dueDateHint = (() => {
    if (values.frequency === "one_time") return null;
    if (!values.due_date) return "No due date — recurs indefinitely.";
    const count = expenseDurationCount(values.frequency, values.expense_date, values.due_date);
    if (values.frequency === "daily") return `Runs daily until ${values.due_date} (${formatExpenseDuration("daily", count)}).`;
    const dueDay = Number(values.due_date.split("-")[2]);
    return `Recurring on the ${ordinalDay(dueDay)} of each month, ending ${values.due_date} (${formatExpenseDuration("monthly", count)}).`;
  })();
  const { backdropProps, dialogProps } = useDialog({ label: `${initial ? "Edit" : "Add"} ${categoryScope} expense`, onClose });

  return (
    <div className="modal-backdrop" {...backdropProps}>
      <div className={`modal billing-form-modal${categoryScope === "personal" ? " personal-expense-modal" : " company-expense-modal"}`} {...dialogProps}>
        <div className="modal-header">
          <h3>{initial ? "Edit" : "Add"} {categoryScope === "personal" ? "Personal" : "Company"} Expense</h3>
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
          <div className={`billing-form-fields${categoryScope === "personal" ? " personal-expense-form-fields" : " company-expense-form-fields"}`}>
            <label>
              {categoryScope === "personal" ? "What's this for?" : "Employee"}<RequiredMark />
              {categoryScope === "personal" ? (
                <input
                  placeholder="e.g. Netflix subscription"
                  type="text"
                  value={values.employee_name}
                  onChange={(event) => setValues((current) => ({ ...current, employee_name: event.target.value }))}
                  required
                />
              ) : (
                <select value={values.employee_id} onChange={(event) => setValues((current) => ({ ...current, employee_id: event.target.value }))} required>
                  {activeEmployees.map((employee) => (
                    <option key={employee.id} value={employee.id}>{employee.full_name}</option>
                  ))}
                </select>
              )}
            </label>
            <label>
              Category<RequiredMark />
              {activeCategories.length === 0 ? (
                <div className="expense-form-no-categories">
                  No {categoryScope} categories yet. Add one in Settings → Expense Categories first.
                </div>
              ) : (
                <select value={values.category_id} onChange={(event) => setValues((current) => ({ ...current, category_id: event.target.value }))} required>
                  {activeCategories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              )}
            </label>
            <label>
              Amount<RequiredMark />
              <input inputMode="decimal" min="0" placeholder="0.00" step="0.01" type="number" value={values.amount} onChange={(event) => setValues((current) => ({ ...current, amount: event.target.value }))} required />
            </label>
            <label>
              Date<RequiredMark />
              <input type="date" value={values.expense_date} onChange={(event) => setValues((current) => ({ ...current, expense_date: event.target.value }))} required />
            </label>
            <label>
              Frequency
              <select value={values.frequency} onChange={(event) => setValues((current) => ({ ...current, frequency: event.target.value as ExpenseFrequency }))}>
                <option value="one_time">One-time</option>
                <option value="monthly">Monthly</option>
                <option value="daily">Daily</option>
              </select>
            </label>
            {categoryScope === "company" && (
              <label>
                Payment date (optional)
                <input type="date" value={values.payment_date} onChange={(event) => setValues((current) => ({ ...current, payment_date: event.target.value }))} />
              </label>
            )}
          </div>
          {categoryScope === "company" && (
            <label>
              Notes
              <textarea rows={3} value={values.notes} onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))} />
            </label>
          )}
          {categoryScope === "personal" && (
            <div className="personal-expense-more">
              <button
                className="personal-expense-more-toggle"
                onClick={() => setShowMoreOptions((current) => !current)}
                type="button"
              >
                {showMoreOptions ? "Hide options" : "More options"}
              </button>
              {showMoreOptions && (
                <div className="personal-expense-more-fields">
                  <label>
                    {values.frequency === "one_time" ? "Due date (optional)" : "Due date — when this ends (optional)"}
                    <input type="date" value={values.due_date} onChange={(event) => setValues((current) => ({ ...current, due_date: event.target.value }))} />
                    {dueDateHint && <small className="expense-remaining-note">{dueDateHint}</small>}
                  </label>
                  <label>
                    Notes
                    <textarea rows={3} value={values.notes} onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))} />
                  </label>
                </div>
              )}
            </div>
          )}
          <div className="form-actions">
            <button className="billing-btn outline" onClick={onClose} type="button">Cancel</button>
            <button
              className="billing-btn primary"
              disabled={
                busy ||
                !values.category_id ||
                (categoryScope === "company" && activeEmployees.length === 0) ||
                (categoryScope === "personal" && !values.employee_name.trim())
              }
              title={!values.category_id ? `Add a ${categoryScope} category first.` : undefined}
              type="submit"
            >
              {busy ? "Saving..." : initial ? "Update Expense" : "Save Expense"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function InstallmentPaymentForm({
  categoryScope,
  expense,
  onClose,
  onSubmit,
}: {
  categoryScope: ExpenseCategoryType;
  expense: Expense;
  onClose: () => void;
  onSubmit: (values: InstallmentPaymentFormValues) => Promise<void>;
}) {
  const remainingBalance = expenseRemainingBalance(expense, expense.installment_payments);
  // For a one-time expense, the whole remaining balance is "this payment." For a recurring
  // (monthly/daily) expense, default to just one cycle's amount — not the entire multi-period
  // balance — so a single payment doesn't accidentally settle the whole schedule at once.
  const defaultAmount = expense.frequency === "one_time"
    ? (remainingBalance ?? expense.amount)
    : Math.min(expense.amount, remainingBalance ?? expense.amount);
  const [values, setValues] = useState<InstallmentPaymentFormValues>({
    amount: String(defaultAmount),
    payment_date: todayKey(),
    payment_method: "cash",
    reference_number: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const { backdropProps, dialogProps } = useDialog({ label: "Record expense payment", onClose });

  return (
    <div className="modal-backdrop" {...backdropProps}>
      <div className={`modal billing-form-modal expense-payment-modal${categoryScope === "personal" ? " personal-expense-modal" : " company-expense-modal"}`} {...dialogProps}>
        <div className="modal-header">
          <div>
            <h3>Record Payment</h3>
            <span>{expense.category_name} · {expense.employee_name}</span>
          </div>
          <button aria-label="Close" onClick={onClose} type="button"><X size={18} /></button>
        </div>
        <form
          className="billing-form-body"
          onSubmit={async (event) => { event.preventDefault(); setBusy(true); await onSubmit(values); setBusy(false); }}
        >
          <p className="expense-remaining-note">
            {remainingBalance == null ? "No balance cap — open-ended recurring expense." : `Remaining balance: ${currency.format(remainingBalance)}`}
          </p>
          <div className={`billing-form-fields${categoryScope === "personal" ? " personal-expense-form-fields" : " company-expense-form-fields"}`}>
            <MoneyField label="Amount" onChange={(amount) => setValues((current) => ({ ...current, amount }))} required value={values.amount} />
            <label>
              Payment date<RequiredMark />
              <input
                max={todayKey()}
                onChange={(event) => setValues((current) => ({ ...current, payment_date: event.target.value }))}
                required
                type="date"
                value={values.payment_date}
              />
            </label>
            <label>
              Payment method
              <select
                onChange={(event) => setValues((current) => ({ ...current, payment_method: event.target.value as CollectionPaymentMethod }))}
                value={values.payment_method}
              >
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="check">Check</option>
                <option value="e_wallet">E-wallet</option>
                <option value="card">Card</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Reference number
              <input
                onChange={(event) => setValues((current) => ({ ...current, reference_number: event.target.value }))}
                type="text"
                value={values.reference_number}
              />
            </label>
          </div>
          <label>
            Notes
            <textarea onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))} rows={3} value={values.notes} />
          </label>
          <div className="form-actions">
            <button className="billing-btn outline" onClick={onClose} type="button">Cancel</button>
            <button className="billing-btn primary" disabled={busy} type="submit">{busy ? "Saving..." : "Record payment"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ExpenseDetailsModal({
  categoryScope,
  expense,
  onClose,
  onDeletePayment,
  onRecordPayment,
}: {
  categoryScope: ExpenseCategoryType;
  expense: Expense;
  onClose: () => void;
  onDeletePayment: (payment: ExpenseInstallmentPayment) => Promise<void>;
  onRecordPayment: () => void;
}) {
  const payments = [...expense.installment_payments].sort((a, b) => b.payment_date.localeCompare(a.payment_date) || b.created_at.localeCompare(a.created_at));
  const displayStatus = expenseDisplayStatus(expense, expense.installment_payments);
  const totalAmount = expenseTotalAmount(expense);
  const paidAmount = expensePaymentsTotal(expense.installment_payments);
  const remainingBalance = expenseRemainingBalance(expense, expense.installment_payments);
  const canRecordPayment = displayStatus !== "paid" && displayStatus !== "cancelled";
  const { backdropProps, dialogProps } = useDialog({ label: `Expense details: ${expense.employee_name}`, onClose });

  return (
    <div className="modal-backdrop" {...backdropProps}>
      <div className="modal expense-details-modal" {...dialogProps}>
        <div className="modal-header">
          <div>
            <h3>{expense.category_name}</h3>
            <span>{expense.employee_name}</span>
          </div>
          <button aria-label="Close" onClick={onClose} type="button"><X size={18} /></button>
        </div>
        <div className="expense-details-modal-body">
          <section className="expense-summary-grid">
            <SummaryCard label="Total amount" value={totalAmount} />
            <SummaryCard label="Paid amount" value={paidAmount} tone="success" />
            <SummaryCard label="Remaining balance" value={remainingBalance} />
          </section>

          <section className="expense-detail-card">
            <div>
              <span>Status</span>
              <StatusBadge status={displayStatus} />
            </div>
            <div>
              <span>{categoryScope === "personal" ? "Name" : "Employee"}</span>
              <strong>{expense.employee_name}</strong>
            </div>
            <div>
              <span>Category</span>
              <strong>{expense.category_name}</strong>
            </div>
            {categoryScope === "personal" && (
              <div>
                <span>Due date</span>
                <strong>{expense.due_date ?? "—"}</strong>
              </div>
            )}
            {categoryScope === "company" && (
              <div>
                <span>Payment date</span>
                <strong>{expense.payment_date ?? "—"}</strong>
              </div>
            )}
            <div>
              <span>Frequency</span>
              <strong>
                {expense.frequency === "monthly" ? "Monthly" : expense.frequency === "daily" ? "Daily" : "One-time"}
                {expense.frequency !== "one_time" && formatExpenseDuration(expense.frequency, expense.duration_months)
                  ? ` · Ends after ${formatExpenseDuration(expense.frequency, expense.duration_months)}`
                  : ""}
              </strong>
            </div>
            {expense.frequency !== "one_time" && expense.duration_months != null && (
              <div>
                <span>Installments</span>
                <strong>{expense.installment_payments.length} of {expense.duration_months} paid</strong>
              </div>
            )}
            <div className="wide">
              <span>Notes</span>
              <strong>{expense.notes || "No notes"}</strong>
            </div>
          </section>

          <section className="expense-ledger">
            <div className="expense-section-heading">
              <div>
                <p>Audit trail</p>
                <h2>Payment history</h2>
              </div>
              {categoryScope === "company" && canRecordPayment && expense.payroll_run_id === null && expense.subcontractor_payment_reminder_id === null && (
                <button className="billing-btn primary" onClick={onRecordPayment} type="button">
                  <CheckCircle2 size={15} /> Record Payment
                </button>
              )}
            </div>
            <div className="billing-table-wrap expense-ledger-table-wrap">
              <table className="billing-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="num">Amount</th>
                    <th>Method</th>
                    <th>Reference</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id}>
                      <td data-label="Date">{payment.payment_date}</td>
                      <td className="num" data-label="Amount">{currency.format(payment.amount)}</td>
                      <td data-label="Method">{paymentMethodLabel(payment.payment_method)}</td>
                      <td data-label="Reference">{payment.reference_number || "—"}</td>
                      <td data-label="Action">
                        <div className="billing-row-actions">
                          <button onClick={() => void onDeletePayment(payment)} title="Delete" type="button"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {payments.length === 0 && (
                    <tr>
                      <td className="collection-empty" colSpan={5}>No payments recorded yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {payments.length > 0 && (
              <div className="expense-ledger-mobile-list">
                {payments.map((payment) => (
                  <div className="expense-ledger-mobile-row" key={payment.id}>
                    <div className="expense-ledger-mobile-main">
                      <strong>{payment.payment_date}</strong>
                      <span>{paymentMethodLabel(payment.payment_method)}{payment.reference_number ? ` · ${payment.reference_number}` : ""}</span>
                    </div>
                    <div className="expense-ledger-mobile-side">
                      <strong>{currency.format(payment.amount)}</strong>
                      <button aria-label="Delete payment" onClick={() => void onDeletePayment(payment)} type="button">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {payments.length === 0 && (
              <p className="expense-ledger-empty">No payments recorded yet.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, tone, value }: { label: string; tone?: "danger" | "success"; value: number | null }) {
  return (
    <div className={`expense-summary-card ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value == null ? "Ongoing" : currency.format(value)}</strong>
    </div>
  );
}

function ConfirmDeleteExpenseModal({
  expense,
  onCancel,
  onConfirm,
}: {
  expense: Expense;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { backdropProps, dialogProps } = useDialog({ label: "Confirm delete expense", onClose: onCancel });

  return (
    <div className="modal-backdrop" {...backdropProps}>
      <div className="modal expense-confirm-modal" {...dialogProps}>
        <div className="modal-header">
          <h3>Delete expense?</h3>
          <button aria-label="Close" onClick={onCancel} type="button"><X size={18} /></button>
        </div>
        <div className="expense-confirm-body">
          <p>
            This will permanently delete <strong>{expense.category_name} — {expense.employee_name}</strong>
            {" "}({currency.format(expense.amount)}). This can't be undone.
          </p>
          <div className="form-actions">
            <button className="billing-btn outline" onClick={onCancel} type="button">Cancel</button>
            <button className="billing-btn danger" onClick={onConfirm} type="button">
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ExpenseCategoriesManager({
  categories,
  onChange,
  onQueueOfflineMutation,
  userId,
}: {
  categories: ExpenseCategory[];
  onChange: () => Promise<void>;
  onQueueOfflineMutation: QueueOfflineMutation;
  userId: string;
}) {
  const [activeTab, setActiveTab] = useState<ExpenseCategoryType>("company");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseCategory | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const repos = useRepositories();
  const tabCategories = categories.filter((category) => category.type === activeTab);
  const sortedCategories = [...tabCategories].sort((first, second) => {
    if (first.status !== second.status) {
      return first.status === "active" ? -1 : 1;
    }
    return first.name.localeCompare(second.name);
  });
  const activeCount = tabCategories.filter((category) => category.status === "active").length;
  const archivedCount = tabCategories.length - activeCount;

  async function handleSaveCategory(status: "active" | "archived" = "active") {
    if (!name.trim()) return;
    setBusy(true);
    const categoryType = editing?.type ?? activeTab;
    const payload = { id: editing?.id, name: name.trim(), type: categoryType, status };

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
      setFormOpen(false);
      setEditing(null);
      setName("");
      NotificationService.showSuccess("Expense category saved locally. It will sync when online.");
      return;
    }

    const result = await repos.expenseCategories.save(userId, payload);
    setBusy(false);
    if (result.error) {
      NotificationService.showError(friendlyError(result.error, "Failed to save expense category."));
      return;
    }
    setFormOpen(false);
    setEditing(null);
    setName("");
    NotificationService.showSuccess("Expense category saved.");
    await onChange();
  }

  async function deleteCategory(category: ExpenseCategory) {
    const confirmed = await NotificationService.showConfirm({
      message: `Delete the "${category.name}" category?`,
      danger: true,
    });
    if (!confirmed) return;

    if (!navigator.onLine) {
      await onQueueOfflineMutation({
        resource: "expenseCategories",
        affectedResources: ["expenseCategories"],
        operation: "delete",
        table: "expense_categories",
        recordId: category.id,
      });
      if (editing?.id === category.id) {
        setFormOpen(false);
        setEditing(null);
        setName("");
      }
      NotificationService.showSuccess("Category deleted locally. It will sync when online.");
      return;
    }

    const result = await repos.expenseCategories.remove(category.id);
    if (result.error) {
      const message = `${result.error.message ?? ""} ${result.error.details ?? ""}`.toLowerCase();
      if (message.includes("foreign key") || message.includes("violates")) {
        NotificationService.showError("This category has expenses linked to it and can't be deleted. Move or delete those expenses first.");
        return;
      }
      NotificationService.showError(friendlyError(result.error, "Failed to delete expense category."));
      return;
    }
    if (editing?.id === category.id) {
      setFormOpen(false);
      setEditing(null);
      setName("");
    }
    NotificationService.showSuccess("Category deleted.");
    await onChange();
  }

  function openAddForm() {
    setEditing(null);
    setName("");
    setFormOpen(true);
  }

  function openEditForm(category: ExpenseCategory) {
    setEditing(category);
    setName(category.name);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
    setName("");
  }

  return (
    <div className="page-stack">
      <PageHeader
        action={(
          <button className="billing-btn primary" onClick={openAddForm} type="button">
            <Plus size={15} /> Add category
          </button>
        )}
        eyebrow="Settings"
        title="Expense Categories"
        text="Manage the category library used by expense entries. Active categories appear in the expense form."
      />
      <div className="page-tabs" role="tablist">
        <button className={activeTab === "company" ? "active" : ""} onClick={() => setActiveTab("company")} role="tab" type="button">Company</button>
        <button className={activeTab === "personal" ? "active" : ""} onClick={() => setActiveTab("personal")} role="tab" type="button">Personal</button>
      </div>
      <div className="expense-category-page">
        <ExpenseCategoriesManagerContent
          activeCount={activeCount}
          archivedCount={archivedCount}
          sortedCategories={sortedCategories}
          onDelete={deleteCategory}
          onSelectCategory={openEditForm}
        />
        {formOpen && (
          <ExpenseCategoryFormModal
            busy={busy}
            categoryScope={activeTab}
            editing={editing}
            name={name}
            onClose={closeForm}
            onNameChange={setName}
            onSave={() => void handleSaveCategory(editing?.status ?? "active")}
          />
        )}
      </div>
    </div>
  );
}

function ExpenseCategoriesManagerContent({
  activeCount,
  archivedCount,
  sortedCategories,
  onDelete,
  onSelectCategory,
}: {
  activeCount: number;
  archivedCount: number;
  sortedCategories: ExpenseCategory[];
  onDelete: (category: ExpenseCategory) => Promise<void>;
  onSelectCategory: (category: ExpenseCategory) => void;
}) {
  return (
    <div className="expense-category-manager">
      <section className="expense-category-hero">
        <div>
          <span className="expense-category-kicker">Category library</span>
          <h4>Keep expense entries organized</h4>
          <p>Active categories appear in the expense form. Delete unused ones to keep the list clean.</p>
        </div>
        <div className="expense-category-stats" aria-label="Expense category totals">
          <span><strong>{activeCount}</strong> active</span>
          <span><strong>{archivedCount}</strong> archived</span>
        </div>
      </section>

      <section className="expense-category-list-panel">
        <div className="expense-category-list-header">
          <h4>All categories</h4>
        </div>
        <div className="expense-category-list">
          {sortedCategories.length === 0 ? (
            <div className="expense-category-empty">
              <Tag size={28} />
              <strong>No categories yet</strong>
              <span>Add your first expense category to start organizing records.</span>
            </div>
          ) : (
            sortedCategories.map((category) => (
              <div className="expense-category-row" key={category.id}>
                <div className="expense-category-row-main">
                  <span className="expense-category-icon"><Tag size={15} /></span>
                  <div>
                    <strong>{category.name}</strong>
                    <span className={`status ${category.status}`}>{category.status}</span>
                  </div>
                </div>
                <div className="expense-category-actions">
                  <button onClick={() => onSelectCategory(category)} title="Edit" type="button">
                    <Pencil size={14} /> Edit
                  </button>
                  <button onClick={() => void onDelete(category)} title="Delete" type="button">
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function ExpenseCategoryFormModal({
  busy,
  categoryScope,
  editing,
  name,
  onClose,
  onNameChange,
  onSave,
}: {
  busy: boolean;
  categoryScope: ExpenseCategoryType;
  editing: ExpenseCategory | null;
  name: string;
  onClose: () => void;
  onNameChange: (value: string) => void;
  onSave: () => void;
}) {
  const { backdropProps, dialogProps } = useDialog({ label: "Expense categories", onClose });

  return (
    <div className="modal-backdrop" {...backdropProps}>
      <div className="modal" {...dialogProps}>
        <div className="modal-header">
          <h3>{editing ? "Edit" : "Add"} {categoryScope === "personal" ? "Personal" : "Company"} Category</h3>
          <button aria-label="Close" onClick={onClose} type="button"><X size={18} /></button>
        </div>
        <form
          className="expense-category-form"
          onSubmit={(event) => { event.preventDefault(); onSave(); }}
        >
          {editing && (
            <div className="expense-category-card-badges">
              <span className={`status ${editing.status}`}>{editing.status}</span>
            </div>
          )}
          <label className="expense-category-input">
            Category name
            <input
              autoFocus
              placeholder="e.g. Transportation"
              type="text"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
            />
          </label>
          <div className="expense-category-form-actions">
            <button className="billing-btn outline" onClick={onClose} type="button">Cancel</button>
            <button className="billing-btn primary" disabled={busy || !name.trim()} type="submit">
              {busy ? "Saving..." : editing ? "Save changes" : "Add category"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
