import type { PendingMutation } from "../lib/offlineDb";

export type AppError = { message?: string; code?: string; details?: string | null };
export type QueueOfflineMutation = (
  mutation: Omit<PendingMutation, "id" | "createdAt" | "status" | "attempts" | "userId">,
) => Promise<void>;
