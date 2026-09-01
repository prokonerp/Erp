/**
 * routeState — session-persisted UI state for TanStack Router pages
 *
 * Drop-in replacements for useState that survive navigation.
 * Stored in sessionStorage keyed by pathname + key (+ optional scope).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "@tanstack/react-router";

const NS_ROUTE = "prokon:route";
const NS_DRAFT = "prokon:draft";

function storageAvailable(type: "sessionStorage" | "localStorage"): boolean {
  if (typeof window === "undefined") return false;
  try {
    const storage = window[type] as Storage;
    const k = "__probe__";
    storage.setItem(k, "1");
    storage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

function buildKey(ns: string, pathname: string, key: string, scope?: string): string {
  const sc = scope ? `:${scope}` : "";
  return `${ns}:${pathname}${sc}:${key}`;
}

function readJSON<T>(storage: Storage | null, key: string, fallback: T): T {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    return (parsed as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(storage: Storage | null, key: string, value: unknown): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {}
}

function removeKey(storage: Storage | null, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {}
}

export type RouteStateOptions<T> = {
  scope?: string;
  clearOnUnmount?: boolean;
  serialize?: (v: T) => unknown;
  deserialize?: (raw: unknown, fallback: T) => T;
};

export function useRouteState<T>(
  key: string,
  initial: T,
  opts: RouteStateOptions<T> = {},
): [T, React.Dispatch<React.SetStateAction<T>>, () => void] {
  const location = useLocation();
  const pathname = location.pathname;
  const scope = opts.scope;
  const storageKey = useMemo(() => buildKey(NS_ROUTE, pathname, key, scope), [pathname, key, scope]);
  const canStore = storageAvailable("sessionStorage");
  const storage = canStore ? (window.sessionStorage as Storage) : null;

  const [value, setValue] = useState<T>(() => {
    if (opts.deserialize) {
      const raw = readJSON<unknown>(storage, storageKey, undefined as unknown as T);
      if (raw !== undefined) return opts.deserialize(raw, initial);
      return initial;
    }
    return readJSON<T>(storage, storageKey, initial);
  });

  const initialized = useRef(false);
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      return;
    }
    if (opts.serialize) writeJSON(storage, storageKey, opts.serialize(value));
    else writeJSON(storage, storageKey, value);
  }, [value, storageKey, storage, opts]);

  useEffect(() => {
    const restored = opts.deserialize
      ? (() => {
          const raw = readJSON<unknown>(storage, storageKey, undefined as unknown);
          if (raw !== undefined) return opts.deserialize(raw, initial);
          return initial;
        })()
      : readJSON<T>(storage, storageKey, initial);
    setValue((prev) => {
      try {
        return JSON.stringify(prev) === JSON.stringify(restored) ? prev : restored;
      } catch {
        return restored as T;
      }
    });
    initialized.current = false;
  }, [storageKey]);

  useEffect(() => {
    if (!opts.clearOnUnmount) return;
    return () => removeKey(storage, storageKey);
  }, [storageKey, opts.clearOnUnmount, storage]);

  const clear = useCallback(() => {
    removeKey(storage, storageKey);
    setValue(initial);
  }, [storage, storageKey, initial]);

  return [value, setValue, clear];
}

export type DraftStateOptions<T> = {
  scope?: string;
  serialize?: (v: T) => unknown;
  deserialize?: (raw: unknown, fallback: T) => T;
};

export function useDraftState<T>(
  key: string,
  initial: T,
  opts: DraftStateOptions<T> = {},
): [T, React.Dispatch<React.SetStateAction<T>>, () => void, boolean] {
  const location = useLocation();
  const pathname = location.pathname;
  const scope = opts.scope;
  const storageKey = useMemo(() => buildKey(NS_DRAFT, pathname, key, scope), [pathname, key, scope]);
  const canStore = storageAvailable("localStorage");
  const storage = canStore ? (window.localStorage as Storage) : null;

  const [value, setValue] = useState<T>(() => {
    if (opts.deserialize) {
      const raw = readJSON<unknown>(storage, storageKey, undefined as unknown);
      if (raw !== undefined) return opts.deserialize(raw, initial);
      return initial;
    }
    return readJSON<T>(storage, storageKey, initial);
  });

  const hasDraft = useMemo(() => {
    if (!storage) return false;
    try {
      return storage.getItem(storageKey) != null;
    } catch {
      return false;
    }
  }, [storage, storageKey]);

  const initialized = useRef(false);
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      return;
    }
    if (opts.serialize) writeJSON(storage, storageKey, opts.serialize(value));
    else writeJSON(storage, storageKey, value);
  }, [value, storageKey, storage, opts]);

  useEffect(() => {
    const restored = opts.deserialize
      ? (() => {
          const raw = readJSON<unknown>(storage, storageKey, undefined as unknown);
          if (raw !== undefined) return opts.deserialize(raw, initial);
          return initial;
        })()
      : readJSON<T>(storage, storageKey, initial);
    setValue((prev) => {
      try {
        return JSON.stringify(prev) === JSON.stringify(restored) ? prev : restored;
      } catch {
        return restored as T;
      }
    });
    initialized.current = false;
  }, [storageKey]);

  const clear = useCallback(() => {
    removeKey(storage, storageKey);
    setValue(initial);
  }, [storage, storageKey, initial]);

  return [value, setValue, clear, hasDraft];
}

export function useObjectRouteState<T extends Record<string, unknown>>(
  namespace: string,
  initial: T,
): [T, (patch: Partial<T> | ((prev: T) => T)) => void, () => void] {
  const location = useLocation();
  const pathname = location.pathname;
  const storageKey = useMemo(() => buildKey(NS_ROUTE, pathname, namespace), [pathname, namespace]);
  const canStore = storageAvailable("sessionStorage");
  const storage = canStore ? (window.sessionStorage as Storage) : null;

  const [value, setValue] = useState<T>(() => readJSON<T>(storage, storageKey, initial));

  const initialized = useRef(false);
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      return;
    }
    writeJSON(storage, storageKey, value);
  }, [value, storageKey, storage]);

  useEffect(() => {
    const restored = readJSON<T>(storage, storageKey, initial);
    setValue((prev) => {
      try {
        return JSON.stringify(prev) === JSON.stringify(restored) ? prev : restored;
      } catch {
        return restored;
      }
    });
    initialized.current = false;
  }, [storageKey]);

  const set = useCallback((patch: Partial<T> | ((prev: T) => T)) => {
    setValue((prev) => {
      if (typeof patch === "function") return (patch as (p: T) => T)(prev);
      return { ...prev, ...patch };
    });
  }, []);

  const clear = useCallback(() => {
    removeKey(storage, storageKey);
    setValue(initial);
  }, [storage, storageKey, initial]);

  return [value, set, clear];
}

export function clearRouteState(key: string, scope?: string): void {
  if (!storageAvailable("sessionStorage")) return;
  try {
    const pathname = window.location.pathname;
    window.sessionStorage.removeItem(buildKey(NS_ROUTE, pathname, key, scope));
  } catch {}
}

export function clearAllRouteStateForPath(pathname?: string): void {
  if (!storageAvailable("sessionStorage")) return;
  try {
    const p = pathname ?? window.location.pathname;
    const prefix = `${NS_ROUTE}:${p}:`;
    const toDelete: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k && k.startsWith(prefix)) toDelete.push(k);
    }
    toDelete.forEach((k) => window.sessionStorage.removeItem(k));
  } catch {}
}

export function clearDraftState(key: string, scope?: string): void {
  if (!storageAvailable("localStorage")) return;
  try {
    const pathname = window.location.pathname;
    window.localStorage.removeItem(buildKey(NS_DRAFT, pathname, key, scope));
  } catch {}
}
