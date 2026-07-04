import { useMemo, useState } from "react";
import { Eye, X } from "lucide-react";
import { buildPaymentLedger } from "../../lib/supabaseData";
import { paymentMethodLabel } from "../../domain/expenses";
import { DataTable } from "../../shared/components/DataTable";
import { PageHeader, RecordTitle } from "../../shared/components/PageLayout";
import { StatusBadge } from "../../shared/components/StatusBadge";
import { currency } from "../../shared/utils/currency";
import type { Expense, ExpenseCategory, ExpenseCategoryType, PaymentLedgerRow } from "../../types";

export function PaymentsFeature({ expenseCategories, expenses }: { expenseCategories: ExpenseCategory[]; expenses: Expense[] }) {
  const [activeTab, setActiveTab] = useState<ExpenseCategoryType>("company");
  const [viewingRow, setViewingRow] = useState<PaymentLedgerRow | null>(null);
  const paidLedgerRows = useMemo(
    () => buildPaymentLedger([], expenses.filter((expense) => expense.status === "paid"), expenseCategories)
      .filter((row) => row.source === "expense" && row.categoryType === activeTab)
      .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate)),
    [activeTab, expenseCategories, expenses],
  );
  const paidRows = paidLedgerRows.map((row) => [
    row.paymentDate,
    <RecordTitle key="title" notes={row.vendor} title={row.label} />,
    currency.format(row.amount),
    row.method ? paymentMethodLabel(row.method) : "—",
    (
      <button className="secondary-button compact" key="action" onClick={() => setViewingRow(row)} type="button">
        <Eye size={14} /> View
      </button>
    ),
  ]);
  const paidTotal = paidLedgerRows.reduce((sum, row) => sum + row.amount, 0);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Completed payments"
        text="Payment records for expenses that are fully paid."
        title="Payment History"
      />
      <div className="page-tabs" role="tablist">
        <button className={activeTab === "company" ? "active" : ""} onClick={() => setActiveTab("company")} role="tab" type="button">Company</button>
        <button className={activeTab === "personal" ? "active" : ""} onClick={() => setActiveTab("personal")} role="tab" type="button">Personal</button>
      </div>
      <section className="summary-band">
        <div>
          <p className="eyebrow">Total paid</p>
          <h2>{currency.format(paidTotal)}</h2>
        </div>
        <p>Read-only record of payments for expenses that are fully paid. Partial payments stay on the expense until it's fully settled.</p>
      </section>
      <DataTable
        empty={activeTab === "personal" ? "No paid personal expenses yet." : "No paid company expenses yet."}
        headers={["Date", "Expense", "Amount", "Method", "Action"]}
        rows={paidRows}
      />
      {viewingRow && <PaymentLedgerDetailsModal onClose={() => setViewingRow(null)} row={viewingRow} />}
    </div>
  );
}

function PaymentLedgerDetailsModal({ onClose, row }: { onClose: () => void; row: PaymentLedgerRow }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>{row.label}</h3>
            <span>{row.vendor}</span>
          </div>
          <button aria-label="Close" onClick={onClose} type="button"><X size={18} /></button>
        </div>
        <div className="expense-detail-card" style={{ margin: 20 }}>
          <div>
            <span>Category</span>
            <strong>{row.category}</strong>
          </div>
          <div>
            <span>Date</span>
            <strong>{row.paymentDate}</strong>
          </div>
          <div>
            <span>Amount</span>
            <strong>{currency.format(row.amount)}</strong>
          </div>
          <div>
            <span>Method</span>
            <strong>{row.method ? paymentMethodLabel(row.method) : "—"}</strong>
          </div>
          <div>
            <span>Reference number</span>
            <strong>{row.referenceNumber || "—"}</strong>
          </div>
          <div>
            <span>Status</span>
            <StatusBadge status={row.status} />
          </div>
        </div>
      </div>
    </div>
  );
}
