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
  Menu,
  Settings,
  Users,
} from "lucide-react";

type View =
  | "attendance"
  | "billing"
  | "billing-history"
  | "billing-settings"
  | "dashboard"
  | "employees"
  | "employee-add"
  | "expenses"
  | "personal-expenses"
  | "expense-categories"
  | "compensation"
  | "daily-tickets"
  | "daily-tickets-subcon"
  | "payroll"
  | "payroll-settings"
  | "payroll-history"
  | "payments"
  | "collections"
  | "collection-history"
  | "subcontractors";

export function Sidebar({
  collapsed,
  email,
  mobileNavOpen,
  navigate,
  onCloseMobile,
  onSignOut,
  onToggleMobileNav,
  view,
}: {
  collapsed: boolean;
  email: string;
  mobileNavOpen: boolean;
  navigate: (view: View) => void;
  onCloseMobile: () => void;
  onSignOut: () => void;
  onToggleMobileNav: () => void;
  view: View;
}) {
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const settingsSectionActive = view === "compensation" || view === "expense-categories" || view === "billing-settings" || view === "payroll-settings";

  const goTo = (nextView: View) => {
    navigate(nextView);
    onCloseMobile();
  };

  return (
    <aside className={collapsed ? "sidebar collapsed" : mobileNavOpen ? "sidebar mobile-open" : "sidebar"} id="primary-sidebar">
      <div className="brand-row sidebar-brand">
        <img className="brand-logo sidebar-logo" src="/logo.png" alt="JMSolution Information Services" />
        <button
          aria-controls="primary-sidebar"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          className="sidebar-toggle"
          onClick={onToggleMobileNav}
          type="button"
        >
          <Menu size={20} />
        </button>
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

        <p className="nav-section-label">Finance</p>
        <NavButton active={view === "billing" || view === "billing-history"} icon={<FileText size={18} />} label="Billing" onClick={() => goTo("billing")} />
        <NavButton active={view === "expenses"} icon={<CreditCard size={18} />} label="Expenses" onClick={() => goTo("expenses")} />
        <NavButton active={view === "subcontractors"} icon={<Users size={18} />} label="Subcontractors" onClick={() => goTo("subcontractors")} />
        <NavButton active={view === "collections" || view === "collection-history"} icon={<BadgeDollarSign size={18} />} label="Collections" onClick={() => goTo("collections")} />
        <NavButton active={view === "payments"} icon={<CreditCard size={18} />} label="Payment History" onClick={() => goTo("payments")} />

        <p className="nav-section-label">Personal</p>
        <NavButton active={view === "personal-expenses"} icon={<CreditCard size={18} />} label="Expenses" onClick={() => goTo("personal-expenses")} />

        <hr className="nav-divider" />
        <div className="nav-group">
          <button
            className={settingsSectionActive ? "nav-button active" : "nav-button"}
            onClick={() => {
              if (collapsed) {
                goTo("compensation");
                return;
              }
              setSettingsMenuOpen((open) => !open);
            }}
            type="button"
          >
            <Settings size={18} />
            <span className="nav-button-label">Settings</span>
            <ChevronDown className={settingsMenuOpen || settingsSectionActive ? "nav-chevron open" : "nav-chevron"} size={16} />
          </button>
          {(settingsMenuOpen || settingsSectionActive) && !collapsed && (
            <div className="nav-submenu">
              <button className={view === "compensation" ? "active" : ""} onClick={() => goTo("compensation")} type="button">
                Positions
              </button>
              <button className={view === "billing-settings" ? "active" : ""} onClick={() => goTo("billing-settings")} type="button">
                Billing Settings
              </button>
              <button className={view === "payroll-settings" ? "active" : ""} onClick={() => goTo("payroll-settings")} type="button">
                Payroll Settings
              </button>
              <button className={view === "expense-categories" ? "active" : ""} onClick={() => goTo("expense-categories")} type="button">
                Expense Categories
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
      <span className="nav-button-label">{label}</span>
    </button>
  );
}
