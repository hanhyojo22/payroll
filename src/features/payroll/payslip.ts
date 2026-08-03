import type { PayrollRun, PayrollRunItem } from "../../types";
import { currency, toNumber } from "../../shared/utils/currency";
import { monthNames } from "../../shared/utils/dates";
import { payrollReference } from "../../domain/payroll";

export { payrollReference };

export type PayslipInput = {
  department: string;
  employeeCode: string;
  governmentDeductions?: {
    pagibig: number;
    philhealth: number;
    sss: number;
    withholdingTax: number;
  };
  hireDate?: string;
  item: PayrollRunItem;
  payrollNo: string;
  run: PayrollRun;
};

const GOVERNMENT_DEDUCTION_PREFIX = "Government deduction:";
const EMPLOYEE_ADVANCE_PREFIX = "Employee advance deduction:";

function amountAfterPrefix(notes: string, prefix: string) {
  const segment = notes.split("|").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  const amount = segment?.slice(prefix.length).match(/[\d,]+(?:\.\d{1,2})?/);
  return amount ? toNumber(amount[0].replace(/,/g, "")) : 0;
}

function deductionBreakdown(item: PayrollRunItem) {
  const total = toNumber(item.deductions);
  const government = Math.min(total, amountAfterPrefix(item.notes || "", GOVERNMENT_DEDUCTION_PREFIX));
  const employeeAdvance = Math.min(Math.max(0, total - government), amountAfterPrefix(item.notes || "", EMPLOYEE_ADVANCE_PREFIX));
  return {
    employeeAdvance,
    government,
    other: Math.max(0, total - government - employeeAdvance),
    total,
  };
}

function compensationBasis(item: PayrollRunItem) {
  if (item.pay_mode === "fixed") return "Fixed Salary";
  if (item.pay_mode === "daily") return "Daily Wage";
  if (item.pay_mode === "hybrid") return "Base Salary and Closed Service Tickets";
  return "Closed Service Tickets";
}

function closedTicketDetails(item: PayrollRunItem) {
  const details = item.ticket_details ?? [];
  const groupedDetail = (label: string, matches: (name: string) => boolean, fallbackCount: number, fallbackRate: number) => {
    const matching = details.filter((detail) => matches(detail.category_name.toLowerCase()));
    if (matching.length === 0) {
      const count = toNumber(fallbackCount);
      const rate = toNumber(fallbackRate);
      return { label, count, rate, amount: count * rate };
    }
    const count = matching.reduce((sum, detail) => sum + toNumber(detail.ticket_count), 0);
    const amount = matching.reduce((sum, detail) => sum + toNumber(detail.amount), 0);
    return { label, count, rate: count > 0 ? amount / count : 0, amount };
  };
  return [
    groupedDetail("Installation", (name) => name.includes("install"), item.installation_tickets, item.installation_rate),
    groupedDetail("Repair", (name) => name.includes("repair") && !name.includes("rehab"), item.repair_tickets, item.repair_rate),
    groupedDetail("NAP Rehab", (name) => name.includes("nap") && name.includes("rehab"), item.nap_rehab_tickets, item.nap_rehab_rate),
  ];
}

function earningRows(item: PayrollRunItem) {
  const ticketDetails = closedTicketDetails(item);
  const rows: Array<{ amount: number; detail?: string; label: string }> = [];
  const grossPay = toNumber(item.gross_pay);
  const basePay = toNumber(item.base_pay);
  const ticketPay = toNumber(item.ticket_pay);

  if (item.pay_mode === "daily") {
    return [
      { label: "Basic Salary", amount: grossPay },
      { label: "Overtime Pay", amount: 0 },
      { label: "Holiday Pay", amount: 0 },
      { label: "Night Differential", amount: 0 },
      { label: "Allowances", amount: toNumber(item.allowances) },
      { label: "Incentives / Bonus", amount: 0 },
    ];
  } else if (item.pay_mode === "fixed" || item.pay_mode === "hybrid" || basePay > 0) {
    rows.push({ label: "Basic Salary", amount: basePay || (item.pay_mode === "fixed" ? grossPay : 0) });
  }

  const isTicketBased = item.pay_mode === "ticket" || item.pay_mode === "hybrid" || item.pay_mode === "legacy";
  if (isTicketBased) {
    ticketDetails.forEach((detail) => rows.push({ label: detail.label, amount: detail.amount }));
  }

  const categorizedTicketPay = ticketDetails.reduce((sum, detail) => sum + detail.amount, 0);
  const otherTicketPay = isTicketBased ? ticketPay - categorizedTicketPay : 0;
  if (isTicketBased && Math.abs(otherTicketPay) >= 0.01) rows.push({ label: "Other Closed Tickets", amount: otherTicketPay });

  const explainedGross = (basePay || (item.pay_mode === "fixed" ? grossPay : 0)) + ticketPay;
  const otherEarnings = grossPay - explainedGross;
  if (Math.abs(otherEarnings) >= 0.01) rows.push({ label: "Other Earnings", amount: otherEarnings });
  if (isTicketBased) rows.push({ label: "Holiday Pay", amount: 0 });
  rows.push({ label: "Allowance", amount: toNumber(item.allowances) });
  if (isTicketBased) rows.push({ label: "Incentives / Bonus", amount: 0 });
  return rows;
}

