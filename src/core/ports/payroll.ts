import type {
  PayrollHistoryRow,
  PayrollRunItem,
  PayrollRunWithItems,
  PayrollSettings,
} from "../../types";
import type { Result } from "./result";

export type PayrollSettingsPayload = {
  government_deduction_enabled: boolean;
  government_deduction_cutoff: PayrollSettings["government_deduction_cutoff"];
};

/** Written across payroll_runs, payroll_run_items, ticket details, advances and bonds at once. */
export type PayrollBundle = {
  runPayload: Record<string, unknown>;
  itemPayloads: Record<string, unknown>[];
  detailPayloads: Record<string, unknown>[];
  employeeAdvanceUpdates: Array<{ id: string; payload: Record<string, unknown> }>;
  salaryBondTransactionPayloads: Record<string, unknown>[];
};

export type PayrollItemsBundle = {
  itemPayloads: Record<string, unknown>[];
  detailPayloads: Record<string, unknown>[];
  employeeAdvanceUpdates: Array<{ id: string; payload: Record<string, unknown> }>;
  salaryBondTransactionPayloads: Record<string, unknown>[];
};

export interface PayrollRepository {
  listRuns(): Promise<Result<PayrollRunWithItems[]>>;
  listRunItems(runId: string): Promise<Result<PayrollRunItem[]>>;
  listHistory(page: number, pageSize: number): Promise<Result<PayrollHistoryRow[]>>;

  getSettings(): Promise<Result<PayrollSettings | null>>;
  ensureSettings(userId: string): Promise<Result<PayrollSettings>>;
  saveSettings(userId: string, payload: PayrollSettingsPayload): Promise<Result<void>>;

  updateItem(id: string, patch: Partial<PayrollRunItem>): Promise<Result<void>>;

  /** Both bundles go through RPCs that write every table in one transaction. */
  saveBundle(bundle: PayrollBundle): Promise<Result<void>>;
  saveItemsBundle(bundle: PayrollItemsBundle): Promise<Result<void>>;

  /** Used to recover the existing run when generation collides with the period unique key. */
  findRunId(periodMonth: number, periodYear: number, payPeriod: string): Promise<Result<string | null>>;

  insertSalaryBondTransactions(payloads: Record<string, unknown>[]): Promise<Result<void>>;
}
