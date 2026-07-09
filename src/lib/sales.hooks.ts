import { useEffect, useRef, useState } from "react";

/** Debounces a value; returns the last stable value after `ms` idle. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/**
 * Wraps an async submit fn with a re-entry lock so users cannot double-submit
 * by rapid-clicking. Returns `[run, submitting]`.
 */
export function useSubmitOnce<Args extends unknown[], R>(fn: (...args: Args) => Promise<R>) {
  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false);
  const run = async (...args: Args): Promise<R | undefined> => {
    if (busy.current) return;
    busy.current = true;
    setSubmitting(true);
    try {
      return await fn(...args);
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  };
  return [run, submitting] as const;
}

/** Zero-based page + pageSize helper for Supabase `.range()`. */
export function pageRange(page: number, pageSize: number) {
  const from = Math.max(0, page * pageSize);
  const to = from + pageSize - 1;
  return { from, to };
}