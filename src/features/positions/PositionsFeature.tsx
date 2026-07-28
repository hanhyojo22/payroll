import { useState } from "react";
import { History, Pencil, Plus, Trash2 } from "lucide-react";
import { Modal, TextField } from "../../shared/components/FormLayout";
import { MoneyField as MoneyInput } from "../../shared/components/MoneyField";
import { StatusBadge as StatusPill } from "../../shared/components/StatusBadge";
import { PageHeader, RecordTitle, Toolbar } from "../../shared/components/PageLayout";
import { DataTable } from "../../shared/components/DataTable";
import { NotificationService } from "../../shared/notifications/NotificationService";
import { friendlyError } from "../../shared/utils/errors";
import { currency, toNumber } from "../../shared/utils/currency";
import { supabase } from "../../supabase";
import type { QueueOfflineMutation } from "../../shared/types";
import type { Employee, Position, PositionFormValues } from "../../types";

function PositionsView({
  employees,
  onChange,
  onLocalPositionsChange,
  onQueueOfflineMutation,
  positions,
  userId,
}: {
  employees: Employee[];
  onChange: () => Promise<void>;
  onLocalPositionsChange: (positions: Position[]) => void;
  onQueueOfflineMutation: QueueOfflineMutation;
  positions: Position[];
  userId: string;
}) {
  const [editing, setEditing] = useState<Position | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rows = positions.filter((position) =>
    `${position.name} ${position.department} ${position.pay_mode}`.toLowerCase().includes(query.toLowerCase())
  );
  const existingDepartments = Array.from(
    new Set(positions.map((position) => position.department).filter((department) => department && department.trim())),
  ).sort((a, b) => a.localeCompare(b));

  async function savePosition(values: PositionFormValues) {
    if (!supabase) return;
    const needsTickets = values.pay_mode === "ticket" || values.pay_mode === "hybrid";
    const categories = values.categories
      .map((category, index) => ({
        id: category.id ?? crypto.randomUUID(),
        user_id: userId,
        position_id: editing?.id ?? "",
        name: category.name.trim(),
        rate: toNumber(category.rate),
        ticket_type: category.ticket_type,
        display_order: index,
        status: category.status,
      }))
      .filter((category) => category.name);
    if (!values.name.trim()) {
      NotificationService.showError("Position name is required.");
      return;
    }
    if (needsTickets && categories.filter((category) => category.status === "active").length === 0) {
      NotificationService.showError("Ticket and hybrid positions need at least one active ticket category.");
      return;
    }
    const positionId = editing?.id ?? crypto.randomUUID();
    const payload = {
      id: positionId,
      user_id: userId,
      name: values.name.trim(),
      department: values.department.trim(),
      description: values.description.trim(),
      status: values.status,
      pay_mode: values.pay_mode,
      monthly_base_salary: (values.pay_mode === "fixed" || values.pay_mode === "hybrid") ? toNumber(values.monthly_base_salary) : 0,
      daily_rate: values.pay_mode === "daily" ? toNumber(values.daily_rate) : 0,
    };
    const categoryPayloads = categories.map((category) => ({ ...category, position_id: positionId }));
    const removedCategories = editing?.categories.filter(
      (existing) => !categoryPayloads.some((category) => category.id === existing.id),
    ) ?? [];
    const optimistic: Position = {
      ...(editing ?? {} as Position),
      ...payload,
      created_at: editing?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
      categories: categoryPayloads.map((category) => ({
        ...category,
        created_at: editing?.categories.find((item) => item.id === category.id)?.created_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })),
    };

    if (!navigator.onLine) {
      onLocalPositionsChange(editing
        ? positions.map((position) => position.id === positionId ? optimistic : position)
        : [optimistic, ...positions]);
      await onQueueOfflineMutation({
        resource: "positions",
        affectedResources: ["positions", "employees", "dailyTicketEntries", "payrollRuns"],
        operation: "upsert",
        table: "positions",
        recordId: positionId,
        payload,
        options: { onConflict: "id" },
      });
      if (categoryPayloads.length > 0) {
        await onQueueOfflineMutation({
          resource: "positions",
          affectedResources: ["positions"],
          operation: "upsert",
          table: "position_ticket_categories",
          payload: categoryPayloads,
          options: { onConflict: "id" },
        });
      }
      for (const category of removedCategories) {
        await onQueueOfflineMutation({
          resource: "positions",
          affectedResources: ["positions"],
          operation: "update",
          table: "position_ticket_categories",
          recordId: category.id,
          payload: { status: "archived" },
        });
      }
      setFormOpen(false);
      setEditing(null);
      return;
    }

    const positionResult = await supabase.from("positions").upsert(payload, { onConflict: "id" });
    if (positionResult.error) {
      NotificationService.showError(friendlyError(positionResult.error));
      return;
    }
    if (categoryPayloads.length > 0) {
      const categoryResult = await supabase.from("position_ticket_categories").upsert(categoryPayloads, { onConflict: "id" });
      if (categoryResult.error) {
        NotificationService.showError(friendlyError(categoryResult.error));
        return;
      }
    }
    if (removedCategories.length > 0) {
      const archiveResult = await supabase
        .from("position_ticket_categories")
        .update({ status: "archived" })
        .in("id", removedCategories.map((category) => category.id));
      if (archiveResult.error) {
        NotificationService.showError(friendlyError(archiveResult.error));
        return;
      }
    }
    NotificationService.showSuccess("Position saved.");
    setFormOpen(false);
    setEditing(null);
    await onChange();
  }

  async function toggleArchive(position: Position) {
    if (!supabase) return;
    const status = position.status === "active" ? "archived" : "active";
    const assignedActiveEmployees = employees.filter(
      (employee) => employee.position_id === position.id && employee.status === "active",
    ).length;
    if (status === "archived" && assignedActiveEmployees > 0) {
      NotificationService.showError(`Reassign ${assignedActiveEmployees} active employee${assignedActiveEmployees === 1 ? "" : "s"} before archiving this position.`);
      return;
    }
    const confirmed = await NotificationService.showConfirm({
      title: status === "archived" ? "Archive position" : "Restore position",
      message: status === "archived"
        ? `Archive "${position.name}"? It will no longer be assignable to employees.`
        : `Restore "${position.name}" to active status?`,
    });
    if (!confirmed) return;
    const optimistic = positions.map((item) => item.id === position.id ? { ...item, status } as Position : item);
    if (!navigator.onLine) {
      onLocalPositionsChange(optimistic);
      await onQueueOfflineMutation({
        resource: "positions",
        affectedResources: ["positions"],
        operation: "update",
        table: "positions",
        recordId: position.id,
        payload: { status },
      });
      return;
    }
    const { error } = await supabase.from("positions").update({ status }).eq("id", position.id);
    if (error) {
      NotificationService.showError(friendlyError(error));
    } else {
      NotificationService.showSuccess(`Position ${status}.`);
    }
    if (!error) await onChange();
  }

  async function handleDeletePosition(position: Position) {
    const assignedCount = employees.filter((e) => e.position_id === position.id).length;
    if (assignedCount > 0) {
      NotificationService.showWarning(`${assignedCount} employee${assignedCount === 1 ? " is" : "s are"} still assigned — reassign before deleting.`);
      return;
    }
    const confirmed = await NotificationService.showConfirm({
      title: "Delete position",
      message: `Are you sure you want to permanently delete "${position.name}"? This action cannot be undone.`,
      danger: true,
    });
    if (!confirmed) return;
    await deletePosition(position);
  }

  async function deletePosition(position: Position) {
    if (!supabase) return;
    const assignedEmployees = employees.filter((e) => e.position_id === position.id).length;
    if (assignedEmployees > 0) {
      NotificationService.showError(`Cannot delete "${position.name}" — ${assignedEmployees} employee${assignedEmployees === 1 ? " is" : "s are"} still assigned. Reassign them first.`);
      return;
    }
    if (!navigator.onLine) {
      onLocalPositionsChange(positions.filter((p) => p.id !== position.id));
      await onQueueOfflineMutation({
        resource: "positions",
        affectedResources: ["positions", "employees", "dailyTicketEntries", "payrollRuns"],
        operation: "delete",
        table: "position_ticket_categories",
        payload: { position_id: position.id },
      });
      await onQueueOfflineMutation({
        resource: "positions",
        affectedResources: ["positions", "employees", "dailyTicketEntries", "payrollRuns"],
        operation: "delete",
        table: "positions",
        recordId: position.id,
      });
      return;
    }
    const catResult = await supabase.from("position_ticket_categories").delete().eq("position_id", position.id);
    if (catResult.error) {
      NotificationService.showError(friendlyError(catResult.error));
      return;
    }
    const { error } = await supabase.from("positions").delete().eq("id", position.id);
    if (error) {
      NotificationService.showError(friendlyError(error));
      return;
    }
    NotificationService.showSuccess(`"${position.name}" deleted.`);
    await onChange();
  }

  return (
    <div className="page-stack">
      <PageHeader
        action={<button className="primary-button compact" onClick={() => { setEditing(null); setFormOpen(true); }} type="button"><Plus size={16} /> Add position</button>}
        eyebrow="Compensation setup"
        title="Positions"
        text="Define a position's base salary and ticket categories once, then assign it to employees."
      />
      <Toolbar query={query} setQuery={setQuery} />
      <DataTable
        empty="No positions yet. Create one before adding active employees."
        headers={["Position", "Department", "Pay method", "Base salary", "Ticket categories", "Employees", "Status", "Actions"]}
        rows={rows.map((position) => [
          <RecordTitle key="name" title={position.name} notes={position.description || "No description"} />,
          position.department || "Unassigned",
          position.pay_mode === "fixed" ? "Fixed salary" : position.pay_mode === "ticket" ? "Per ticket" : position.pay_mode === "daily" ? "Daily wage" : "Base + ticket",
          currency.format(toNumber(position.monthly_base_salary)),
          position.categories.filter((category) => category.status === "active").map((category) => `${category.name} (${currency.format(toNumber(category.rate))})`).join(", ") || "None",
          employees.filter((employee) => employee.position_id === position.id).length,
          <StatusPill key="status" status={position.status} />,
          <div className="row-actions" key="actions">
            <button aria-label="Edit position" onClick={() => { setEditing(position); setFormOpen(true); }} title="Edit" type="button"><Pencil size={16} /></button>
            <button aria-label={position.status === "active" ? "Archive position" : "Restore position"} onClick={() => toggleArchive(position)} title={position.status === "active" ? "Archive" : "Restore"} type="button"><History size={16} /></button>
            <button aria-label="Delete position" className="delete-action" onClick={() => void handleDeletePosition(position)} title="Delete" type="button"><Trash2 size={16} /></button>
          </div>,
        ])}
      />
      {formOpen && <PositionForm existingDepartments={existingDepartments} initial={editing} onClose={() => { setFormOpen(false); setEditing(null); }} onSubmit={savePosition} />}
    </div>
  );
}

