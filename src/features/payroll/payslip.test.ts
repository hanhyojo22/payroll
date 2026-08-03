import { describe, expect, it } from "vitest";
import type { PayrollRun, PayrollRunItem } from "../../types";
import { amountInWords, buildPayslipHtml, buildPayslipPdf, payrollPeriodLabel, payrollReference } from "./payslip";

const run: PayrollRun = {
  id: "run-1", user_id: "user-1", period_month: 8, period_year: 2026,
  pay_period: "second_half", generated_date: "2026-08-31", notes: "",
  created_at: "2026-08-31T00:00:00Z", updated_at: "2026-08-31T00:00:00Z",
};

const item: PayrollRunItem = {
  id: "abcdef12-0000-0000-0000-000000000000", user_id: "user-1", payroll_run_id: "run-1",
  employee_id: "employee-1", employee_name: "Ana <Admin>", position_id: "position-1",
  position_name: "Technician", pay_mode: "hybrid", base_pay: 5000, ticket_pay: 1200,
  ticket_details: [{ id: "detail-1", user_id: "user-1", payroll_run_item_id: "item-1", position_ticket_category_id: null, category_name: "Installation", ticket_count: 2, rate: 600, amount: 1200, created_at: "" }],
  installation_tickets: 2, repair_tickets: 0, installation_rate: 600, repair_rate: 0,
  nap_rehab_tickets: 0, nap_rehab_rate: 0, daily_rate: 0, days_worked: 0,
  total_working_days: 0, gross_pay: 6200, allowances: 300, deductions: 500,
  net_pay: 6000, status: "paid", paid_date: "2026-08-31",
  notes: "Government deduction: ₱300.00 | Employee advance deduction: ₱100.00 | Salary bond deduction: ₱100.00",
  created_at: "", updated_at: "",
};

describe("payslip", () => {
  it("builds stable payroll references and cutoff labels", () => {
    expect(payrollReference(run, item.id)).toBe("2026-08-2-ABCDEF12");
    expect(payrollPeriodLabel(run)).toBe("August 16-31, 2026");
  });

  it("renders stored earnings and escapes employee data", () => {
    const html = buildPayslipHtml({ department: "Field", employeeCode: "EMP-001", hireDate: "2025-05-12", item, payrollNo: "PAY-001", run });
    expect(html).toContain("Ana &lt;Admin&gt;");
    expect(html).not.toContain("Ana <Admin>");
    expect(html).toContain("JM SOLUTION IT SERVICES");
    expect(html).toContain('class="company-logo"');
    expect(html).toContain("1765 Yakal Street, Capitol Site, Cebu City");
    expect(html).toContain("@page { size: A4 portrait");
    expect(html).toContain("Date of Joining");
    expect(html).toContain("Base Salary and Closed Service Tickets");
    expect(html).toContain("Basic Salary");
    expect(html).toContain("SSS Contribution");
    expect(html).toContain("PhilHealth Contribution");
    expect(html).toContain("Pag-IBIG Contribution");
    expect(html).toContain("Withholding Tax");
    expect(html).toContain("Cash Advance");
    expect(html).toContain("Loan / Other Deductions");
    expect(html).toContain("Installation");
    expect(html).toContain("Repair");
    expect(html).toContain("NAP Rehab");
    expect(html).toContain("Holiday Pay");
    expect(html).toContain("Incentives / Bonus");
    expect(html).not.toContain("closed tickets ×");
    expect(html.match(/<table(?:\s|>)/g)).toHaveLength(1);
    expect(html).toContain("Six Thousand Pesos Only");
    expect(html).toContain("6,000.00");
    expect(html).toContain('class="net-pay-summary"');
    expect(html).toContain("Less: Total Deductions");
    expect(html).toContain(">NET PAY<");
    expect(html).toContain("Genalyn Restuaro");
    expect(html).toContain("/hr-manager-signature.png");
  });

  it("writes peso amounts in words", () => {
    expect(amountInWords(50_000)).toBe("Fifty Thousand Pesos Only");
    expect(amountInWords(1_250.5)).toBe("One Thousand Two Hundred Fifty Pesos and 50/100 Only");
  });

  it("uses the standard wage table instead of ticket rows for daily-wage employees", () => {
    const dailyItem: PayrollRunItem = {
      ...item,
      pay_mode: "daily",
      base_pay: 2_000,
      ticket_pay: 0,
      ticket_details: [],
      daily_rate: 800,
      days_worked: 2.5,
      total_working_days: 4,
      gross_pay: 2_000,
      allowances: 0,
      net_pay: 1_500,
      installation_tickets: 0,
      repair_tickets: 0,
      nap_rehab_tickets: 0,
    };
    const html = buildPayslipHtml({
      department: "Field",
      employeeCode: "EMP-001",
      item: dailyItem,
      payrollNo: "PAY-002",
      run,
    });
    expect(html).toContain("Basic Salary");
    expect(html).toContain("Overtime Pay");
    expect(html).toContain("Holiday Pay");
    expect(html).toContain("Night Differential");
    expect(html).toContain("Allowances");
    expect(html).toContain("Incentives / Bonus");
    expect(html).toContain("SSS Contribution");
    expect(html).toContain("PhilHealth Contribution");
    expect(html).toContain("Pag-IBIG Contribution");
    expect(html).toContain("Withholding Tax");
    expect(html).toContain("Cash Advance");
    expect(html).toContain("Loan / Other Deductions");
    expect(html).toContain("Gross Earnings");
    expect(html).toContain("Amount (₱)");
    expect(html).not.toContain("Installation");
    expect(html.match(/<table(?:\s|>)/g)).toHaveLength(1);
  });

  it("builds a downloadable PDF document", () => {
    const pdf = buildPayslipPdf({ department: "Field", employeeCode: "EMP-001", item, payrollNo: "PAY-001", run });
    expect(new TextDecoder().decode(pdf.slice(0, 8))).toBe("%PDF-1.4");
    expect(pdf.length).toBeGreaterThan(500);
  });
});
