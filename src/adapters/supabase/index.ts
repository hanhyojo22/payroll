import type { SupabaseClient } from "@supabase/supabase-js";
import type { Repositories } from "../../core/ports";
import { supabaseCollectionRepository } from "./collectionRepository";

/**
 * Composition root for data access: the single place where a SupabaseClient is turned into
 * the port implementations the rest of the app depends on.
 */
export function createSupabaseRepositories(supabase: SupabaseClient): Repositories {
  return {
    collections: supabaseCollectionRepository(supabase),
  };
}
