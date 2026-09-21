import { useEffect, useState } from "react";
import { toast } from "sonner";
import { classifyGuardKey, isEditableTarget } from "@/lib/screen-guard";

/**
 * Installs the engineer-portal screen-capture deterrents while mounted and
 * removes every listener and class on unmount.
 *
 * HONEST SCOPE: a browser cannot block OS-level screenshots or screen
 * recording. These handlers only intercept the browser-mediated routes
 * (print / save / copy / context menu) and shield content while the tab is
 * hidden.
 */
export function useScreenGuard(): { hidden: boolean } {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const root = document.documentElement;

    const isEditableEventTarget = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      if (!el || typeof el.tagName !== "string") return false;
      return isEditableTarget(el.tagName ?? "", el.isContentEditable === true);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const action = classifyGuardKey({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      });
      if (!action) return;

      // PrintScreen is never a text-input keystroke, so it is always handled.
      // Every other guarded shortcut stands down inside a form field so normal
      // typing and "save page" muscle memory do not fight the form.
      if (action !== "printscreen" && isEditableEventTarget(event.target)) return;

      event.preventDefault();
      // A held key repeats; warn once, not every few milliseconds.
      if (event.repeat) return;
      toast.error("Screenshots, printing and saving are disabled.");
    };

    const onContextMenu = (event: Event) => {
      event.preventDefault();
    };

    const onClipboardLike = (event: Event) => {
      if (isEditableEventTarget(event.target)) return;
      event.preventDefault();
    };

    const onSelectStart = (event: Event) => {
      if (isEditableEventTarget(event.target)) return;
      event.preventDefault();
    };

    const onBeforePrint = () => {
      root.classList.add("screen-guard-printing");
    };

    const onAfterPrint = () => {
      root.classList.remove("screen-guard-printing");
    };

    const onVisibilityChange = () => {
      const isHidden = document.visibilityState === "hidden";
      setHidden(isHidden);
      if (isHidden) root.classList.add("screen-guard-hidden");
      else root.classList.remove("screen-guard-hidden");
    };

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("copy", onClipboardLike);
    document.addEventListener("cut", onClipboardLike);
    document.addEventListener("dragstart", onClipboardLike);
    document.addEventListener("selectstart", onSelectStart);
    window.addEventListener("beforeprint", onBeforePrint);
    window.addEventListener("afterprint", onAfterPrint);
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Apply the current visibility immediately (mount may happen while hidden).
    onVisibilityChange();

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("copy", onClipboardLike);
      document.removeEventListener("cut", onClipboardLike);
      document.removeEventListener("dragstart", onClipboardLike);
      document.removeEventListener("selectstart", onSelectStart);
      window.removeEventListener("beforeprint", onBeforePrint);
      window.removeEventListener("afterprint", onAfterPrint);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      root.classList.remove("screen-guard-printing");
      root.classList.remove("screen-guard-hidden");
    };
  }, []);

  return { hidden };
}
