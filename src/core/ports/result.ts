import type { AppError } from "../../shared/types";

/**
 * One result shape across the data-access boundary, replacing the per-repository
 * `{ data, error }` variants. Repositories return errors rather than throwing, matching
 * how Supabase and the existing `settle()` helper already behave.
 */
export type Result<T> =
  | { data: T; error: null }
  | { data: null; error: AppError };

export const ok = <T>(data: T): Result<T> => ({ data, error: null });
export const err = <T = never>(error: AppError): Result<T> => ({ data: null, error });

/** Narrowing helper so callers can branch without repeating the null check. */
export const isOk = <T>(result: Result<T>): result is { data: T; error: null } => result.error === null;