function deductionRows(input: PayslipInput, breakdown: ReturnType<typeof deductionBreakdown>) {
  const usesItemizedFormat = input.item.pay_mode === "daily" || input.item.pay_mode === "ticket" || input.item.pay_mode === "hybrid" || input.item.pay_mode === "legacy";
  if (!usesItemizedFormat) {
    return [
      { label: "Government Contributions", amount: breakdown.government },
      { label: "Employee Advance", amount: breakdown.employeeAdvance },
      { label: "Other Deductions", amount: breakdown.other },
    ];
  }
  const provided = input.governmentDeductions;
  const raw = [
    toNumber(provided?.sss),
    toNumber(provided?.philhealth),
    toNumber(provided?.pagibig),
    toNumber(provided?.withholdingTax),
  ];
  const rawTotal = raw.reduce((sum, amount) => sum + amount, 0);
  const government = rawTotal > 0
    ? raw.map((amount) => amount * breakdown.government / rawTotal)
    : [breakdown.government, 0, 0, 0];
  return [
    { label: "SSS Contribution", amount: government[0] },
    { label: "PhilHealth Contribution", amount: government[1] },
    { label: "Pag-IBIG Contribution", amount: government[2] },
    { label: "Withholding Tax", amount: government[3] },
    { label: "Cash Advance", amount: breakdown.employeeAdvance },
    { label: "Loan / Other Deductions", amount: breakdown.other },
  ];
}

const SMALL_NUMBERS = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function integerInWords(value: number): string {
  if (value < 20) return SMALL_NUMBERS[value];
  if (value < 100) return `${TENS[Math.floor(value / 10)]}${value % 10 ? ` ${SMALL_NUMBERS[value % 10]}` : ""}`;
  if (value < 1_000) return `${SMALL_NUMBERS[Math.floor(value / 100)]} Hundred${value % 100 ? ` ${integerInWords(value % 100)}` : ""}`;
  for (const [size, label] of [[1_000_000_000, "Billion"], [1_000_000, "Million"], [1_000, "Thousand"]] as const) {
    if (value >= size) {
      const remainder = value % size;
      return `${integerInWords(Math.floor(value / size))} ${label}${remainder ? ` ${integerInWords(remainder)}` : ""}`;
    }
  }
  return "Zero";
}

