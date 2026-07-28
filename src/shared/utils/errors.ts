import type { AppError } from "../types";

// Phrases browsers actually use when a request never left the machine. Matching the bare word
// "network" instead would misread real Postgres errors that quote user data (a client named
// "Alpha Network Solutions") as an internet outage.
export const CONNECTIVITY_FAILURE_PHRASES = [
  "failed to fetch",      // Chrome
  "networkerror",         // Firefox
  "network error",
  "network request failed",
  "load failed",          // Safari
  "connection refused",
  "err_internet_disconnected",
  "request timed out",
];

// A server-assigned code (SQLSTATE, PGRST...) proves the request reached Postgres, so it is a
// real failure rather than a connectivity blip. REQUEST_TIMEOUT is ours, not the server's.
export const isConnectivityFailure = (error: { code?: string; message?: string; details?: string | null } | null | undefined) => {
  if (error?.code && error.code !== "REQUEST_TIMEOUT") return false;
  const text = `${error?.message ?? ""} ${error?.details ?? ""}`.toLowerCase();
  return CONNECTIVITY_FAILURE_PHRASES.some((phrase) => text.includes(phrase));
};

// Whether the login form's dedicated "incorrect email or password" inline message and red
// field borders apply. Anything else (network, timeout, unconfirmed email) needs its own
// accurate toast instead of being mislabeled as a wrong password.
export const isInvalidCredentialsError = (error: { code?: string; message?: string } | null | undefined) => {
  if (error?.code === "REQUEST_TIMEOUT") return false;
  return (error?.message ?? "").toLowerCase().includes("invalid login credentials");
};

export const friendlyError = (
  error: AppError | null | undefined,
  fallback = "Something went wrong. Please try again.",
) => {
  const message = `${error?.message ?? ""} ${error?.details ?? ""}`.toLowerCase();

  if (message.includes("payroll_runs_user_id_period_month_period_year_pay_period_key")) {
    return "Payroll for that month and pay period already exists. Select it from Payroll history instead.";
  }
  if (message.includes("payroll_runs_user_id_period_month_period_year_key")) {
    return "Payroll for that month already exists. Select it from Payroll history, or use the other pay period.";
  }
  if (message.includes("payment_reminders") && message.includes("schema cache")) {
    return "Payment tables are not ready yet. Run the latest Supabase SQL setup, then refresh the app.";
  }
  if ((message.includes("expenses") || message.includes("expense_categories")) && message.includes("schema cache")) {
    return "Expense tables are not ready yet. Run the latest Supabase SQL setup, then refresh the app.";
  }
  if ((message.includes("collection_reminders") || message.includes("collection_payments")) && message.includes("schema cache")) {
    return "Collection tables are not ready yet. Run the latest Supabase SQL setup, then refresh the app.";
  }
  if (message.includes("daily_ticket_entries") && message.includes("schema cache")) {
    return "Daily ticket tables are not ready yet. Run the latest Supabase SQL setup, then refresh the app.";
  }
  if ((message.includes("positions") || message.includes("position_ticket_categories")) && message.includes("schema cache")) {
    return "Position compensation tables are not ready yet. Run the latest Supabase SQL setup, then refresh the app.";
  }
  if (
    (message.includes("employees") || message.includes("payroll_runs") || message.includes("payroll_run_items")) &&
    message.includes("schema cache")
  ) {
    return "Payroll tables are not ready yet. Run the latest Supabase SQL setup, then refresh the app.";
  }
  if (message.includes("row-level security") || message.includes("violates row-level security")) {
    return "This record could not be saved for your account. Please sign in again and retry.";
  }
  if (message.includes("invalid login credentials")) {
    return "Email or password is incorrect.";
  }
  if (message.includes("email not confirmed")) {
    return "Please confirm your email before signing in.";
  }
  // Supabase's own SMTP relay failed to send, not something a retry from this form fixes.
  // Whether the account itself was created is genuinely ambiguous from here, so say so
  // rather than implying the admin did something wrong.
  if (message.includes("error sending confirmation email")) {
    return "The confirmation email could not be sent. Your account may or may not have been created — try signing in, and if that fails, check your Supabase project's email/SMTP configuration before trying again.";
  }
  if (isConnectivityFailure(error) && error?.code !== "REQUEST_TIMEOUT") {
    return "Unable to connect. Check your internet connection and Supabase settings.";
  }
  if (error?.code === "REQUEST_TIMEOUT" || message.includes("request timed out")) {
    return error?.details || error?.message || "A cloud request timed out. Please try again.";
  }
  if (message.includes("duplicate key")) {
    return "This record already exists. Check the selected month, pay period, or existing records.";
  }
  if (message.includes("jwt") || message.includes("refresh token")) {
    return "Your session expired. Please sign in again.";
  }
  if (message.includes("invalid api key") || message.includes("api key")) {
    return "Supabase credentials look incorrect. Check your .env file and restart the app.";
  }
  if (message.includes("permission denied")) {
    return "You do not have permission to do that. Please check your account or database policies.";
  }
  // Postgres spells these out with the relation, the constraint name, and a "Failing row
  // contains (...)" dump of the row's actual values -- employee names and salaries in this
  // app. Surface the column name at most; never the raw message or details.
  if (message.includes("null value in column") || message.includes("violates not-null constraint")) {
    const column = /null value in column "([^"]+)"/.exec(error?.message ?? "")?.[1];
    return column
      ? `Please provide a value for "${column}" before saving.`
      : "A required field is missing. Please complete the form and try again.";
  }
  if (message.includes("check constraint")) {
    return "A saved value does not match the database rules. Please review the form and try again.";
  }

  return error?.message || fallback;
};
