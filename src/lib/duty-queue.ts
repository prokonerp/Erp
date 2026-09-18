import type { QueuedPing } from "@/lib/field-location";

// Offline outbox (IndexedDB — survives app kill, unlike memory/localStorage).
// Pure storage module: no React, so hooks files stay fast-refresh clean.

const DB_NAME = "field-location";
const STORE = "ping-queue";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "client_ping_id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

export function newClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `ping-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export async function enqueuePing(ping: QueuedPing): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(ping);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("queue write failed"));
    });
  } finally {
    db.close();
  }
}

export async function readQueue(): Promise<QueuedPing[]> {
  const db = await openDb();
  try {
    return await new Promise<QueuedPing[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result ?? []) as QueuedPing[]);
      req.onerror = () => reject(req.error ?? new Error("queue read failed"));
    });
  } finally {
    db.close();
  }
}

export async function removeQueued(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const id of ids) store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("queue delete failed"));
    });
  } finally {
    db.close();
  }
}

export async function queueCount(): Promise<number> {
  try {
    return (await readQueue()).length;
  } catch {
    return 0;
  }
}
