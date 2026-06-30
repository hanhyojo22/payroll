import { useState, type ReactNode } from "react";
import {
  BadgeDollarSign,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  FileText,
  LayoutDashboard,
  LogOut,
  Settings,
  Users,
} from "lucide-react";

type View =
  | "attendance"
  | "billing"
  | "dashboard"
  | "employees"
  | "employee-add"
  | "expenses"
  | "compensation"
  | "daily-tickets"
  | "daily-tickets-subcon"
  | "salary-bonds"
  | "payroll"
  | "payroll-history"
  | "payments"
  | "payment-history"
  | "collections"
  | "collection-history"
  | "subcontractors";

export function Sidebar({
  email,
  mobileNavOpen,
  navigate,
  onCloseMobile,
  onSignOut,
  view,
}: {
  email: string;
  mobileNavOpen: boolean;
  navigate: (view: View) => void;
  onCloseMobile: () => void;
  onSignOut: () => void;
  view: View;
}) {
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);

  const goTo = (nextView: View) => {
    navigate(nextView);
    onCloseMobile();
  };

  return (
    <aside className={mobileNavOpen ? "sidebar mobile-open" : "sidebar"} id="primary-sidebar">
      <div className="brand-row sidebar-brand">
        <img className="brand-logo sidebar-logo" src="/logo.png" alt="JMSolution Information Services" />
        <h1 className="sr-only">Payroll System</h1>
      </div>
      <nav aria-label="Main navigation" className="nav-list">
        <p className="nav-section-label">Team</p>
        <NavButton active={view === "dashboard"} icon={<LayoutDashboard size={18} />} label="Dashboard" onClick={() => goTo("dashboard")} />
        <NavButton active={view === "employees" || view === "employee-add"} icon={<Users size={18} />} label="Employees" onClick={() => goTo("employees")} />
        <NavButton active={view === "attendance"} icon={<CheckCircle2 size={18} />} label="Attendance" onClick={() => goTo("attendance")} />

        <p className="nav-section-label">Operations</p>
        <NavButton active={view === "daily-tickets" || view === "daily-tickets-subcon"} icon={<CalendarClock size={18} />} label="Daily Tickets" onClick={() => goTo("daily-tickets")} />
        <NavButton active={view === "payroll" || view === "payroll-history"} icon={<BadgeDollarSign size={18} />} label="Payroll" onClick={() => goTo("payroll")} />
        <NavButton active={view === "salary-bonds"} icon={<CreditCard size={18} />} label="Salary Bond" onClick={() => goTo("salary-bonds")} />

        <p className="nav-section-label">Finance</p>
        <NavButton active={view === "payments" || view === "payment-history"} icon={<CreditCard size={18} />} label="Payments" onClick={() => goTo("payments")} />
        <NavButton active={view === "billing"} icon={<FileText size={18} />} label="Billing" onClick={() => goTo("billing")} />
        <NavButton active={view === "expenses"} icon={<CreditCard size={18} />} label="Expenses" onClick={() => goTo("expenses")} />
        <NavButton active={view === "subcontractors"} icon={<Users size={18} />} label="Subcontractors" onClick={() => goTo("subcontractors")} />
        <NavButton active={view === "collections" || view === "collection-history"} icon={<BadgeDollarSign size={18} />} label="Collections" onClick={() => goTo("collections")} />

        <hr className="nav-divider" />
        <div className="nav-group">
          <button
            className={view === "compensation" ? "nav-button active" : "nav-button"}
            onClick={() => setSettingsMenuOpen((open) => !open)}
            type="button"
          >
            <Settings size={18} />
            Settings
            <ChevronDown className={settingsMenuOpen ? "nav-chevron open" : "nav-chevron"} size={16} />
          </button>
          {settingsMenuOpen && (
            <div className="nav-submenu">
              <button className={view === "compensation" ? "active" : ""} onClick={() => goTo("compensation")} type="button">
                Positions
              </button>
            </div>
          )}
        </div>
      </nav>
      <div className="sidebar-footer">
        <p>{email}</p>
        <button className="icon-text-button" onClick={onSignOut} type="button">
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </aside>
  );
}

function NavButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={active ? "nav-button active" : "nav-button"} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}
