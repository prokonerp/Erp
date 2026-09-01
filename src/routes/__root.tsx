import { Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/lib/theme";

/** Applies the persisted appearance classes before first paint (no flash). Locked to Navy Premium (light). */
const themeBootScript = `(function(){try{var t=localStorage.getItem("prokon-theme");if(t==="balanced"||t==="comfort"){t="light";localStorage.setItem("prokon-theme","light");}var d=document.documentElement;var cls=d.classList;cls.remove("theme-balanced","theme-comfort","dark");if(t==="dark"){cls.add("dark");d.dataset.appearance="dark";}else if(t==="system"){if(matchMedia("(prefers-color-scheme: dark)").matches){cls.add("dark");d.dataset.appearance="dark";}else{d.dataset.appearance="light";}}else{d.dataset.appearance="light";}}catch(e){}})();`;

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Prokon ERP" },
      {
        name: "description",
        content:
          "Prokon ERP — sales, service, inventory and procurement in one enterprise workspace.",
      },
      { name: "author", content: "Prokon Hi-Tech Systems" },
      { property: "og:title", content: "Prokon ERP" },
      {
        property: "og:description",
        content:
          "Prokon ERP — sales, service, inventory and procurement in one enterprise workspace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Prokon ERP" },
      {
        name: "twitter:description",
        content:
          "Prokon ERP — sales, service, inventory and procurement in one enterprise workspace.",
      },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  // Suppress noisy, non-actionable `startTime` / `reportAllChanges` crashes
  // that surface as `VM###:2 Uncaught TypeError: Cannot read properties of
  // undefined (reading 'startTime') at et.reportAllChanges` from:
  //  - Chrome extensions / Vite HMR overlay perf observers
  //  - React Scheduler profiling in dev (`scheduler` package)
  //  - jspdf-autotable / html2canvas performance.measure calls when the
  //    PerformanceEntry list is empty.
  // These are global, not route-specific, so install once at the root.
  if (typeof window !== "undefined") {
    // Guard PerformanceObserver so a missing entry never throws inside the
    // native callback — defensive patch for `entry.startTime` access.
    try {
      const OrigPO = (window as any).PerformanceObserver;
      if (OrigPO && !(OrigPO as any).__patchedForStartTime) {
        const Patched = function (this: any, cb: PerformanceObserverCallback) {
          const wrapped: PerformanceObserverCallback = (list, obs, ...rest) => {
            try {
              const entries = list.getEntries?.() ?? [];
              // Filter out entries missing startTime — extension / HMR bug.
              const safe = entries.filter((e: any) => e && typeof e.startTime === "number");
              if (safe.length === 0 && entries.length > 0) return;
              return cb(list, obs, ...rest);
            } catch (e) {
              // Swallow perf-observer noise, don't break the app.
              if (String((e as any)?.message || "").includes("startTime")) return;
              throw e;
            }
          };
          return new OrigPO(wrapped);
        } as unknown as typeof PerformanceObserver;
        (Patched as any).__patchedForStartTime = true;
        // Preserve static members
        try { Object.assign(Patched, OrigPO); } catch {}
        (window as any).PerformanceObserver = Patched;
      }
    } catch {}

    // Global error filter — swallow the minified `et.reportAllChanges` noise
    // without hiding real app errors. We check message + stack.
    const isPerfNoise = (msg: string, stack = "") => {
      const m = (msg || "").toLowerCase();
      const s = (stack || "").toLowerCase();
      return (
        (m.includes("starttime") && (m.includes("undefined") || s.includes("reportallchanges"))) ||
        s.includes("reportallchanges") ||
        (m.includes("cannot read properties of undefined") && m.includes("starttime"))
      );
    };
    if (!(window as any).__perfNoiseHandlerInstalled) {
      (window as any).__perfNoiseHandlerInstalled = true;
      window.addEventListener("error", (ev) => {
        const msg = (ev as ErrorEvent).message || String((ev as any).error?.message || "");
        const stack = String((ev as any).error?.stack || "");
        if (isPerfNoise(msg, stack)) {
          ev.preventDefault();
          console.debug("[perf-guard] suppressed startTime/reportAllChanges noise", msg);
        }
      });
      window.addEventListener("unhandledrejection", (ev) => {
        const reason: any = (ev as PromiseRejectionEvent).reason;
        const msg = String(reason?.message || reason || "");
        const stack = String(reason?.stack || "");
        if (isPerfNoise(msg, stack)) {
          ev.preventDefault();
          console.debug("[perf-guard] suppressed async startTime noise", msg);
        }
      });
    }
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <Suspense fallback={<div />}>
          <Outlet />
        </Suspense>
        <Toaster richColors position="top-right" />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
