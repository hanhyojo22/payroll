import { useMemo, useState } from "react";
import { CheckCircle2, Eye, Receipt, Wallet, X } from "lucide-react";
import { buildPaymentLedger } from "../../lib/supabaseData";
import { paymentMethodLabel } from "../../domain/expenses";
import { DataTable } from "../../shared/components/DataTable";
import { PageHeader, RecordTitle } from "../../shared/components/PageLayout";
import { StatusBadge } from "../../shared/components/StatusBadge";
import { currency } from "../../shared/utils/currency";
import { monthNames, todayKey } from "../../shared/utils/dates";
import type { Expense, ExpenseCategory, ExpenseCategoryType, PaymentLedgerRow } from "../../types";

export function PaymentsFeature({
  expenseCategories,
  expenses,
}: {
  expenseCategories: ExpenseCategory[];
  expenses: Expense[];
}) {
  const [activeTab, setActiveTab] = useState<ExpenseCategoryType>("company");
  const [viewingRow, setViewingRow] = useState<PaymentLedgerRow | null>(null);
  const paidLedgerRows = useMemo(
    () => buildPaymentLedger([], expenses.filter((expense) => expense.status === "paid"), expenseCategories)
      .filter((row) => row.categoryType === activeTab)
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
  const thisMonthPrefix = todayKey().slice(0, 7);
  const thisMonthTotal = paidLedgerRows
    .filter((row) => row.paymentDate.slice(0, 7) === thisMonthPrefix)
    .reduce((sum, row) => sum + row.amount, 0);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Completed payments"
        text="Read-only record of completed company and personal payment transactions. Partial payouts and expenses stay on their active pages until fully settled."
        title="Payment History"
      />
      <div className="page-tabs" role="tablist">
        <button className={activeTab === "company" ? "active" : ""} onClick={() => setActiveTab("company")} role="tab" type="button">Company</button>
        <button className={activeTab === "personal" ? "active" : ""} onClick={() => setActiveTab("personal")} role="tab" type="button">Personal</button>
      </div>
      <section className="expense-kpi-row">
        <div className="billing-stat accent">
          <div className="billing-stat-icon"><Wallet size={21} /></div>
          <div className="billing-stat-text">
            <span className="billing-stat-label">Total Paid</span>
            <strong className="billing-stat-value">{currency.format(paidTotal)}</strong>
            <span className="billing-stat-helper">{activeTab === "personal" ? "Personal" : "Company"} payment records</span>
          </div>
        </div>
        <div className="billing-stat billing-stat-paid-month">
          <div className="billing-stat-icon"><CheckCircle2 size={21} /></div>
          <div className="billing-stat-text">
            <span className="billing-stat-label">This Month</span>
            <strong className="billing-stat-value">{currency.format(thisMonthTotal)}</strong>
            <span className="billing-stat-helper">{monthNames[Number(todayKey().slice(5, 7)) - 1]}</span>
          </div>
        </div>
        <div className="billing-stat billing-stat-outstanding">
          <div className="billing-stat-icon"><Receipt size={21} /></div>
          <div className="billing-stat-text">
            <span className="billing-stat-label">Payment Count</span>
            <strong className="billing-stat-value">{paidLedgerRows.length}</strong>
            <span className="billing-stat-helper">Total transactions</span>
          </div>
        </div>
      </section>
      <DataTable
        empty={activeTab === "personal" ? "No paid personal expense records yet." : "No paid company payment records yet."}
        headers={["Date", "Record", "Amount", "Method", "Action"]}
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
        <div className="expense-details-modal-body">
          <section className="expense-summary-grid payment-summary-grid">
            <PaymentSummaryCard label="Amount paid" tone="success" value={row.amount} />
            {row.expenseAmount != null && (
              <PaymentSummaryCard label="Original expense amount" value={row.expenseAmount} />
            )}
          </section>

          <section className="expense-detail-card">
            <div>
              <span>Category</span>
              <strong>{row.category}</strong>
            </div>
            <div>
              <span>Date</span>
              <strong>{row.paymentDate}</strong>
            </div>
            {row.expenseFrequency && (
              <div>
                <span>Frequency</span>
                <strong>{row.expenseFrequency === "monthly" ? "Monthly" : row.expenseFrequency === "daily" ? "Daily" : "One-time"}</strong>
              </div>
            )}
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
          </section>
        </div>
      </div>
    </div>
  );
}

function PaymentSummaryCard({ label, tone, value }: { label: string; tone?: "danger" | "success"; value: number }) {
  return (
    <div className={`expense-summary-card ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{currency.format(value)}</strong>
    </div>
  );
}
