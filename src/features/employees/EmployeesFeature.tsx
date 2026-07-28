import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowLeft,
  BadgeDollarSign,
  BadgeInfo,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  FileText,
  Heart,
  LayoutDashboard,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Save,
  Upload,
  UserRound,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import { supabase } from "../../supabase";
import { loadEmployeePayrollRuns } from "../../app/resources";
import { isOfflineLikeError } from "../../lib/offlineSync";
import { DataTable } from "../../shared/components/DataTable";
import { Modal, FormActions, TextField, PasswordField, RequiredMark } from "../../shared/components/FormLayout";
import { MoneyField as MoneyInput } from "../../shared/components/MoneyField";
import { StatusBadge as StatusPill } from "../../shared/components/StatusBadge";
import { PageHeader, RecordTitle, Toolbar } from "../../shared/components/PageLayout";
import { Spinner } from "../../shared/components/Spinner";
import { NotificationService } from "../../shared/notifications/NotificationService";
import { currency, toNumber } from "../../shared/utils/currency";
import { todayKey, monthNames } from "../../shared/utils/dates";
import { friendlyError } from "../../shared/utils/errors";
import { formatPhoneNumber, normalizePhoneDigits } from "../../shared/utils/phone";
import { computeDailyEarnings, formatTime } from "../../domain/attendance";
import { governmentDeductionForEmployee, payPeriodLabel } from "../../domain/payroll";
import { salaryBondBalance } from "../../domain/salaryBonds";
import { normalizeTicketCount } from "../../domain/tickets";
import { EmployeeAdvancesFeature } from "../payroll/EmployeeAdvancesFeature";
import { SalaryBondsFeature } from "../salaryBonds/SalaryBondsFeature";
import type { QueueOfflineMutation } from "../../shared/types";
import type {
  AttendanceEntry,
  DailyTicketEntry,
  Employee,
  EmployeeAdvance,
  EmployeeFormValues,
  PayrollRunWithItems,
  Position,
  SalaryBond,
} from "../../types";

const emptyEmployee: EmployeeFormValues = {
  full_name: "",
  role: "",
  position_id: "",
  department: "",
  contact_number: "",
  email: "",
  address: "",
  profile_photo_url: "",
  hire_date: todayKey(),
  date_of_birth: "",
  status: "active",
  wage_category: "new",
  gender: "",
  civil_status: "",
  monthly_salary: "",
  sss_number: "",
  philhealth_number: "",
  pagibig_number: "",
  sss_deduction: "",
  philhealth_deduction: "",
  pagibig_deduction: "",
  withholding_tax: "",
  tin_number: "",
  emergency_contact_name: "",
  emergency_contact_number: "",
  emergency_contact_relation: "",
  notes: "",
};

