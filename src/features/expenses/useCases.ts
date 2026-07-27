import type { ExpenseCategoryRepository, ExpensePayload, ExpenseRepository } from "../../core/ports/expenses";
import type { Notifier } from "../../core/ports/notifier";
import {
  expenseDurationCount,
  expenseRemainingBalance,
  nextExpenseCompletionState,
  validateExpensePayment,
} from "../../domain/expenses";
import { isConnectivityFailure, friendlyError } from "../../shared/utils/errors";
import type { AppError, QueueOfflineMutation } from "../../shared/types";
import type {
  CollectionPaymentMethod,
  Employee,
  Expense,
  ExpenseCategory,
  ExpenseFrequency,
  ExpenseInstallmentPayment,
} from "../../types";

export type ExpenseFormValues = {
  employee_id: string;
  employee_name: string;
  category_id: string;
  amount: string;
  frequency: ExpenseFrequency;
  expense_date: string;
  due_date: string;
  payment_date: string;
  notes: string;
};

export type InstallmentPaymentFormValues = {
  amount: string;
  payment_date: string;
  payment_method: CollectionPaymentMethod;
  reference_number: string;
  notes: string;
};

export type ExpenseDeps = {
  repos: { expenses: ExpenseRepository; expenseCategories: ExpenseCategoryRepository };
  queue: QueueOfflineMutation;
  notify: Notifier;
  isOnline: () => boolean;
  reload: () => Promise<void>;
  newId: () => string;
  now: () => string;
  today: () => string;
};

const AFFECTED = ["expenses"] as const;
const toNumber = (value: string | number | null | undefined) => Number(value ?? 0);

/**
 * These two mean the database predates a schema update rather than that the admin did
 * anything wrong, so they get their own explanation instead of a raw constraint name.
 */
function legacyConstraintMessage(error: AppError | null | undefined): string | null {
  const text = `${error?.message ?? ""} ${error?.details ?? ""}`.toLowerCase();
  if (text.includes("expenses_status_check")) {
    return "Your database still uses the older expenses status rule. Apply the latest expense schema update to enable cancelled expenses.";
  }
  if (text.includes("expenses_frequency_check")) {
    return "Your database still uses the older expenses frequency rule. Apply the latest expense schema update to enable Daily frequency.";
  }
  return null;
}

export async function saveExpense(
  deps: ExpenseDeps,
  input: {
    values: ExpenseFormValues;
    editing: Expense | null;
    activeCategories: ExpenseCategory[];
    activeEmployees: Employee[];
    userId: string;
  },
): Promise<boolean> {
  const { values, editing, activeCategories, activeEmployees, userId } = input;

  const category = activeCategories.find((item) => item.id === values.category_id);
  if (!category) {
    deps.notify.error("Select a valid category.");
    return false;
  }

  let employeeId: string | null = null;
  let employeeName = "";
  if (category.type === "company") {
    const employee = activeEmployees.find((item) => item.id === values.employee_id);
    if (!employee) {
      deps.notify.error("Select a valid employee.");
      return false;
    }
    employeeId = employee.id;
    employeeName = employee.full_name;
  } else {
    if (!values.employee_name.trim()) {
      deps.notify.error("Enter a name for this personal expense.");
      return false;
    }
    employeeName = values.employee_name.trim();
  }

  const durationMonths = values.frequency !== "one_time" && values.due_date
    ? expenseDurationCount(values.frequency, values.expense_date, values.due_date)
    : null;

  const payload: ExpensePayload = {
    id: editing?.id ?? deps.newId(),
    user_id: userId,
    employee_id: employeeId,
    employee_name: employeeName,
    category_id: category.id,
    category_name: category.name,
    amount: toNumber(values.amount),
    frequency: values.frequency,
    duration_months: durationMonths,
    status: editing?.status ?? "pending",
    paid_date: editing?.paid_date ?? null,
    expense_date: values.expense_date,
    due_date: values.due_date || null,
    payment_date: values.payment_date || null,
    notes: values.notes.trim(),
    payroll_run_id: editing?.payroll_run_id ?? null,
    subcontractor_payment_reminder_id: editing?.subcontractor_payment_reminder_id ?? null,
  };

  const queueWrite = async () => {
    await deps.queue({
      resource: "expenses",
      affectedResources: [...AFFECTED],
      operation: "upsert",
      table: "expenses",
      recordId: payload.id,
      payload,
    });
    deps.notify.success("Expense saved locally. It will sync when online.");
  };

  if (!deps.isOnline()) {
    await queueWrite();
    return true;
  }

  const result = await deps.repos.expenses.save(payload);
  if (result.error) {
    if (isConnectivityFailure(result.error)) {
      await queueWrite();
      return true;
    }
    const legacy = legacyConstraintMessage(result.error);
    deps.notify.error(legacy ?? friendlyError(result.error, "Failed to save expense."));
    return false;
  }

  deps.notify.success("Expense saved.");
  await deps.reload();
  return true;
}