function PositionForm({
  existingDepartments,
  initial,
  onClose,
  onSubmit,
}: {
  existingDepartments: string[];
  initial: Position | null;
  onClose: () => void;
  onSubmit: (values: PositionFormValues) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [showDepartmentPopup, setShowDepartmentPopup] = useState(false);
  const [newDepartmentName, setNewDepartmentName] = useState("");
  const [values, setValues] = useState<PositionFormValues>(initial ? {
    name: initial.name,
    department: initial.department,
    description: initial.description,
    status: initial.status,
    pay_mode: initial.pay_mode,
    monthly_base_salary: String(initial.monthly_base_salary),
    daily_rate: String(initial.daily_rate ?? 0),
    categories: initial.categories.map((category) => ({ id: category.id, name: category.name, rate: String(category.rate), ticket_type: category.ticket_type ?? "installation", status: category.status })),
  } : {
    name: "",
    department: "",
    description: "",
    status: "active",
    pay_mode: "fixed",
    monthly_base_salary: "",
    daily_rate: "",
    categories: [],
  });
  const usesTickets = values.pay_mode === "ticket" || values.pay_mode === "hybrid";
  const departmentOptions = Array.from(
    new Set([...existingDepartments, ...(values.department.trim() ? [values.department.trim()] : [])]),
  ).sort((a, b) => a.localeCompare(b));

  return (
    <Modal className="billing-form-modal position-form-modal" title={initial ? "Edit position" : "Add position"} onClose={onClose}>
      <form className="billing-form-body" onSubmit={async (event) => { event.preventDefault(); setBusy(true); await onSubmit(values); setBusy(false); }}>
        <div className="billing-form-fields position-form-fields">
          <TextField label="Position name" value={values.name} onChange={(name) => setValues({ ...values, name })} required />
          <label>
            Department
            <div className="department-field">
              <select
                value={values.department}
                onChange={(event) => setValues({ ...values, department: event.target.value })}
              >
                <option value="">No department</option>
                {departmentOptions.map((department) => (
                  <option key={department} value={department}>{department}</option>
                ))}
              </select>
              <button
                aria-label="Add new department"
                className="secondary-button compact"
                onClick={() => { setNewDepartmentName(""); setShowDepartmentPopup(true); }}
                type="button"
              >
                <Plus size={15} /> New
              </button>
            </div>
          </label>
          <label>
            Pay method
            <select value={values.pay_mode} onChange={(event) => setValues({ ...values, pay_mode: event.target.value as PositionFormValues["pay_mode"] })}>
              <option value="fixed">Fixed salary</option>
              <option value="ticket">Per closed ticket</option>
              <option value="hybrid">Base salary + tickets</option>
              <option value="daily">Daily wage</option>
            </select>
          </label>
          {(values.pay_mode === "fixed" || values.pay_mode === "hybrid") && <MoneyInput label="Monthly base salary" value={values.monthly_base_salary} onChange={(monthly_base_salary) => setValues({ ...values, monthly_base_salary })} required />}
          {values.pay_mode === "daily" && <MoneyInput label="Daily rate" value={values.daily_rate} onChange={(daily_rate) => setValues({ ...values, daily_rate })} required />}
        </div>
        <label>
          Description
          <textarea rows={3} value={values.description} onChange={(event) => setValues({ ...values, description: event.target.value })} />
        </label>
        {usesTickets && (
          <section className="stack">
            <div className="section-heading"><div><p className="eyebrow">Ticket compensation</p><h3>Closed-ticket categories</h3></div><button className="secondary-button compact" onClick={() => setValues({ ...values, categories: [...values.categories, { name: "", rate: "", ticket_type: "installation" as const, status: "active" }] })} type="button"><Plus size={15} /> Add category</button></div>
            {values.categories.map((category, index) => (
              <div className="inline-fields" key={category.id ?? index}>
                <input aria-label="Category name" placeholder="Category name" value={category.name} onChange={(event) => setValues({ ...values, categories: values.categories.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} />
                <MoneyInput value={category.rate} placeholder="Rate" onChange={(rate) => setValues({ ...values, categories: values.categories.map((item, itemIndex) => itemIndex === index ? { ...item, rate } : item) })} />
                <select aria-label="Ticket type" value={category.ticket_type} onChange={(event) => setValues({ ...values, categories: values.categories.map((item, itemIndex) => itemIndex === index ? { ...item, ticket_type: event.target.value as "installation" | "repair" | "nap_rehab" } : item) })}><option value="installation">Installation</option><option value="repair">Repair</option><option value="nap_rehab">Nap Rehab</option></select>
                <select aria-label="Category status" value={category.status} onChange={(event) => setValues({ ...values, categories: values.categories.map((item, itemIndex) => itemIndex === index ? { ...item, status: event.target.value as PositionFormValues["categories"][number]["status"] } : item) })}><option value="active">Active</option><option value="archived">Archived</option></select>
                <button aria-label="Remove category" onClick={() => setValues({ ...values, categories: values.categories.filter((_, itemIndex) => itemIndex !== index) })} type="button"><Trash2 size={16} /></button>
              </div>
            ))}
          </section>
        )}
        <div className="form-actions">
          <button className="billing-btn outline" onClick={onClose} type="button">Cancel</button>
          <button className="billing-btn primary" disabled={busy} type="submit">{busy ? "Saving..." : initial ? "Save changes" : "Add position"}</button>
        </div>
      </form>
      {showDepartmentPopup && (
        <Modal title="New department" onClose={() => setShowDepartmentPopup(false)}>
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = newDepartmentName.trim();
              if (!trimmed) return;
              setValues((current) => ({ ...current, department: trimmed }));
              setShowDepartmentPopup(false);
            }}
          >
            <TextField
              autoFocus
              label="Department name"
              value={newDepartmentName}
              onChange={setNewDepartmentName}
              required
            />
            <div className="form-actions full">
              <button className="secondary-button" onClick={() => setShowDepartmentPopup(false)} type="button">
                Cancel
              </button>
              <button className="primary-button compact" disabled={!newDepartmentName.trim()} type="submit">
                Add department
              </button>
            </div>
          </form>
        </Modal>
      )}
    </Modal>
  );
}

export default PositionsView;
