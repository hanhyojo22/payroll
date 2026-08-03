import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as
  | string
  | undefined;
const supabaseEmailRedirectUrl = import.meta.env.VITE_SUPABASE_EMAIL_REDIRECT_URL as string | undefined;

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        // Payroll sessions should not survive a browser/tab restart on a shared computer.
        // sessionStorage still supports refreshes within the active tab.
        persistSession: true,
        storage: typeof window === "undefined" ? undefined : window.sessionStorage,
      },
    })
  : null;

export const emailRedirectUrl = supabaseEmailRedirectUrl?.trim() || undefined;
