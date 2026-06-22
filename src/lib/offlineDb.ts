import type { ResourceKey } from "../types";

export type PendingMutationStatus = "pending" | "failed";
export type PendingMutationOperation = "insert" | "update" | "delete" | "upsert" | "payroll_group" | "payroll_items_group" | "billing_group" | "collection_payment" | "collection_payment_void";

export type PendingMutation = {
  id: string;
  userId: string;
  resource: ResourceKey;
  affectedResources: ResourceKey[];
  operation: PendingMutationOperation;
  table: string;
  recordId?: string;
  match?: Record<string, unknown>;
  payload?: unknown;
  options?: { onConflict?: string };
  createdAt: string;
  status: PendingMutationStatus;
  attempts: number;
  lastError?: string;
};

type ResourceCacheRecord = {
  key: string;
  userId: string;
  resource: ResourceKey;
  data: unknown;
  updatedAt: string;
};

type SyncMetaRecord = {
  key: string;
  userId: string;
  resource: ResourceKey;
  lastSyncedAt: string;
  status: "synced" | "pending" | "failed";
};

const DB_NAME = "payroll_app_offline";
const DB_VERSION = 1;
const RESOURCE_CACHE_STORE = "resource_cache";
const PENDING_MUTATIONS_STORE = "pending_mutations";
const SYNC_META_STORE = "sync_meta";

let dbPromise: Promise<IDBDatabase> | null = null;

function openOfflineDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(RESOURCE_CACHE_STORE)) {
        db.createObjectStore(RESOURCE_CACHE_STORE, { keyPath: "key" });
      }

      if (!db.objectStoreNames.contains(PENDING_MUTATIONS_STORE)) {
        const store = db.createObjectStore(PENDING_MUTATIONS_STORE, { keyPath: "id" });
        store.createIndex("userId_status_createdAt", ["userId", "status", "createdAt"]);
      }

      if (!db.objectStoreNames.contains(SYNC_META_STORE)) {
        db.createObjectStore(SYNC_META_STORE, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function resourceKey(userId: string, resource: ResourceKey) {
  return `${userId}:${resource}`;
}

function promisifyRequest<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await openOfflineDb();
  const transaction = db.transaction(storeName, mode);
  return promisifyRequest(callback(transaction.objectStore(storeName)));
}

export async function readCachedResource<T>(resource: ResourceKey, userId: string) {
  try {
    const record = await withStore<ResourceCacheRecord | undefined>(
      RESOURCE_CACHE_STORE,
      "readonly",
      (store) => store.get(resourceKey(userId, resource)),
    );
    return record ? record.data as T : null;
  } catch {
    return null;
  }
}

export async function writeCachedResource<T>(resource: ResourceKey, userId: string, data: T) {
  const record: ResourceCacheRecord = {
    key: resourceKey(userId, resource),
    userId,
    resource,
    data,
    updatedAt: new Date().toISOString(),
  };
  await withStore(RESOURCE_CACHE_STORE, "readwrite", (store) => store.put(record));
  await writeSyncMeta(userId, resource, "synced");
}

export async function writeSyncMeta(
  userId: string,
  resource: ResourceKey,
  status: SyncMetaRecord["status"],
) {
  const record: SyncMetaRecord = {
    key: resourceKey(userId, resource),
    userId,
    resource,
    lastSyncedAt: new Date().toISOString(),
    status,
  };
  await withStore(SYNC_META_STORE, "readwrite", (store) => store.put(record));
}

export async function queueMutation(mutation: Omit<PendingMutation, "id" | "createdAt" | "status" | "attempts">) {
  const record: PendingMutation = {
    ...mutation,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: "pending",
    attempts: 0,
  };
  const db = await openOfflineDb();
  const transaction = db.transaction(PENDING_MUTATIONS_STORE, "readwrite");
  const store = transaction.objectStore(PENDING_MUTATIONS_STORE);
  const records = await promisifyRequest<PendingMutation[]>(store.getAll());
  const sameRecordMutations = records.filter((item) =>
    item.userId === record.userId &&
    item.status === "pending" &&
    item.table === record.table &&
    item.recordId &&
    item.recordId === record.recordId
  );

  const pendingInsert = sameRecordMutations.find((item) => item.operation === "insert");
  if (pendingInsert && (record.operation === "update" || record.operation === "upsert")) {
    const merged: PendingMutation = {
      ...pendingInsert,
      affectedResources: Array.from(new Set([...pendingInsert.affectedResources, ...record.affectedResources])),
      payload: {
        ...((pendingInsert.payload ?? {}) as Record<string, unknown>),
        ...((record.payload ?? {}) as Record<string, unknown>),
      },
    };
    for (const item of sameRecordMutations) store.delete(item.id);
    await promisifyRequest(store.put(merged));
    await Promise.all(merged.affectedResources.map((resource) => writeSyncMeta(merged.userId, resource, "pending")));
    return merged;
  }

  for (const item of sameRecordMutations) {
    if (
      record.operation === "delete" ||
      record.operation === "update" ||
      record.operation === "upsert"
    ) {
      store.delete(item.id);
    }
  }

  await promisifyRequest(store.put(record));
  await Promise.all(record.affectedResources.map((resource) => writeSyncMeta(record.userId, resource, "pending")));
  return record;
}

export async function getPendingMutations(userId: string) {
  const db = await openOfflineDb();
  const transaction = db.transaction(PENDING_MUTATIONS_STORE, "readonly");
  const store = transaction.objectStore(PENDING_MUTATIONS_STORE);
  const records = await promisifyRequest<PendingMutation[]>(store.getAll());

  return records
    .filter((record) => record.userId === userId && record.status === "pending")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function deleteMutation(id: string) {
  await withStore(PENDING_MUTATIONS_STORE, "readwrite", (store) => store.delete(id));
}

export async function markMutationFailed(id: string, attempts: number, lastError: string) {
  const db = await openOfflineDb();
  const transaction = db.transaction(PENDING_MUTATIONS_STORE, "readwrite");
  const store = transaction.objectStore(PENDING_MUTATIONS_STORE);
  const record = await promisifyRequest<PendingMutation | undefined>(store.get(id));
  if (!record) return;

  await promisifyRequest(store.put({
    ...record,
    attempts,
    lastError,
    status: "failed",
  }));
}