export function EmployeesView({
  employees,
  initialDetailsEmployeeId,
  initialDetailsEmployeeNonce = 0,
  mode = "list",
  onChange,
  onClearInitialDetailsEmployee,
  onDetailsOpenChange,
  onExitForm,
  onLocalEmployeesChange,
  onQueueOfflineMutation,
  payrollRuns,
  positions,
  employeeAdvances,
  salaryBonds,
  userId,
}: {
  employees: Employee[];
  initialDetailsEmployeeId?: string | null;
  initialDetailsEmployeeNonce?: number;
  mode?: "list" | "add";
  onChange: () => Promise<void>;
  onClearInitialDetailsEmployee?: () => void;
  onDetailsOpenChange?: (open: boolean) => void;
  onExitForm?: () => void;
  onLocalEmployeesChange: (employees: Employee[]) => void;
  onQueueOfflineMutation: QueueOfflineMutation;
  payrollRuns: PayrollRunWithItems[];
  positions: Position[];
  employeeAdvances: EmployeeAdvance[];
  salaryBonds: SalaryBond[];
  userId: string;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("active");
  const [editing, setEditing] = useState<Employee | null>(null);
  const [formOpen, setFormOpen] = useState(mode === "add");
  const [detailsEmployee, setDetailsEmployee] = useState<Employee | null>(null);

  useEffect(() => {
    onDetailsOpenChange?.(Boolean(detailsEmployee));
  }, [detailsEmployee, onDetailsOpenChange]);

  useEffect(() => {
    if (mode === "add") {
      setEditing(null);
      setFormOpen(true);
    }
  }, [mode]);

  useEffect(() => {
    if (!initialDetailsEmployeeId) return;
    const employee = employees.find((item) => item.id === initialDetailsEmployeeId);
    if (!employee) return;
    setFormOpen(false);
    setEditing(null);
    setDetailsEmployee(employee);
    onClearInitialDetailsEmployee?.();
  }, [employees, initialDetailsEmployeeId, initialDetailsEmployeeNonce, onClearInitialDetailsEmployee]);

  function closeForm() {
    setEditing(null);
    setFormOpen(false);
    onExitForm?.();
  }

  const rows = employees.filter((employee) => {
    const matchesQuery = `${employee.full_name} ${employee.role} ${employee.department} ${employee.email}`
      .toLowerCase()
      .includes(query.toLowerCase());
    const matchesStatus = statusFilter === "all" || employee.status === statusFilter;
    return matchesQuery && matchesStatus;
  });
  const totalEmployees = employees.length;
  const activeEmployees = employees.filter((employee) => employee.status === "active").length;
  const inactiveEmployees = employees.filter((employee) => employee.status === "inactive").length;
  const employeesOnLeave = 0;
  const employeeNumberMap = useMemo(() => {
    const sorted = [...employees].sort((a, b) => a.created_at.localeCompare(b.created_at));
    return new Map(sorted.map((e, i) => [e.id, String(i + 1).padStart(3, "0")]));
  }, [employees]);
  const employeeCodeFor = (employee: Employee) => `EMP-${employeeNumberMap.get(employee.id) ?? "000"}`;
  const employeeInitialsFor = (employee: Employee) => employee.full_name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "E";
  const formatHireDate = (employee: Employee) => {
    if (!employee.hire_date) return "—";
    const [y, m, d] = employee.hire_date.split("-").map(Number);
    const abbr = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
    return `${abbr} ${d}, ${y}`;
  };

  if (detailsEmployee) {
    return (
      <EmployeeDetailsView
        employee={detailsEmployee}
        onChange={onChange}
        onBack={() => setDetailsEmployee(null)}
        onEdit={(emp) => { setEditing(emp); setFormOpen(true); setDetailsEmployee(null); }}
        onEmployeeUpdate={setDetailsEmployee}
        onQueueOfflineMutation={onQueueOfflineMutation}
        payrollRuns={payrollRuns}
        positions={positions}
        employeeAdvances={employeeAdvances}
        salaryBonds={salaryBonds}
        userId={userId}
      />
    );
  }

  if (formOpen) {
    return (
      <EmployeeForm
        embedded
        initial={editing}
        onClose={closeForm}
        onSubmit={saveEmployee}
        positions={positions}
      />
    );
  }

  async function saveEmployee(values: EmployeeFormValues) {
    if (!supabase) return;
    const selectedPosition = positions.find((position) => position.id === values.position_id && position.status === "active");
    if (!selectedPosition) {
      NotificationService.showError("Select an active position before saving this employee.");
      return;
    }
    for (const [field, label] of [["contact_number", "Contact number"], ["emergency_contact_number", "Emergency contact number"]] as const) {
      const digits = values[field];
      if (digits && digits.length !== 10) {
        NotificationService.showError(`${label} must be a valid 10-digit Philippine mobile number.`);
        return;
      }
    }
    const payload = {
      ...(editing ? {} : { id: crypto.randomUUID() }),
      full_name: values.full_name.trim(),
      role: selectedPosition.name,
      position_id: selectedPosition.id,
      department: selectedPosition.department,
      contact_number: values.contact_number.trim(),
      email: values.email.trim(),
      address: values.address.trim(),
      profile_photo_url: values.profile_photo_url,
      hire_date: values.hire_date || null,
      date_of_birth: values.date_of_birth || null,
      status: values.status,
      wage_category: values.wage_category,
      monthly_salary: (selectedPosition.pay_mode === "fixed" || selectedPosition.pay_mode === "hybrid")
        ? toNumber(selectedPosition.monthly_base_salary)
        : 0,
      sss_number: values.sss_number.trim(),
      philhealth_number: values.philhealth_number.trim(),
      pagibig_number: values.pagibig_number.trim(),
      sss_deduction: toNumber(values.sss_deduction),
      philhealth_deduction: toNumber(values.philhealth_deduction),
      pagibig_deduction: toNumber(values.pagibig_deduction),
      withholding_tax: toNumber(values.withholding_tax),
      tin_number: values.tin_number.trim(),
      gender: values.gender,
      civil_status: values.civil_status,
      emergency_contact_name: values.emergency_contact_name.trim(),
      emergency_contact_number: values.emergency_contact_number.trim(),
      emergency_contact_relation: values.emergency_contact_relation.trim(),
      notes: values.notes.trim(),
      user_id: userId,
    };
    const optimisticEmployee = {
      ...(editing ?? {}),
      ...payload,
      id: editing?.id ?? payload.id,
      created_at: editing?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as Employee;

    if (!navigator.onLine) {
      onLocalEmployeesChange(
        editing
          ? employees.map((employee) => employee.id === editing.id ? optimisticEmployee : employee)
          : [optimisticEmployee, ...employees],
      );
      await onQueueOfflineMutation({
        resource: "employees",
        affectedResources: ["employees", "dashboardSummary"],
        operation: editing ? "update" : "insert",
        table: "employees",
        recordId: editing?.id,
        payload,
      });
      NotificationService.showSuccess("Employee saved locally. It will sync when online.");
      closeForm();
      return;
    }

    onLocalEmployeesChange(
      editing
        ? employees.map((employee) => employee.id === editing.id ? optimisticEmployee : employee)
        : [optimisticEmployee, ...employees],
    );

    const result = editing
      ? await supabase.from("employees").update(payload).eq("id", editing.id)
      : await supabase.from("employees").insert(payload);

    if (result.error) {
      if (isOfflineLikeError(result.error)) {
        await onQueueOfflineMutation({
          resource: "employees",
          affectedResources: ["employees", "dashboardSummary"],
          operation: editing ? "update" : "insert",
          table: "employees",
          recordId: editing?.id,
          payload,
        });
        closeForm();
        return;
      }
      onLocalEmployeesChange(employees);
      NotificationService.showError(friendlyError(result.error));
      return;
    }
    NotificationService.showSuccess("Employee saved.");
    closeForm();
    await onChange();
  }

  return (
    <div className="page-stack">
      <PageHeader
        action={
          <button className="primary-button compact employee-add-button" onClick={() => { setEditing(null); setFormOpen(true); }} type="button">
            <Plus size={16} />
            Add employee
          </button>
        }
        eyebrow="HR profiles"
        title="Employees"
        text="Maintain active staff profiles and ticket wage settings."
      />
      <section className="metric-grid employee-summary-grid">
        <Metric helperText="All active employees" icon={<Users size={18} />} label="Total employees" value={totalEmployees} />
        <Metric helperText="Current Active" icon={<UserRound size={18} />} label="Active employees" tone="success" value={activeEmployees} />
        <Metric helperText="On Leave" icon={<CalendarClock size={18} />} label="On leave" tone="warning" value={employeesOnLeave} />
        <Metric helperText="No Longer Active" icon={<BadgeInfo size={18} />} label="Inactive" tone="danger" value={inactiveEmployees} />
      </section>
      <section className="panel employee-list-panel">
        <Toolbar query={query} setQuery={setQuery}>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
            <option value="all">All employees</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </Toolbar>
        <DataTable
          empty="No employees yet."
          headers={["No.", "Employee ID", "Employee", "Department", "Position", "Date Hired", "Status"]}
          onRowClick={(index) => setDetailsEmployee(rows[index])}
          rows={rows.map((employee, index) => [
            index + 1,
            employeeCodeFor(employee),
            <div className="employee-list-identity" key="title">
              <div className="employee-list-avatar">
                {employee.profile_photo_url ? <img alt="" src={employee.profile_photo_url} /> : <span>{employeeInitialsFor(employee)}</span>}
              </div>
              <RecordTitle title={employee.full_name} notes={employee.email || "No email"} />
            </div>,
            employee.department || "Unassigned",
            employee.role || "Unassigned",
            formatHireDate(employee),
            <span className={employee.status === "active" ? "emp-status-pill active" : "emp-status-pill inactive"} key="status">
              {employee.status === "active" ? "Active" : "Inactive"}
            </span>,
          ])}
        />
        <EmployeeMobileCardList
          employeeCodeFor={employeeCodeFor}
          employeeInitialsFor={employeeInitialsFor}
          employees={rows}
          formatHireDate={formatHireDate}
          onOpenDetails={setDetailsEmployee}
        />
      </section>
      {formOpen && (
        <EmployeeForm
          initial={editing}
          onClose={closeForm}
          onSubmit={saveEmployee}
          positions={positions}
        />
      )}
    </div>
  );
}

function EmployeeMobileCardList({
  employees,
  employeeCodeFor,
  employeeInitialsFor,
  formatHireDate,
  onOpenDetails,
}: {
  employees: Employee[];
  employeeCodeFor: (employee: Employee) => string;
  employeeInitialsFor: (employee: Employee) => string;
  formatHireDate: (employee: Employee) => string;
  onOpenDetails: (employee: Employee) => void;
}) {
  if (employees.length === 0) {
    return (
      <div className="emp-mobile-list">
        <p className="emp-mobile-empty">No employees yet.</p>
      </div>
    );
  }
  return (
    <div className="emp-mobile-list">
      {employees.map((employee, index) => (
        <div
          className="emp-mobile-card"
          key={employee.id}
          onClick={() => onOpenDetails(employee)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onOpenDetails(employee);
            }
          }}
          role="button"
          tabIndex={0}
        >
          <span className="emp-mobile-card-index">{index + 1}</span>
          <div className="employee-list-avatar">
            {employee.profile_photo_url
              ? <img alt="" src={employee.profile_photo_url} />
              : <span>{employeeInitialsFor(employee)}</span>}
          </div>
          <div className="emp-mobile-card-main">
            <strong className="emp-mobile-card-name">{employee.full_name}</strong>
            <span className="emp-mobile-card-email">{employee.email || "No email"}</span>
            <div className="emp-mobile-card-badges">
              <span className="emp-mobile-card-badge">{employee.department || "Unassigned"}</span>
              <span className="emp-mobile-card-badge">{employee.role || "Unassigned"}</span>
            </div>
          </div>
          <div className="emp-mobile-card-side">
            <span className="emp-mobile-card-date">{formatHireDate(employee)}</span>
            <span className={employee.status === "active" ? "emp-status-pill active" : "emp-status-pill inactive"}>
              {employee.status === "active" ? "Active" : "Inactive"}
            </span>
          </div>
          <ChevronRight className="emp-mobile-card-chevron" size={18} />
        </div>
      ))}
    </div>
  );
}