export async function deleteExpense(
  deps: ExpenseDeps,
  input: { expense: Expense },
): Promise<boolean> {
  const { expense } = input;
  // Deleting the parent would orphan its payments; the UI hides the action, this is the guard.
  if (expense.installment_payments.length > 0) return false;

  if (!deps.isOnline()) {
    await deps.queue({
      resource: "expenses",
      affectedResources: [...AFFECTED],
      operation: "delete",
      table: "expenses",
      recordId: expense.id,
    });
    deps.notify.success("Expense deleted locally. It will sync when online.");
    return true;
  }

  const result = await deps.repos.expenses.remove(expense.id);
  if (result.error) {
    deps.notify.error(friendlyError(result.error, "Failed to delete expense."));
    return false;
  }

  deps.notify.success("Expense deleted.");
  await deps.reload();
  return true;
}

export async function cancelExpense(
  deps: ExpenseDeps,
  input: { expense: Expense },
): Promise<void> {
  const { expense } = input;
  if (expense.installment_payments.length > 0) return;

  const confirmed = await deps.notify.confirm({
    title: "Cancel expense",
    message: "Cancel this expense? It will move to Expense History.",
    danger: true,
  });
  if (!confirmed) return;

  if (!deps.isOnline()) {
    await deps.queue({
      resource: "expenses",
      affectedResources: [...AFFECTED],
      operation: "update",
      table: "expenses",
      recordId: expense.id,
      payload: { status: "cancelled" },
    });
    deps.notify.success("Cancelled locally. It will sync when online.");
    return;
  }

  const result = await deps.repos.expenses.cancel(expense.id);
  if (result.error) {
    const legacy = legacyConstraintMessage(result.error);
    deps.notify.error(legacy ?? friendlyError(result.error, "Failed to cancel this expense."));
    return;
  }

  deps.notify.success("Expense cancelled.");
  await deps.reload();
}