export function amountInWords(value: number) {
  const absolute = Math.max(0, toNumber(value));
  let pesos = Math.floor(absolute);
  let centavos = Math.round((absolute - pesos) * 100);
  if (centavos === 100) {
    pesos += 1;
    centavos = 0;
  }
  const pesoLabel = pesos === 1 ? "Peso" : "Pesos";
  return `${integerInWords(pesos)} ${pesoLabel}${centavos ? ` and ${String(centavos).padStart(2, "0")}/100` : ""} Only`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(dateKey: string | null, emptyLabel = "Not yet paid") {
  if (!dateKey) return emptyLabel;
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return dateKey;
  return new Intl.DateTimeFormat("en-PH", { day: "numeric", month: "long", year: "numeric" })
    .format(new Date(year, month - 1, day));
}

export function payrollPeriodLabel(run: Pick<PayrollRun, "period_month" | "period_year" | "pay_period">) {
  const startDay = run.pay_period === "first_half" ? 1 : 16;
  const endDay = run.pay_period === "first_half"
    ? 15
    : new Date(run.period_year, run.period_month, 0).getDate();
  return `${monthNames[run.period_month - 1]} ${startDay}-${endDay}, ${run.period_year}`;
}

function pdfSafe(value: string) {
  return value.normalize("NFKD").replace(/[^\x20-\x7E]/g, "?");
}

function pdfMoney(value: number) {
  return `PHP ${toNumber(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type PdfLogo = {
  height: number;
  hex: string;
  width: number;
};

function createTextPdf(lines: string[], logo?: PdfLogo, signature?: PdfLogo) {
  const encoder = new TextEncoder();
  const escapePdfText = (value: string) => pdfSafe(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const pageWidth = 612;
  const pageHeight = 842;
  const startX = 46;
  const startY = logo ? pageHeight - 116 : pageHeight - 48;
  const lineHeight = 15;
  const maxLinesPerPage = Math.floor((pageHeight - 92) / lineHeight);
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += maxLinesPerPage) {
    pages.push(lines.slice(index, index + maxLinesPerPage));
  }

  const objects: string[] = [];
  const addObject = (content: string) => {
    objects.push(content);
    return objects.length;
  };
  const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");
  const imageId = logo
    ? addObject(`<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${logo.hex.length + 1} >>\nstream\n${logo.hex}>\nendstream`)
    : null;
  const signatureId = signature
    ? addObject(`<< /Type /XObject /Subtype /Image /Width ${signature.width} /Height ${signature.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${signature.hex.length + 1} >>\nstream\n${signature.hex}>\nendstream`)
    : null;
  const contentIds = pages.map((pageLines, pageIndex) => {
    const aspectRatio = logo ? logo.width / logo.height : 1;
    const logoHeight = 50;
    const logoWidth = logoHeight * aspectRatio;
    const logoX = (pageWidth - logoWidth) / 2;
    const signatureLineIndex = pageLines.findIndex((line) => line.startsWith("____________________________"));
    const signatureHeight = 32;
    const signatureWidth = signature ? signatureHeight * signature.width / signature.height : 0;
    const signatureY = signatureLineIndex >= 0 ? startY - signatureLineIndex * lineHeight + 4 : 0;
    const text = [
      ...(imageId && pageIndex === 0 ? [`q ${logoWidth.toFixed(2)} 0 0 ${logoHeight} ${logoX.toFixed(2)} 776 cm /Im1 Do Q`] : []),
      ...(signatureId && signatureLineIndex >= 0 ? [`q ${signatureWidth.toFixed(2)} 0 0 ${signatureHeight} 102 ${signatureY.toFixed(2)} cm /Sig1 Do Q`] : []),
      "BT", "/F1 10 Tf", `${startX} ${startY} Td`,
      ...pageLines.flatMap((line, index) => index === 0
        ? [`(${escapePdfText(line)}) Tj`]
        : [`0 -${lineHeight} Td`, `(${escapePdfText(line)}) Tj`]),
      "ET",
    ].join("\n");
    return addObject(`<< /Length ${encoder.encode(text).length} >>\nstream\n${text}\nendstream`);
  });
  const pageIds = contentIds.map((contentId) =>
    addObject(`<< /Type /Page /Parent PAGES_ID 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R >>${imageId || signatureId ? ` /XObject <<${imageId ? ` /Im1 ${imageId} 0 R` : ""}${signatureId ? ` /Sig1 ${signatureId} 0 R` : ""} >>` : ""} >> /Contents ${contentId} 0 R >>`),
  );
  const pagesId = addObject(`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`);
  pageIds.forEach((id) => {
    objects[id - 1] = objects[id - 1].replace("PAGES_ID", String(pagesId));
  });
  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(encoder.encode(pdf).length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = encoder.encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return encoder.encode(pdf);
}

export function buildPayslipPdf(input: PayslipInput, logo?: PdfLogo, signature?: PdfLogo) {
  const { department, employeeCode, hireDate, item, payrollNo, run } = input;
  const breakdown = deductionBreakdown(item);
  const earnings = earningRows(item);
  const deductions = deductionRows(input, breakdown);
  const rowCount = Math.max(earnings.length, deductions.length);
  const totalEarnings = toNumber(item.gross_pay) + toNumber(item.allowances);
  const totalDeductions = breakdown.total;
  const divider = "-".repeat(82);
  const lines = [
    "                              JM SOLUTION IT SERVICES",
    "                    1765 Yakal Street, Capitol Site, Cebu City",
    "",
    divider,
    `Date of Joining    : ${formatDate(hireDate || null, "Not provided")}`,
    `Employee Name     : ${item.employee_name}`,
    `Pay Period         : ${payrollPeriodLabel(run)}`,
    `Position          : ${item.position_name || "Unassigned"}`,
    `Payment Date       : ${formatDate(item.paid_date)}`,
    `Employee ID       : ${employeeCode}`,
    `Compensation Basis : ${compensationBasis(item)}`,
    `Department        : ${department || "Unassigned"}`,
    divider,
    "EARNINGS                                  DEDUCTIONS",
    ...Array.from({ length: rowCount }, (_, index) => {
      const earning = earnings[index];
      const deduction = deductions[index];
      const pdfDetail = earning?.detail
        ?.replace("closed tickets", "tickets")
        .replace("closed ticket", "ticket")
        .replace("×", "x")
        .replace(/₱/g, "PHP ");
      const earningLabel = earning ? `${earning.label}${pdfDetail ? ` (${pdfDetail})` : ""}` : "";
      return `${earningLabel.slice(0, 31).padEnd(31)} ${(earning ? pdfMoney(earning.amount) : "").padEnd(17)} ${(deduction?.label ?? "").slice(0, 24).padEnd(24)} ${deduction ? pdfMoney(deduction.amount) : ""}`;
    }),
    divider,
    `${(item.pay_mode === "daily" ? "GROSS EARNINGS" : "TOTAL EARNINGS").padEnd(29)} ${pdfMoney(totalEarnings).padEnd(18)} TOTAL DEDUCTIONS          ${pdfMoney(totalDeductions)}`,
    divider,
    "",
    `${"GROSS EARNINGS".padEnd(48)} ${pdfMoney(totalEarnings)}`,
    `${"LESS: TOTAL DEDUCTIONS".padEnd(48)} ${pdfMoney(totalDeductions)}`,
    `${"NET PAY".padEnd(48)} ${pdfMoney(item.net_pay)}`,
    "",
    `                         ${amountInWords(item.net_pay)}`,
    "", "", "", "",
    "Genalyn Restuaro",
    "____________________________          ____________________________",
    "HR Manager                              Employee Signature",
    "Authorized Representative",
    "",
    `Payroll reference: ${payrollNo}`,
  ];
  return createTextPdf(lines, logo, signature);
}

async function loadImageForPdf(path: string, trimTransparent = false): Promise<PdfLogo> {
  const image = new Image();
  image.src = path;
  await image.decode();
  const source = document.createElement("canvas");
  source.width = image.naturalWidth;
  source.height = image.naturalHeight;
  const sourceContext = source.getContext("2d");
  if (!sourceContext) throw new Error("Unable to prepare the image.");
  sourceContext.drawImage(image, 0, 0);
  let bounds = { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight };
  if (trimTransparent) {
    const pixels = sourceContext.getImageData(0, 0, source.width, source.height).data;
    let minX = source.width;
    let minY = source.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        if (pixels[(y * source.width + x) * 4 + 3] <= 8) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (maxX >= minX && maxY >= minY) {
      const padding = 4;
      const x = Math.max(0, minX - padding);
      const y = Math.max(0, minY - padding);
      bounds = {
        x,
        y,
        width: Math.min(source.width, maxX + padding + 1) - x,
        height: Math.min(source.height, maxY + padding + 1) - y,
      };
    }
  }
  const scale = Math.min(1, 300 / Math.max(bounds.width, bounds.height));
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to prepare the company logo.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, width, height);
  const binary = atob(canvas.toDataURL("image/jpeg", 0.92).split(",")[1]);
  let hex = "";
  for (let index = 0; index < binary.length; index += 1) {
    hex += binary.charCodeAt(index).toString(16).padStart(2, "0");
  }
  return { height, hex, width };
}

export async function downloadPayslipPdf(input: PayslipInput) {
  const [logo, signature] = await Promise.all([
    loadImageForPdf("/logo.png").catch(() => undefined),
    loadImageForPdf("/hr-manager-signature.png", true).catch(() => undefined),
  ]);
  const blob = new Blob([buildPayslipPdf(input, logo, signature)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `payslip-${input.payrollNo.toLowerCase()}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function buildPayslipHtml(input: PayslipInput) {
  const { department, employeeCode, hireDate, item, payrollNo, run } = input;
  const allowances = toNumber(item.allowances);
  const grossPay = toNumber(item.gross_pay);
  const netPay = toNumber(item.net_pay);
  const breakdown = deductionBreakdown(item);
  const earnings = earningRows(item);
  const deductions = deductionRows(input, breakdown);
  const rowCount = Math.max(earnings.length, deductions.length);
  const totalEarnings = grossPay + allowances;
  const totalDeductions = breakdown.total;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Payslip ${escapeHtml(payrollNo)}</title>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; color: #111; font-family: Arial, Helvetica, sans-serif; background: #eef1f4; }
      .sheet { width: 194mm; min-height: 273mm; margin: 8mm auto; padding: 12mm 11mm 9mm; background: white; }
      header { text-align: center; }
      .company-logo { display: block; width: 150px; height: 42px; object-fit: contain; margin: 0 auto 7px; }
      h1, p { margin: 0; }
      h1 { font-size: 16px; font-weight: 700; }
      header p { margin-top: 5px; font-size: 10px; }
      .details { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 24px 2px 18px; }
      .detail-column { display: grid; align-content: start; gap: 7px; }
      .detail { display: grid; grid-template-columns: 103px 8px minmax(0, 1fr); font-size: 9.5px; line-height: 1.3; }
      .detail .label { font-weight: 700; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      th, td { border: 1px solid #555; font-size: 9.5px; padding: 4px 5px; }
      th { background: #dce9f4; font-weight: 700; text-align: center; text-transform: uppercase; }
      td.amount { text-align: right; }
      tr.total td { background: #dce9f4; font-weight: 700; }
      .earning-detail { display: block; color: #444; font-size: 8px; margin-top: 2px; }
      .net-pay-summary { display: grid; grid-template-columns: 1fr 128px; margin-top: 18px; width: 100%; border: 1px solid #77818a; font-size: 9.5px; }
      .net-pay-summary > div { min-height: 24px; padding: 5px 8px; border-bottom: 1px solid #77818a; }
      .net-pay-summary > div:nth-child(odd) { border-right: 1px solid #77818a; }
      .net-pay-summary > div:nth-last-child(-n + 2) { border-bottom: 0; }
      .net-pay-summary .summary-header { background: #dce9f4; font-weight: 700; text-align: center; text-transform: uppercase; }
      .net-pay-summary .summary-amount { text-align: right; }
      .net-pay-summary .net-total { background: #dce9f4; font-weight: 700; }
      .net-pay-words { margin-top: 10px; text-align: center; font-size: 11px; font-weight: 700; }
      .signatures { display: grid; grid-template-columns: 155px 155px; justify-content: space-between; margin: 58px 8px 0; }
      .signature { font-size: 11px; text-align: center; }
      .signature-image-frame, .signature-spacer { height: 47px; }
      .signature-image-frame { position: relative; overflow: hidden; }
      .signature-image { position: absolute; top: -71px; left: 53px; width: 74px; height: auto; }
      .signature-name { display: block; height: 15px; line-height: 15px; }
      .signature-line { border-top: 1px solid #111; margin: 0 0 8px; }
      .signature strong, .signature span { display: block; }
      .signature span { margin-top: 4px; }
      footer { color: #666; font-size: 8px; margin-top: 22px; text-align: right; }
      @page { size: A4 portrait; margin: 8mm; }
      @media print { body { background: white; } .sheet { width: auto; min-height: 0; margin: 0; padding: 4mm 5mm; } }
    </style>
  </head>
  <body>
    <main class="sheet">
      <header>
        <img class="company-logo" src="/logo.png" alt="JM Solution IT Services logo" />
        <h1>JM SOLUTION IT SERVICES</h1>
        <p>1765 Yakal Street, Capitol Site, Cebu City</p>
      </header>
      <section class="details">
        <div class="detail-column">
          <div class="detail"><span class="label">Date of Joining</span><span>:</span><span>${escapeHtml(formatDate(hireDate || null, "Not provided"))}</span></div>
          <div class="detail"><span class="label">Pay Period</span><span>:</span><span>${escapeHtml(payrollPeriodLabel(run))}</span></div>
          <div class="detail"><span class="label">Payment Date</span><span>:</span><span>${escapeHtml(formatDate(item.paid_date))}</span></div>
          <div class="detail"><span class="label">Compensation Basis</span><span>:</span><span>${escapeHtml(compensationBasis(item))}</span></div>
        </div>
        <div class="detail-column">
          <div class="detail"><span class="label">Employee Name</span><span>:</span><span>${escapeHtml(item.employee_name)}</span></div>
          <div class="detail"><span class="label">Position</span><span>:</span><span>${escapeHtml(item.position_name || "Unassigned")}</span></div>
          <div class="detail"><span class="label">Employee ID</span><span>:</span><span>${escapeHtml(employeeCode)}</span></div>
          <div class="detail"><span class="label">Department</span><span>:</span><span>${escapeHtml(department || "Unassigned")}</span></div>
        </div>
      </section>
      <table>
        <thead><tr><th>Earnings</th><th>Amount (₱)</th><th>Deductions</th><th>Amount (₱)</th></tr></thead>
        <tbody>
          ${Array.from({ length: rowCount }, (_, index) => {
            const earning = earnings[index];
            const deduction = deductions[index];
            return `<tr><td>${earning ? `${escapeHtml(earning.label)}${earning.detail ? `<small class="earning-detail">${escapeHtml(earning.detail)}</small>` : ""}` : ""}</td><td class="amount">${earning ? escapeHtml(currency.format(earning.amount)) : ""}</td><td>${deduction ? escapeHtml(deduction.label) : ""}</td><td class="amount">${deduction ? escapeHtml(currency.format(deduction.amount)) : ""}</td></tr>`;
          }).join("")}
          <tr class="total">
            <td>${item.pay_mode === "daily" ? "Gross Earnings" : "Total Earnings"}</td><td class="amount">${escapeHtml(currency.format(totalEarnings))}</td>
            <td>Total Deductions</td><td class="amount">${escapeHtml(currency.format(totalDeductions))}</td>
          </tr>
        </tbody>
      </table>
      <section class="net-pay-summary">
        <div class="summary-header"></div><div class="summary-header">Amount (₱)</div>
        <div>Gross Earnings</div><div class="summary-amount">${escapeHtml(currency.format(totalEarnings))}</div>
        <div>Less: Total Deductions</div><div class="summary-amount">${escapeHtml(currency.format(totalDeductions))}</div>
        <div class="net-total">NET PAY</div><div class="net-total summary-amount">${escapeHtml(currency.format(netPay))}</div>
      </section>
      <div class="net-pay-words">${escapeHtml(amountInWords(netPay))}</div>
      <section class="signatures">
        <div class="signature"><div class="signature-image-frame"><img class="signature-image" src="/hr-manager-signature.png" alt="Genalyn Restuaro signature" /></div><strong class="signature-name">Genalyn Restuaro</strong><div class="signature-line"></div><span>HR Manager</span><span>Authorized Representative</span></div>
        <div class="signature"><div class="signature-spacer"></div><span class="signature-name">&nbsp;</span><div class="signature-line"></div><span>Employee Signature</span></div>
      </section>
      <footer>Payroll reference: ${escapeHtml(payrollNo)}</footer>
    </main>
  </body>
</html>`;
}

export function openPayslipPrint(input: PayslipInput) {
  const popup = window.open("", "_blank", "width=960,height=760");
  if (!popup) return false;
  popup.opener = null;
  popup.document.write(buildPayslipHtml(input));
  popup.document.close();
  let printStarted = false;
  const startPrint = () => {
    if (printStarted) return;
    printStarted = true;
    popup.focus();
    popup.print();
  };
  const images = Array.from(popup.document.querySelectorAll<HTMLImageElement>("img"));
  if (images.every((image) => image.complete)) {
    window.setTimeout(startPrint, 250);
  } else {
    Promise.all(images.map((image) => image.complete
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        }))).then(startPrint);
    window.setTimeout(startPrint, 1_500);
  }
  return true;
}
