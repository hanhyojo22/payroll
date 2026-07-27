import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Repositories } from "../core/ports";
import { createSupabaseRepositories } from "../adapters/supabase";
import { supabase } from "../supabase";

const RepositoriesContext = createContext<Repositories | null>(null);

/**
 * Supplies the port implementations to the component tree. Defaults to the Supabase adapter;
 * `value` lets a test or story mount the tree against fakes instead.
 */
export function RepositoriesProvider({
  children,
  value,
}: {
  children: ReactNode;
  value?: Repositories;
}) {
  const repositories = useMemo(
    () => value ?? (supabase ? createSupabaseRepositories(supabase) : null),
    [value],
  );

  return (
    <RepositoriesContext.Provider value={repositories}>
      {children}
    </RepositoriesContext.Provider>
  );
}

/**
 * Throws rather than returning null: every caller is inside the provider, and a missing
 * provider is a wiring bug worth failing loudly instead of degrading silently.
 */
export function useRepositories(): Repositories {
  const repositories = useContext(RepositoriesContext);
  if (!repositories) {
    throw new Error("useRepositories must be used inside <RepositoriesProvider> with Supabase configured.");
  }
  return repositories;
}