export function EmployeeDetailsView({
  employee,
  onChange,
  onBack,
  onEdit,
  onEmployeeUpdate,
  onQueueOfflineMutation,
  payrollRuns,
  positions,
  employeeAdvances,
  salaryBonds,
  userId,
}: {
  employee: Employee;
  onChange: () => Promise<void>;
  onBack: () => void;
  onEdit: (employee: Employee) => void;
  onEmployeeUpdate: (employee: Employee) => void;
  onQueueOfflineMutation: QueueOfflineMutation;
  payrollRuns: PayrollRunWithItems[];
  positions: Position[];
  employeeAdvances: EmployeeAdvance[];
  salaryBonds: SalaryBond[];
  userId: string;
}) {
  const [activeTab, setActiveTab] = useState<"information" | "payroll" | "tickets" | "employee-advances" | "salary-bond" | "payments" | "documents" | "government-deduction" | "attendance">("information");
  const [currentEmployee, setCurrentEmployee] = useState(employee);
  const [employeePayrollRuns, setEmployeePayrollRuns] = useState<PayrollRunWithItems[]>([]);
  const [editingRate, setEditingRate] = useState<"installation" | "repair" | null>(null);
  const [rateDrafts, setRateDrafts] = useState({ installation: "", repair: "" });
  const [empAttendance, setEmpAttendance] = useState<AttendanceEntry[]>([]);
  const [empTickets, setEmpTickets] = useState<DailyTicketEntry[]>([]);
  const [empAttendanceLoading, setEmpAttendanceLoading] = useState(false);
  const [empAttendancePage, setEmpAttendancePage] = useState(1);

  useEffect(() => {
    setCurrentEmployee(employee);
  }, [employee]);

  useEffect(() => {
    setRateDrafts({
      installation: String(toNumber(currentEmployee.installation_rate)),
      repair: String(toNumber(currentEmployee.repair_rate)),
    });
  }, [currentEmployee]);

  useEffect(() => {
    if (!supabase) return;

    loadEmployeePayrollRuns(supabase, currentEmployee.id).then((result) => {
      if (result.error) {
        NotificationService.showError(friendlyError(result.error));
        return;
      }
      setEmployeePayrollRuns(result.data);
    });
  }, [currentEmployee.id]);

  useEffect(() => {
    if (activeTab !== "attendance" || !supabase) return;
    setEmpAttendancePage(1);
    setEmpAttendanceLoading(true);
    const pos = positions.find((p) => p.id === currentEmployee.position_id);
    const isTicket = pos?.pay_mode === "ticket" || pos?.pay_mode === "hybrid";
    if (isTicket) {
      supabase
        .from("daily_ticket_entries")
        .select("id,user_id,employee_id,employee_name,position_id,position_name,entry_date,installation_tickets,repair_tickets,disputed_install,disputed_repair,installation_rate,repair_rate,nap_rehab_tickets,nap_rehab_rate,created_at,updated_at,details:daily_ticket_entry_items(id,user_id,daily_ticket_entry_id,position_ticket_category_id,category_name,ticket_count,rate,created_at)")
        .eq("employee_id", currentEmployee.id)
        .order("entry_date", { ascending: false })
        .limit(200)
        .then(({ data, error }) => {
          if (!error) setEmpTickets((data ?? []) as DailyTicketEntry[]);
          setEmpAttendanceLoading(false);
        });
    } else {
      supabase
        .from("attendance_entries")
        .select("id,user_id,employee_id,employee_name,position_id,position_name,entry_date,status,time_in,time_out,created_at,updated_at")
        .eq("employee_id", currentEmployee.id)
        .order("entry_date", { ascending: false })
        .limit(200)
        .then(({ data, error }) => {
          if (!error) setEmpAttendance((data ?? []) as AttendanceEntry[]);
          setEmpAttendanceLoading(false);
        });
    }
  }, [activeTab, currentEmployee.id, currentEmployee.position_id]);

  async function saveTicketRate(type: "installation" | "repair") {
    if (!supabase) return;
    const value = Math.max(0, toNumber(rateDrafts[type]));
    const column = type === "installation" ? "installation_rate" : "repair_rate";
    if (!navigator.onLine) {
      const nextEmployee = { ...currentEmployee, [column]: value, updated_at: new Date().toISOString() };
      setCurrentEmployee(nextEmployee);
      onEmployeeUpdate(nextEmployee);
      setEditingRate(null);
      await onQueueOfflineMutation({
        resource: "employees",
        affectedResources: ["employees", "dashboardSummary"],
        operation: "update",
        table: "employees",
        recordId: currentEmployee.id,
        payload: { [column]: value },
      });
      return;
    }
    const { data, error } = await supabase
      .from("employees")
      .update({ [column]: value })
      .eq("id", currentEmployee.id)
      .select()
      .single();

    if (error) {
      if (isOfflineLikeError(error)) {
        const nextEmployee = { ...currentEmployee, [column]: value, updated_at: new Date().toISOString() };
        setCurrentEmployee(nextEmployee);
        onEmployeeUpdate(nextEmployee);
        setEditingRate(null);
        await onQueueOfflineMutation({
          resource: "employees",
          affectedResources: ["employees", "dashboardSummary"],
          operation: "update",
          table: "employees",
          recordId: currentEmployee.id,
          payload: { [column]: value },
        });
        return;
      }
      NotificationService.showError(friendlyError(error));
      return;
    }

    const nextEmployee = data as Employee;
    setCurrentEmployee(nextEmployee);
    onEmployeeUpdate(nextEmployee);
    setEditingRate(null);
    NotificationService.showSuccess(`${type === "installation" ? "Installation" : "Repair"} ticket wage saved.`);
    await onChange();
  }


  const detailPayrollRuns = employeePayrollRuns.length > 0 ? employeePayrollRuns : payrollRuns;
  const history = detailPayrollRuns
    .flatMap((run) =>
      run.items
        .filter((item) => item.employee_id === currentEmployee.id)
        .map((item) => ({ item, run })),
    )
    .sort((a, b) => {
      const yearDiff = b.run.period_year - a.run.period_year;
      if (yearDiff !== 0) return yearDiff;
      const monthDiff = b.run.period_month - a.run.period_month;
      if (monthDiff !== 0) return monthDiff;
      return b.run.pay_period.localeCompare(a.run.pay_period);
    });
  const totals = history.reduce(
    (sum, row) => ({
      gross: sum.gross + toNumber(row.item.gross_pay),
      allowances: sum.allowances + toNumber(row.item.allowances),
      deductions: sum.deductions + toNumber(row.item.deductions),
      net: sum.net + toNumber(row.item.net_pay),
      paid: sum.paid + (row.item.status === "paid" ? toNumber(row.item.net_pay) : 0),
      pending: sum.pending + (row.item.status !== "paid" ? toNumber(row.item.net_pay) : 0),
    }),
    { gross: 0, allowances: 0, deductions: 0, net: 0, paid: 0, pending: 0 },
  );
  const ticketTotals = history.reduce(
    (sum, row) => ({
      installation: sum.installation + normalizeTicketCount(row.item.installation_tickets),
      repair: sum.repair + normalizeTicketCount(row.item.repair_tickets),
    }),
    { installation: 0, repair: 0 },
  );
  const repairRate = toNumber(currentEmployee.repair_rate);
  const installationRate = toNumber(currentEmployee.installation_rate);
  const repairEarnings = ticketTotals.repair * repairRate;
  const installationEarnings = ticketTotals.installation * installationRate;
  const totalTicketEarnings = repairEarnings + installationEarnings;
  const closedTickets = ticketTotals.repair + ticketTotals.installation;
  const initials = currentEmployee.full_name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "E";
  const currentPosition = positions.find((position) => position.id === currentEmployee.position_id);
  const isTicketBased = currentPosition?.pay_mode === "ticket" || currentPosition?.pay_mode === "hybrid";
  const employeeCode = `EMP-${currentEmployee.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase() || "000001"}`;
  const payMethodLabel =
    currentPosition?.pay_mode === "fixed"
      ? "Fixed salary"
      : currentPosition?.pay_mode === "hybrid"
        ? "Base + tickets"
        : currentPosition?.pay_mode === "daily"
          ? "Daily wage"
          : "Per ticket";
  const tabs = [
    { id: "information", icon: <Users size={16} />, label: "Personal Info" },
    { id: "payroll", icon: <Briefcase size={16} />, label: "Salary History" },
    ...(isTicketBased ? [{ id: "tickets" as const, icon: <BadgeDollarSign size={16} />, label: "Ticket Earnings" }] : []),
    { id: "attendance", icon: <CalendarClock size={16} />, label: "Attendance" },
    { id: "employee-advances", icon: <CreditCard size={16} />, label: "Employee Advances" },
    { id: "salary-bond", icon: <Wallet size={16} />, label: "Salary Bond" },
    { id: "documents", icon: <FileText size={16} />, label: "Documents" },
    { id: "government-deduction", icon: <BadgeDollarSign size={16} />, label: "Government Deduction" },
  ] as const;

  return (
    <div className="page-stack employee-details-page">
      <div className="employee-details">
        <header className="emp-header">
          <button className="emp-back" onClick={onBack} type="button">
            <ArrowLeft size={16} />
          </button>
          <div className="emp-identity">
            <div className="emp-avatar-group">
              <div className="emp-avatar">
                {currentEmployee.profile_photo_url ? (
                  <img alt={`${currentEmployee.full_name} profile`} src={currentEmployee.profile_photo_url} />
                ) : (
                  <span>{initials}</span>
                )}
              </div>
            </div>
            <div className="emp-name-group">
              <strong className="emp-name">{currentEmployee.full_name}</strong>
              <span className={currentEmployee.status === "active" ? "emp-status-pill active" : "emp-status-pill inactive"}>
                {currentEmployee.status === "active" ? "Active" : "Inactive"}
              </span>
              <span className="emp-position-label">{currentEmployee.role || "Unassigned position"}</span>
              <div className="emp-meta-row">
                <div className="emp-meta-item">
                  <span>Employee ID</span>
                  <strong>{employeeCode}</strong>
                </div>
                <div className="emp-meta-item">
                  <span>Date Hired</span>
                  <strong>{currentEmployee.hire_date || "Not provided"}</strong>
                </div>
                <div className="emp-meta-item">
                  <span>Department</span>
                  <strong>{currentEmployee.department || "Unassigned"}</strong>
                </div>
                <div className="emp-meta-item">
                  <span>Pay Method</span>
                  <strong>{payMethodLabel}</strong>
                </div>
              </div>
            </div>
          </div>
          <div className="emp-header-actions">
            <button className="primary-button compact" onClick={() => onEdit(currentEmployee)} type="button">
              <Pencil size={14} />
              Edit Employee
            </button>
          </div>
        </header>

        <nav className="emp-tabs" role="tablist" aria-label="Employee details sections">
          {tabs.map((tab) => (
            <button
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? "active" : ""}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              type="button"
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>

        {activeTab === "information" && (
          <section className="emp-content-card">
            <div className="emp-panels">
              <div className="emp-panel">
                <div className="emp-panel-heading">
                  <h3>Personal Information</h3>
                </div>
                <div className="emp-info-grid">
                  <DetailItem icon={<Users size={15} />} label="Full Name" value={currentEmployee.full_name} />
                  <DetailItem icon={<Mail size={15} />} label="Email" value={currentEmployee.email || "Not provided"} />
                  <DetailItem icon={<Phone size={15} />} label="Contact Number" value={currentEmployee.contact_number ? formatPhoneNumber(currentEmployee.contact_number) : "Not provided"} />
                  <DetailItem icon={<CalendarClock size={15} />} label="Date of Birth" value={currentEmployee.date_of_birth || "Not provided"} />
                  <DetailItem icon={<Heart size={15} />} label="Civil Status" value={currentEmployee.civil_status ? currentEmployee.civil_status[0].toUpperCase() + currentEmployee.civil_status.slice(1) : "Not provided"} />
                  <DetailItem icon={<MapPin size={15} />} label="Address" value={currentEmployee.address || "Not provided"} />
                  <DetailItem icon={<Users size={15} />} label="Emergency Contact" value={currentEmployee.emergency_contact_name || "Not provided"} />
                  <DetailItem icon={<Phone size={15} />} label="Emergency Number" value={currentEmployee.emergency_contact_number ? formatPhoneNumber(currentEmployee.emergency_contact_number) : "Not provided"} />
                  <DetailItem icon={<Heart size={15} />} label="Relation" value={currentEmployee.emergency_contact_relation || "Not provided"} />
                  <DetailItem icon={<FileText size={15} />} label="Notes" value={currentEmployee.notes || "No notes"} />
                </div>
              </div>

              <div className="emp-panel">
                <div className="emp-panel-heading">
                  <h3>Employment Information</h3>
                </div>
                <div className="emp-info-grid">
                  <DetailItem icon={<Briefcase size={15} />} label="Position" value={currentEmployee.role || "Unassigned"} />
                  <DetailItem icon={<LayoutDashboard size={15} />} label="Department" value={currentEmployee.department || "Unassigned"} />
                  <DetailItem icon={<CalendarClock size={15} />} label="Date Hired" value={currentEmployee.hire_date || "Not provided"} />
                  <DetailItem icon={<BadgeInfo size={15} />} label="Employment Status" value={<StatusPill status={currentEmployee.status} />} />
                  <DetailItem icon={<CreditCard size={15} />} label="Pay Method" value={payMethodLabel} />
                  <DetailItem icon={<BadgeDollarSign size={15} />} label="Monthly Base" value={currency.format(toNumber(currentPosition?.monthly_base_salary))} />
                  <DetailItem icon={<BadgeDollarSign size={15} />} label="Daily Rate" value={currency.format(toNumber(currentPosition?.daily_rate))} />
                  <DetailItem icon={<Wrench size={15} />} label="Wage Category" value={currentEmployee.wage_category === "special_old" ? "Special Old" : "New"} />
                </div>
                <div className="emp-divider" />
                <div className="emp-subsection">
                  <h4>Government IDs</h4>
                  <div className="emp-info-grid">
                    <DetailItem icon={<BadgeInfo size={15} />} label="SSS Number" value={currentEmployee.sss_number || "Not provided"} />
                    <DetailItem icon={<BadgeInfo size={15} />} label="PhilHealth Number" value={currentEmployee.philhealth_number || "Not provided"} />
                    <DetailItem icon={<BadgeInfo size={15} />} label="Pag-IBIG Number" value={currentEmployee.pagibig_number || "Not provided"} />
                    <DetailItem icon={<BadgeInfo size={15} />} label="TIN" value={currentEmployee.tin_number || "Not provided"} />
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === "payroll" && (
          <section className="emp-content-card history-stack">
            <div className="emp-summary-cards">
              <div className="emp-summary-card">
                <span>Total Gross</span>
                <strong>{currency.format(totals.gross)}</strong>
              </div>
              <div className="emp-summary-card">
                <span>Total Paid</span>
                <strong>{currency.format(totals.paid)}</strong>
              </div>
              <div className="emp-summary-card">
                <span>Pending Salary</span>
                <strong>{currency.format(totals.pending)}</strong>
              </div>
            </div>
            <h3>Salary History</h3>
            <DataTable
              empty="No payroll records for this employee yet."
              headers={["Period", "Generated", "Gross", "Allowance", "Deduction", "Net", "Status"]}
              rows={history.map(({ item, run }) => [
                `${monthNames[run.period_month - 1]} ${run.period_year} - ${payPeriodLabel(run.pay_period)}`,
                run.generated_date,
                currency.format(toNumber(item.gross_pay)),
                currency.format(toNumber(item.allowances)),
                currency.format(toNumber(item.deductions)),
                currency.format(toNumber(item.net_pay)),
                <StatusPill key="status" status={item.status} />,
              ])}
            />
          </section>
        )}

        {activeTab === "tickets" && (
          <section className="emp-content-card history-stack">
            <div className="ticket-section-heading">
              <div>
                <h3>{currentPosition?.name ?? "Unassigned position"} ticket compensation</h3>
                <p>Rates are controlled by the assigned position. Employee-specific overrides are not used.</p>
              </div>
            </div>
            <DataTable
              empty="This position has no ticket categories."
              headers={["Category", "Rate", "Status"]}
              rows={(currentPosition?.categories ?? []).map((category) => [
                category.name,
                currency.format(toNumber(category.rate)),
                <StatusPill key="status" status={category.status} />,
              ])}
            />
            <h3>Payroll ticket history</h3>
            <DataTable
              empty="No ticket-based payroll records for this employee yet."
              headers={["Period", "Category", "Closed", "Saved rate", "Earned"]}
              rows={history.flatMap(({ item, run }) => (item.ticket_details ?? []).map((detail) => [
                `${monthNames[run.period_month - 1]} ${run.period_year} - ${payPeriodLabel(run.pay_period)}`,
                detail.category_name,
                detail.ticket_count,
                currency.format(toNumber(detail.rate)),
                currency.format(toNumber(detail.amount)),
              ]))}
            />
            <div className="detail-note">
              <CheckCircle2 size={16} />
              <p>Saved payroll rates are snapshots. Editing the position affects only future daily entries.</p>
            </div>
          </section>
        )}

        {activeTab === "employee-advances" && (
          <EmployeeAdvancesFeature
            employee={currentEmployee}
            employeeAdvances={employeeAdvances}
            onChange={onChange}
            onQueueOfflineMutation={onQueueOfflineMutation}
            userId={userId}
          />
        )}

        {activeTab === "salary-bond" && (
          <SalaryBondsFeature
            employee={currentEmployee}
            employees={[currentEmployee]}
            onChange={onChange}
            onQueueOfflineMutation={onQueueOfflineMutation}
            salaryBonds={salaryBonds}
            userId={userId}
          />
        )}


        {activeTab === "documents" && (
          <section className="emp-content-card">
            <h3>Documents</h3>
            <div className="emp-info-grid">
              <DetailItem icon={<BadgeInfo size={15} />} label="SSS Number" value={currentEmployee.sss_number || "Not provided"} />
              <DetailItem icon={<BadgeInfo size={15} />} label="PhilHealth Number" value={currentEmployee.philhealth_number || "Not provided"} />
              <DetailItem icon={<BadgeInfo size={15} />} label="Pag-IBIG Number" value={currentEmployee.pagibig_number || "Not provided"} />
              <DetailItem icon={<BadgeInfo size={15} />} label="TIN Number" value={currentEmployee.tin_number || "Not provided"} />
            </div>
          </section>
        )}

        {activeTab === "government-deduction" && (
          <section className="emp-content-card">
            <h3>Government Deduction</h3>
            <div className="emp-info-grid">
              <DetailItem icon={<BadgeDollarSign size={15} />} label="SSS" value={currency.format(toNumber(currentEmployee.sss_deduction))} />
              <DetailItem icon={<BadgeDollarSign size={15} />} label="PhilHealth" value={currency.format(toNumber(currentEmployee.philhealth_deduction))} />
              <DetailItem icon={<BadgeDollarSign size={15} />} label="Pag-IBIG" value={currency.format(toNumber(currentEmployee.pagibig_deduction))} />
              <DetailItem icon={<BadgeDollarSign size={15} />} label="Withholding Tax" value={currency.format(toNumber(currentEmployee.withholding_tax))} />
            </div>
          </section>
        )}

        {activeTab === "attendance" && (() => {
          const isTicket = currentPosition?.pay_mode === "ticket" || currentPosition?.pay_mode === "hybrid";
          const dailyRate = toNumber(currentPosition?.daily_rate ?? 0);
          const attendancePageSize = 10;
          const attendanceTotal = isTicket ? empTickets.length : empAttendance.length;
          const attendancePageCount = Math.max(1, Math.ceil(attendanceTotal / attendancePageSize));
          const safeAttendancePage = Math.min(empAttendancePage, attendancePageCount);
          const pageStart = (safeAttendancePage - 1) * attendancePageSize;
          const pageEnd = Math.min(pageStart + attendancePageSize, attendanceTotal);
          const paginatedTickets = empTickets.slice(pageStart, pageEnd);
          const paginatedAttendance = empAttendance.slice(pageStart, pageEnd);
          const attendanceFooter = attendanceTotal > attendancePageSize && (
            <div className="attendance-footer emp-attendance-footer">
              <span>
                Showing {pageStart + 1} to {pageEnd} of {attendanceTotal} {isTicket ? "ticket" : "attendance"} records
              </span>
              <div>
                <button type="button" disabled={safeAttendancePage === 1} onClick={() => setEmpAttendancePage((page) => Math.max(1, page - 1))}>{"<"}</button>
                {Array.from({ length: attendancePageCount }, (_, index) => index + 1).map((page) => (
                  <button
                    className={page === safeAttendancePage ? "active" : undefined}
                    key={page}
                    onClick={() => setEmpAttendancePage(page)}
                    type="button"
                  >
                    {page}
                  </button>
                ))}
                <button type="button" disabled={safeAttendancePage === attendancePageCount} onClick={() => setEmpAttendancePage((page) => Math.min(attendancePageCount, page + 1))}>{">"}</button>
              </div>
            </div>
          );
          return (
            <section className="emp-content-card">
              <h3>Attendance &amp; Earnings History</h3>
              {empAttendanceLoading ? (
                <p className="muted">Loading…</p>
              ) : isTicket ? (
                empTickets.length === 0 ? (
                  <p className="muted">No ticket entries recorded yet.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="emp-attendance-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Tickets</th>
                          <th>Daily Earnings</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedTickets.map((entry) => {
                          const totalTickets = entry.details && entry.details.length > 0
                            ? entry.details.reduce((s, d) => s + (d.ticket_count ?? 0), 0)
                            : normalizeTicketCount(entry.installation_tickets) + normalizeTicketCount(entry.repair_tickets) + normalizeTicketCount(entry.nap_rehab_tickets);
                          const earnings = entry.details && entry.details.length > 0
                            ? entry.details.reduce((s, d) => s + (d.ticket_count ?? 0) * toNumber(d.rate), 0)
                            : normalizeTicketCount(entry.installation_tickets) * toNumber(entry.installation_rate) + normalizeTicketCount(entry.repair_tickets) * toNumber(entry.repair_rate) + normalizeTicketCount(entry.nap_rehab_tickets) * toNumber(entry.nap_rehab_rate);
                          return (
                            <tr key={entry.id}>
                              <td data-label="Date">{new Date(`${entry.entry_date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                              <td data-label="Tickets">{totalTickets}</td>
                              <td data-label="Daily Earnings"><strong>{currency.format(earnings)}</strong></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {attendanceFooter}
                  </div>
                )
              ) : (
                empAttendance.length === 0 ? (
                  <p className="muted">No attendance entries recorded yet.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="emp-attendance-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Time In</th>
                          <th>Time Out</th>
                          <th>Status</th>
                          <th>Daily Earnings</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedAttendance.map((entry) => {
                          const earnings = computeDailyEarnings(dailyRate, entry.status, entry.time_in ?? "08:00", entry.time_out ?? "17:00");
                          return (
                            <tr key={entry.id} className={entry.status === "absent" ? "emp-att-absent" : entry.status === "half_day" ? "emp-att-leave" : ""}>
                              <td data-label="Date">{new Date(`${entry.entry_date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                              <td data-label="Time In">{entry.status === "absent" ? "—" : formatTime(entry.time_in ?? "08:00")}</td>
                              <td data-label="Time Out">{entry.status === "absent" ? "—" : formatTime(entry.time_out ?? "17:00")}</td>
                              <td data-label="Status">
                                <span className={`att-history-badge ${entry.status}`}>
                                  {entry.status === "present" ? "Present" : entry.status === "absent" ? "Absent" : "On Leave"}
                                </span>
                              </td>
                              <td data-label="Daily Earnings"><strong>{entry.status === "absent" ? "—" : currency.format(earnings)}</strong></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {attendanceFooter}
                  </div>
                )
              )}
            </section>
          );
        })()}
      </div>
    </div>
  );
}

function TicketRateRow({
  description,
  draftValue,
  editing,
  icon,
  onDraftChange,
  onEdit,
  onSave,
  rate,
  title,
  tone,
}: {
  description: string;
  draftValue: string;
  editing: boolean;
  icon: ReactNode;
  onDraftChange: (value: string) => void;
  onEdit: () => void;
  onSave: () => void;
  rate: number;
  title: string;
  tone: "blue" | "green";
}) {
  return (
    <div className="ticket-rate-row">
      <div className="ticket-rate-title">
        <span className={`ticket-rate-icon ${tone}`}>{icon}</span>
        <strong>{title}</strong>
      </div>
      <p>{description}</p>
      <div className="ticket-rate-input">
        <span>PHP</span>
        {editing ? (
          <input
            aria-label={`${title} wage per closed ticket`}
            min="0"
            onChange={(event) => onDraftChange(event.target.value)}
            step="0.01"
            type="number"
            value={draftValue}
          />
        ) : (
          <strong>{rate.toFixed(2)}</strong>
        )}
      </div>
      <StatusPill status="active" />
      <div className="ticket-rate-actions">
        <button
          aria-label={editing ? `Save ${title}` : `Edit ${title}`}
          onClick={editing ? onSave : onEdit}
          title={editing ? `Save ${title}` : `Edit ${title}`}
          type="button"
        >
          {editing ? <Save size={15} /> : <Pencil size={15} />}
        </button>
      </div>
    </div>
  );
}

function DetailItem({ icon, label, value }: { icon?: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="detail-item">
      <span>
        {icon && <i className="detail-item-icon" aria-hidden="true">{icon}</i>}
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

function EmployeeForm({
  embedded = false,
  initial,
  onClose,
  onSubmit,
  positions,
}: {
  embedded?: boolean;
  initial: Employee | null;
  onClose: () => void;
  onSubmit: (values: EmployeeFormValues) => Promise<void>;
  positions: Position[];
}) {
  type FormTab = "personal" | "employment" | "documents" | "government-deduction";
  const [activeTab, setActiveTab] = useState<FormTab>("personal");
  const [values, setValues] = useState<EmployeeFormValues>(
    initial
      ? {
          full_name: initial.full_name,
          role: initial.role,
          position_id: initial.position_id ?? "",
          department: initial.department,
          contact_number: initial.contact_number,
          email: initial.email,
          address: initial.address,
          profile_photo_url: initial.profile_photo_url ?? "",
          hire_date: initial.hire_date ?? "",
          date_of_birth: initial.date_of_birth ?? "",
          status: initial.status,
          wage_category: initial.wage_category ?? "new",
          gender: initial.gender ?? "",
          civil_status: initial.civil_status ?? "",
          monthly_salary: String(initial.monthly_salary),
          sss_number: initial.sss_number,
          philhealth_number: initial.philhealth_number,
          pagibig_number: initial.pagibig_number,
          sss_deduction: String(initial.sss_deduction ?? 0),
          philhealth_deduction: String(initial.philhealth_deduction ?? 0),
          pagibig_deduction: String(initial.pagibig_deduction ?? 0),
          withholding_tax: String(initial.withholding_tax ?? 0),
          tin_number: initial.tin_number,
          emergency_contact_name: initial.emergency_contact_name ?? "",
          emergency_contact_number: initial.emergency_contact_number ?? "",
          emergency_contact_relation: initial.emergency_contact_relation ?? "",
          notes: initial.notes,
        }
      : emptyEmployee,
  );
  const [busy, setBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");

  function handlePhotoFile(file: File | null) {
    if (!file) return;
    const allowedTypes = ["image/png", "image/jpeg"];
    if (!allowedTypes.includes(file.type)) {
      setPhotoError("Upload a PNG or JPG image.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setPhotoError("Profile photo must be 2MB or smaller.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setValues((current) => ({ ...current, profile_photo_url: String(reader.result ?? "") }));
      setPhotoError("");
    };
    reader.onerror = () => setPhotoError("Unable to read that image. Try another file.");
    reader.readAsDataURL(file);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!values.full_name.trim()) return;
    setBusy(true);
    await onSubmit(values);
    setBusy(false);
  }

  const selectedPosition = positions.find((p) => p.id === values.position_id);
  const initials = values.full_name.trim().split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const completedFields = [
    values.full_name,
    values.position_id,
    values.email,
    values.contact_number,
    values.hire_date,
    values.sss_number,
    values.philhealth_number,
    values.pagibig_number,
    values.sss_deduction,
    values.philhealth_deduction,
    values.pagibig_deduction,
    values.withholding_tax,
    values.tin_number,
  ].filter(Boolean).length;
  const totalFields = 13;

  const tabs: { id: FormTab; icon: ReactNode; label: string }[] = [
    { id: "personal", icon: <Users size={16} />, label: "Personal" },
    { id: "employment", icon: <Briefcase size={16} />, label: "Employment" },
    { id: "documents", icon: <FileText size={16} />, label: "Documents" },
    { id: "government-deduction", icon: <BadgeDollarSign size={16} />, label: "Government Deduction" },
  ];

  const formContent = (
    <form className="emp-form-wizard" onSubmit={handleSubmit}>
      <div className="emp-form-body">
        <div className="emp-form-main">
          <div className="emp-form-tabs" role="tablist" aria-label="Employee form sections">
            {tabs.map((tab) => (
              <button
                aria-selected={activeTab === tab.id}
                className={activeTab === tab.id ? "active" : ""}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                role="tab"
                type="button"
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "personal" && (
            <div className="emp-form-section">
              <div className="emp-form-group">
                <h3>Basic Information</h3>
                <div className="emp-basic-info-layout">
                  <div className="emp-form-photo-hero">
                    <label
                      className={values.profile_photo_url ? "emp-photo-upload has-photo" : "emp-photo-upload"}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        handlePhotoFile(event.dataTransfer.files[0] ?? null);
                      }}
                    >
                      <input
                        accept="image/png,image/jpeg"
                        onChange={(event) => handlePhotoFile(event.target.files?.[0] ?? null)}
                        type="file"
                      />
                      {values.profile_photo_url ? (
                        <>
                          <img alt="Preview" className="emp-photo-full" src={values.profile_photo_url} />
                          <div className="emp-photo-full-overlay">
                            <Upload size={16} />
                            <span>Change photo</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="emp-photo-circle">
                            <span className="emp-photo-placeholder">
                              {initials || <Plus size={18} />}
                            </span>
                            <div className="emp-photo-overlay">
                              <Upload size={14} />
                            </div>
                          </div>
                          <div className="emp-photo-info">
                            <p className="emp-photo-hint">Upload photo</p>
                            <span className="emp-photo-subtext">PNG or JPG, up to 2MB</span>
                          </div>
                        </>
                      )}
                    </label>
                    {photoError && <small className="emp-photo-error">{photoError}</small>}
                  </div>
                  <div className="emp-form-fields">
                    <TextField label="Full name" value={values.full_name} onChange={(full_name) => setValues({ ...values, full_name })} required />
                    <label>
                      Gender
                      <select value={values.gender} onChange={(event) => setValues({ ...values, gender: event.target.value })}>
                        <option value="">Not specified</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <TextField label="Email address" type="email" value={values.email} onChange={(email) => setValues({ ...values, email })} />
                    <TextField label="Contact number" type="tel" placeholder="+63 XXXX XXX XXXX" value={formatPhoneNumber(values.contact_number)} onChange={(v) => setValues({ ...values, contact_number: normalizePhoneDigits(v) })} />
                  </div>
                </div>
                <div className="emp-form-fields">
                  <TextField label="Date of birth" type="date" value={values.date_of_birth} onChange={(date_of_birth) => setValues({ ...values, date_of_birth })} />
                  <label>
                    Civil status
                    <select value={values.civil_status} onChange={(event) => setValues({ ...values, civil_status: event.target.value })}>
                      <option value="">Not specified</option>
                      <option value="single">Single</option>
                      <option value="married">Married</option>
                      <option value="widowed">Widowed</option>
                    </select>
                  </label>
                  <label className="full">
                    Address
                    <textarea rows={2} value={values.address} onChange={(event) => setValues({ ...values, address: event.target.value })} placeholder="Street, city, province" />
                  </label>
                </div>
              </div>
              <div className="emp-form-group">
                <h3>Emergency Contact</h3>
                <div className="emp-form-fields">
                  <TextField label="Contact person" value={values.emergency_contact_name} onChange={(emergency_contact_name) => setValues({ ...values, emergency_contact_name })} />
                  <TextField label="Contact number" type="tel" placeholder="+63 XXXX XXX XXXX" value={formatPhoneNumber(values.emergency_contact_number)} onChange={(v) => setValues({ ...values, emergency_contact_number: normalizePhoneDigits(v) })} />
                  <TextField label="Relation (e.g., Spouse, Parent)" value={values.emergency_contact_relation} onChange={(emergency_contact_relation) => setValues({ ...values, emergency_contact_relation })} />
                </div>
              </div>
            </div>
          )}

          {activeTab === "employment" && (
            <div className="emp-form-section">
              <div className="emp-form-group">
                <h3>Position & Department</h3>
                <div className="emp-form-fields">
                  <label>
                    Position<RequiredMark />
                    <select
                      required
                      value={values.position_id}
                      onChange={(event) => {
                        const position = positions.find((item) => item.id === event.target.value);
                        const salary = (position?.pay_mode === "fixed" || position?.pay_mode === "hybrid")
                          ? String(position.monthly_base_salary)
                          : "0";
                        setValues({
                          ...values,
                          position_id: event.target.value,
                          role: position?.name ?? "",
                          department: position?.department ?? "",
                          monthly_salary: salary,
                        });
                      }}
                    >
                      <option value="">Select a position</option>
                      {positions
                        .filter((position) => position.status === "active" || position.id === initial?.position_id)
                        .map((position) => (
                          <option key={position.id} value={position.id}>
                            {position.name}{position.status === "archived" ? " (Archived)" : ""}
                          </option>
                        ))}
                    </select>
                  </label>
                  <TextField label="Department" value={values.department} onChange={() => undefined} />
                </div>
                {selectedPosition && (
                  <div className="emp-position-badge">
                    <Briefcase size={14} />
                    <span>{selectedPosition.pay_mode === "fixed" ? "Fixed salary" : selectedPosition.pay_mode === "hybrid" ? "Base + ticket" : selectedPosition.pay_mode === "daily" ? "Daily wage" : "Per ticket"}</span>
                    {selectedPosition.monthly_base_salary > 0 && (
                      <>
                        <span className="emp-position-sep" />
                        <span>Base {currency.format(toNumber(selectedPosition.monthly_base_salary))}/mo</span>
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="emp-form-group">
                <h3>Employment Status</h3>
                <div className="emp-form-fields">
                  <label>
                    Status
                    <select value={values.status} onChange={(event) => setValues({ ...values, status: event.target.value as EmployeeFormValues["status"] })}>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </label>
                  <TextField label="Hire date" type="date" value={values.hire_date} onChange={(hire_date) => setValues({ ...values, hire_date })} />
                </div>
              </div>
              <div className="emp-form-group">
                <h3>Additional</h3>
                <div className="emp-form-fields">
                  <label className="full">
                    Notes
                    <textarea rows={3} value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} placeholder="Any additional notes about this employee" />
                  </label>
                </div>
              </div>
            </div>
          )}

          {activeTab === "documents" && (
            <div className="emp-form-section">
              <div className="emp-form-group">
                <h3>Government IDs</h3>
                <p className="emp-form-group-desc">Required for payroll compliance and statutory deductions.</p>
                <div className="emp-form-fields">
                  <TextField label="SSS number" value={values.sss_number} onChange={(sss_number) => setValues({ ...values, sss_number })} />
                  <TextField label="PhilHealth number" value={values.philhealth_number} onChange={(philhealth_number) => setValues({ ...values, philhealth_number })} />
                  <TextField label="Pag-IBIG number" value={values.pagibig_number} onChange={(pagibig_number) => setValues({ ...values, pagibig_number })} />
                  <TextField label="TIN number" value={values.tin_number} onChange={(tin_number) => setValues({ ...values, tin_number })} />
                </div>
              </div>
            </div>
          )}

          {activeTab === "government-deduction" && (
            <div className="emp-form-section">
              <div className="emp-form-group">
                <h3>Government Deduction</h3>
                <p className="emp-form-group-desc">Per-payroll statutory deduction amounts.</p>
                <div className="emp-form-fields">
                  <MoneyInput label="SSS" value={values.sss_deduction} onChange={(sss_deduction) => setValues({ ...values, sss_deduction })} />
                  <MoneyInput label="PhilHealth" value={values.philhealth_deduction} onChange={(philhealth_deduction) => setValues({ ...values, philhealth_deduction })} />
                  <MoneyInput label="Pag-IBIG" value={values.pagibig_deduction} onChange={(pagibig_deduction) => setValues({ ...values, pagibig_deduction })} />
                  <MoneyInput label="Withholding Tax" value={values.withholding_tax} onChange={(withholding_tax) => setValues({ ...values, withholding_tax })} />
                </div>
              </div>
            </div>
          )}
        </div>

        <aside className="emp-form-sidebar">
          <div className="emp-form-preview">
            <div className="emp-preview-avatar">
              {values.profile_photo_url ? (
                <img alt="Preview" src={values.profile_photo_url} />
              ) : (
                <span>{initials || "?"}</span>
              )}
            </div>
            <strong className="emp-preview-name">{values.full_name || "Employee name"}</strong>
            <span className="emp-preview-role">{selectedPosition?.name || "No position"}</span>
            <StatusPill status={values.status} />
          </div>

          <div className="emp-form-progress">
            <div className="emp-progress-header">
              <span>Profile completion</span>
              <strong>{Math.round((completedFields / totalFields) * 100)}%</strong>
            </div>
            <div className="emp-progress-bar">
              <div className="emp-progress-fill" style={{ width: `${(completedFields / totalFields) * 100}%` }} />
            </div>
          </div>

          <div className="emp-form-summary">
            <div className="emp-summary-row">
              <span>Position</span>
              <strong>{selectedPosition?.name || "—"}</strong>
            </div>
            <div className="emp-summary-row">
              <span>Department</span>
              <strong>{values.department || "—"}</strong>
            </div>
            <div className="emp-summary-row">
              <span>Email</span>
              <strong>{values.email || "—"}</strong>
            </div>
            <div className="emp-summary-row">
              <span>Phone</span>
              <strong>{values.contact_number ? formatPhoneNumber(values.contact_number) : "—"}</strong>
            </div>
            <div className="emp-summary-row">
              <span>Hire date</span>
              <strong>{values.hire_date || "—"}</strong>
            </div>
          </div>

          <div className="emp-form-actions-sticky">
            <button className="secondary-button" onClick={onClose} type="button">Cancel</button>
            <button className="primary-button" disabled={busy} type="submit">
              {busy && <Spinner size="small" />}
              {busy ? "Saving..." : initial ? "Save Changes" : "Add Employee"}
            </button>
          </div>
        </aside>
      </div>
    </form>
  );

  if (embedded) {
    return (
      <div className="page-stack">
        <header className="emp-form-header">
          <div>
            <button className="text-button" onClick={onClose} type="button">
              <ArrowLeft size={16} />
              Back to Employees
            </button>
            <h1>{initial ? "Edit Employee" : "Add New Employee"}</h1>
            <p>{initial ? "Update this employee's information." : "Fill in the details to add a new team member."}</p>
          </div>
        </header>
        {formContent}
      </div>
    );
  }

  return (
    <Modal title={initial ? "Edit employee" : "Add employee"} onClose={onClose}>
      <form className="form-grid" onSubmit={handleSubmit}>
        <TextField label="Full name" value={values.full_name} onChange={(full_name) => setValues({ ...values, full_name })} required />
        <label>
          Position<RequiredMark />
          <select
            required
            value={values.position_id}
            onChange={(event) => {
              const position = positions.find((item) => item.id === event.target.value);
              setValues({ ...values, position_id: event.target.value, role: position?.name ?? "", department: position?.department ?? "" });
            }}
          >
            <option value="">Select a position</option>
            {positions.filter((p) => p.status === "active" || p.id === initial?.position_id).map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.status === "archived" ? " (Archived)" : ""}</option>
            ))}
          </select>
        </label>
        <TextField label="Contact number" type="tel" placeholder="+63 XXXX XXX XXXX" value={formatPhoneNumber(values.contact_number)} onChange={(v) => setValues({ ...values, contact_number: normalizePhoneDigits(v) })} />
        <TextField label="Email" type="email" value={values.email} onChange={(email) => setValues({ ...values, email })} />
        <label>
          Status
          <select value={values.status} onChange={(event) => setValues({ ...values, status: event.target.value as EmployeeFormValues["status"] })}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <TextField label="Hire date" type="date" value={values.hire_date} onChange={(hire_date) => setValues({ ...values, hire_date })} />
        <TextField label="SSS number" value={values.sss_number} onChange={(sss_number) => setValues({ ...values, sss_number })} />
        <TextField label="PhilHealth number" value={values.philhealth_number} onChange={(philhealth_number) => setValues({ ...values, philhealth_number })} />
        <TextField label="Pag-IBIG number" value={values.pagibig_number} onChange={(pagibig_number) => setValues({ ...values, pagibig_number })} />
        <MoneyInput label="SSS deduction" value={values.sss_deduction} onChange={(sss_deduction) => setValues({ ...values, sss_deduction })} />
        <MoneyInput label="PhilHealth deduction" value={values.philhealth_deduction} onChange={(philhealth_deduction) => setValues({ ...values, philhealth_deduction })} />
        <MoneyInput label="Pag-IBIG deduction" value={values.pagibig_deduction} onChange={(pagibig_deduction) => setValues({ ...values, pagibig_deduction })} />
        <MoneyInput label="Withholding tax" value={values.withholding_tax} onChange={(withholding_tax) => setValues({ ...values, withholding_tax })} />
        <TextField label="TIN number" value={values.tin_number} onChange={(tin_number) => setValues({ ...values, tin_number })} />
        <label className="full">
          Address
          <textarea rows={2} value={values.address} onChange={(event) => setValues({ ...values, address: event.target.value })} />
        </label>
        <label className="full">
          Notes
          <textarea rows={2} value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} />
        </label>
        <FormActions busy={busy} onClose={onClose} />
      </form>
    </Modal>
  );
}
function Metric({
  helperText,
  icon,
  label,
  tone,
  value,
}: {
  helperText?: string;
  icon: ReactNode;
  label: string;
  tone?: "danger" | "success" | "warning";
  value: number | string;
}) {
  return (
    <div className={`metric ${tone ?? ""}`}>
      <div className="metric-icon">{icon}</div>
      <p>{label}</p>
      <strong>{value}</strong>
      {helperText ? <span className="metric-helper">{helperText}</span> : null}
    </div>
  );
}

export default EmployeesView;
