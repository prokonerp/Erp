/**
 * Shared helper for opening the Quotation → Sales Order conversion popup.
 *
 * Both launch sites (the quotations list "Convert" action and the quotation
 * detail "Convert to Sales Order" action) behave identically via this helper:
 * a single centred, low-friction popup that re-uses the existing window on each
 * repeat click instead of stacking duplicates.
 *
 * CRITICAL: the features string intentionally omits `noopener` / `noreferrer`.
 * Per the HTML spec, including `noopener` makes `window.open()` return `null`
 * even on success, which would fire a false "allow pop-ups" error on every
 * conversion. We also need the returned handle to call `focus()` / navigate the
 * blank window. The target is a same-origin internal URL, so retaining `opener`
 * is acceptable and required here — do not "fix" this by nulling `win.opener`.
 */
export const SO_CONVERT_WINDOW = "prokon_so_convert";

/**
 * Opens (or re-uses) the Sales Order conversion popup, centred on screen.
 * Returns the window handle (safe to call `.focus()` / `.location.href` /
 * `.close()` on), or `null` when the browser blocked the popup.
 */
export function openSoConvertPopup(url: string): Window | null {
  // SSR guard — only called from click handlers, but stay defensive.
  if (typeof window === "undefined") return null;

  // Clamp the popup to 85/88% of the available screen so it never lands
  // partially off-screen on small displays.
  const w = Math.min(1280, Math.round(window.screen.availWidth * 0.85));
  const h = Math.min(900, Math.round(window.screen.availHeight * 0.88));
  const left = Math.max(0, Math.round((window.screen.availWidth - w) / 2));
  const top = Math.max(0, Math.round((window.screen.availHeight - h) / 2));

  // Activation rule: a click must reach window.open() SYNCHRONOUSLY (no `await`
  // before it) for the browser to treat it as a user gesture and allow the
  // popup. Callers are responsible for invoking this helper before any async
  // work; this helper only computes geometry and delegates to window.open().
  const features = `popup=yes,width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`;

  // Fixed window name => a repeat click re-uses the existing popup instead of
  // opening a duplicate. Passing it through `features` preserves resizability
  // and a scrollbar while staying small and focused.
  const win = window.open(url, SO_CONVERT_WINDOW, features);

  if (win) {
    // A named window is re-used across clicks. Detect a re-used (already-loaded)
    // popup by its real location — a brand-new window is still spinning up on
    // about:blank. On a repeat click, just bring the existing popup forward
    // rather than re-navigating or stacking another window.
    try {
      const href = win.location?.href ?? "";
      if (href && href !== "about:blank" && !href.startsWith("data:")) {
        win.focus();
      }
    } catch {
      // Cross-origin / locked-down handle — focus is the only safe call.
      try {
        win.focus();
      } catch {
        // Nothing further we can safely do with an inaccessible handle.
      }
    }
  }

  return win;
}
