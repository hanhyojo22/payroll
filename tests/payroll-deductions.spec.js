import { expect, test } from "playwright/test";

const baseURL = "http://127.0.0.1:4173";

test("payroll applies salary bond and employee advance deductions", async ({ page }) => {
  const stamp = Date.now();
  const adminEmail = `codex-payroll-${stamp}@example.com`;
  const adminPassword = "Codex123!";
  const positionName = `QA Fixed ${stamp}`;
  const employeeName = `QA Employee ${stamp}`;
  const expectedAdvanceBalance = "₱800.00";
  const expectedBondBalance = "₱300.00";
  const expectedDeduction = "₱950.00";

  await page.goto(baseURL, { waitUntil: "networkidle" });

  await ensureSignedIn(page, adminEmail, adminPassword);

  await page.goto(`${baseURL}/settings/payroll`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Payroll Settings" })).toBeVisible();
  await page.getByLabel("Government deduction cutoff").getByText("1st - 15th Payroll").click();
  await page.getByRole("button", { name: /save settings/i }).click();
  await expect(page.getByText("Payroll settings saved.")).toBeVisible();

  await page.goto(`${baseURL}/positions`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Positions" })).toBeVisible();
  await page.getByRole("button", { name: /add position/i }).click();
  await page.getByLabel("Position name").fill(positionName);
  await page.getByLabel("Pay method").selectOption({ label: "Fixed salary" });
  await page.getByLabel("Monthly base salary").fill("20000");
  await page.getByRole("button", { name: /^add position$/i }).last().click();
  await expect(page.getByText(positionName)).toBeVisible();

  await page.goto(`${baseURL}/employees`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Employees" })).toBeVisible();
  await page.getByRole("button", { name: /add employee/i }).click();
  await expect(page.getByRole("heading", { name: "Add New Employee" })).toBeVisible();
  await page.getByLabel("Full name").fill(employeeName);
  await page.getByLabel("Position").selectOption({ label: positionName });
  await page.getByLabel("Email address").fill(`employee-${stamp}@example.com`);
  await page.getByRole("tab", { name: "Government Deduction" }).click();
  await page.getByLabel("SSS").fill("200");
  await page.getByLabel("PhilHealth").fill("100");
  await page.getByLabel("Pag-IBIG").fill("100");
  await page.getByLabel("Withholding Tax").fill("50");
  await page.getByRole("button", { name: /add employee/i }).click();
  await expect(page.getByText(employeeName)).toBeVisible();

  await page.getByText(employeeName).click();
  await expect(page.getByText("Personal Info")).toBeVisible();

  await page.getByRole("tab", { name: "Employee Advances" }).click();
  await expect(page.getByText("Employee Advances")).toBeVisible();
  await page.getByLabel("Amount *").fill("1000");
  await page.getByLabel("Deduction Per Payroll *").fill("200");
  await page.getByLabel("Purpose").fill("QA advance");
  await page.getByRole("button", { name: /save advance/i }).click();
  await expect(page.getByText("Employee advance saved.")).toBeVisible();
  await expect(page.getByText("QA advance")).toBeVisible();

  await page.getByRole("tab", { name: "Salary Bond" }).click();
  await expect(page.getByRole("heading", { name: "Salary Bonds" })).toBeVisible();
  await page.getByRole("button", { name: /new bond/i }).click();
  await page.getByLabel("Target Amount *").fill("5000");
  await page.getByLabel("Deduction Per Payroll *").fill("300");
  await page.getByRole("button", { name: /save bond/i }).click();
  await expect(page.getByText("Salary bond created.")).toBeVisible();
  await expect(page.getByText(expectedBondBalance)).toBeVisible();

  await page.goto(`${baseURL}/payroll`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Payroll" })).toBeVisible();
  await page.getByRole("button", { name: /generate payroll/i }).click();
  await page.getByRole("button", { name: /^generate payroll$/i }).last().click();
  await expect(page.getByText("Payroll run generated.")).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(employeeName)).toBeVisible({ timeout: 30000 });

  const employeeRow = page.locator("tr", { hasText: employeeName }).first();
  await expect(employeeRow).toContainText(expectedDeduction);
  await expect(employeeRow).toContainText("Government deduction:");
  await expect(employeeRow).toContainText("Employee advance deduction:");
  await expect(employeeRow).toContainText("Salary bond deduction:");

  await page.goto(`${baseURL}/employees`, { waitUntil: "networkidle" });
  await page.getByText(employeeName).click();
  await page.getByRole("tab", { name: "Employee Advances" }).click();
  await expect(page.locator("tr", { hasText: "QA advance" }).first()).toContainText(expectedAdvanceBalance);
  await page.getByRole("tab", { name: "Salary Bond" }).click();
  await expect(page.locator("tr", { hasText: employeeName }).first()).toContainText(expectedBondBalance);
});

async function ensureSignedIn(page, email, password) {
  if (await page.getByRole("heading", { name: "Payroll System" }).count() === 0) {
    return;
  }

  await page.getByRole("button", { name: /create the admin account/i }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /create admin/i }).click();

  await page.waitForLoadState("networkidle");

  if (await page.getByRole("heading", { name: "Payroll System" }).count() > 0) {
    const useExisting = page.getByRole("button", { name: /use existing account/i });
    if (await useExisting.count()) {
      await useExisting.click();
    }
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
  }

  await expect(page.getByText("Dashboard")).toBeVisible({ timeout: 30000 });
}