export async function payInstallment(
  deps: ExpenseDeps,
  input: { expense: Expense; values: InstallmentPaymentFormValues; userId: string },
): Promise<boolean> {
  const { expense, values, userId } = input;
  const amount = toNumber(values.amount);

  const validationError = validateExpensePayment({
    amount,
    cancelled: expense.status === "cancelled",
    remainingBalance: expenseRemainingBalance(expense, expense.installment_payments),
    paymentDate: values.payment_date,
    today: deps.today(),
  });
  if (validationError) {
    deps.notify.error(validationError);
    return false;
  }

  const paymentId = deps.newId();
  const paymentPayload = {
    id: paymentId,
    user_id: userId,
    expense_id: expense.id,
    amount,
    payment_date: values.payment_date,
    payment_method: values.payment_method,
    reference_number: values.reference_number.trim(),
    notes: values.notes.trim(),
  };
  const provisional: ExpenseInstallmentPayment = { ...paymentPayload, created_at: deps.now() };
  const next = nextExpenseCompletionState(expense, [...expense.installment_payments, provisional], deps.today());
  const complete = next.status === "paid";

  if (!deps.isOnline()) {
    await deps.queue({
      resource: "expenses",
      affectedResources: [...AFFECTED],
      operation: "expense_payment_group",
      table: "expense_installment_payments",
      recordId: paymentId,
      payload: {
        paymentPayload,
        expenseUpdate: { id: expense.id, payload: next },
      },
    });
    deps.notify.success("Payment recorded locally. It will sync when online.");
    return true;
  }

  const result = await deps.repos.expenses.payInstallment({
    payment: paymentPayload,
    expenseId: expense.id,
    expensePatch: next,
  });
  if (result.error) {
    deps.notify.error(friendlyError(result.error, "Failed to record the payment."));
    return false;
  }

  deps.notify.success(complete ? "Final payment recorded — expense moved to History." : "Payment recorded.");
  await deps.reload();
  return true;
}

export async function deleteInstallmentPayment(
  deps: ExpenseDeps,
  input: { expense: Expense; payment: ExpenseInstallmentPayment },
): Promise<void> {
  const { expense, payment } = input;

  const confirmed = await deps.notify.confirm({
    title: "Delete payment",
    message: "Delete this installment payment?",
    danger: true,
  });
  if (!confirmed) return;

  const remaining = expense.installment_payments.filter((item) => item.id !== payment.id);
  // Removing the payment that settled the expense has to reopen it, or it stays in History
  // showing paid while its balance is outstanding again.
  const shouldRevert = expense.status === "paid"
    && nextExpenseCompletionState(expense, remaining, deps.today()).status !== "paid";

  if (!deps.isOnline()) {
    await deps.queue({
      resource: "expenses",
      affectedResources: [...AFFECTED],
      operation: "delete",
      table: "expense_installment_payments",
      recordId: payment.id,
    });
    if (shouldRevert) {
      await deps.queue({
        resource: "expenses",
        affectedResources: [...AFFECTED],
        operation: "update",
        table: "expenses",
        recordId: expense.id,
        payload: { status: "pending", paid_date: null },
      });
    }
    deps.notify.success("Deleted locally. It will sync when online.");
    return;
  }

  const deleteResult = await deps.repos.expenses.deleteInstallmentPayment(payment.id);
  if (deleteResult.error) {
    deps.notify.error(friendlyError(deleteResult.error, "Failed to delete that payment."));
    return;
  }

  if (shouldRevert) {
    const reopened = await deps.repos.expenses.updateCompletion(expense.id, { status: "pending", paid_date: null });
    if (reopened.error) {
      deps.notify.error(friendlyError(reopened.error, "Payment deleted, but failed to reopen the expense."));
      await deps.reload();
      return;
    }
  }

  deps.notify.success("Installment payment deleted.");
  await deps.reload();
}

export async function endRecurringExpense(
  deps: ExpenseDeps,
  input: { expense: Expense },
): Promise<void> {
  const { expense } = input;

  const confirmed = await deps.notify.confirm({
    title: "End recurring expense",
    message: "End this recurring expense? It will move to Expense History.",
    danger: true,
  });
  if (!confirmed) return;

  const payload = { status: "paid" as const, paid_date: deps.today() };

  if (!deps.isOnline()) {
    await deps.queue({
      resource: "expenses",
      affectedResources: [...AFFECTED],
      operation: "update",
      table: "expenses",
      recordId: expense.id,
      payload,
    });
    deps.notify.success("Ended locally. It will sync when online.");
    return;
  }

  const result = await deps.repos.expenses.updateCompletion(expense.id, payload);
  if (result.error) {
    deps.notify.error(friendlyError(result.error, "Failed to end this expense."));
    return;
  }

  deps.notify.success("Recurring expense ended.");
  await deps.reload();
}
