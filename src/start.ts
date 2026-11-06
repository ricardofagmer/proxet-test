import { createMiddleware, createStart } from "@tanstack/react-start";
import { isForbiddenCrossSite, securityHeaders } from "#/lib/http-security";

//
// Establishes the per-request context (request id, logging, error capture)
// around every request. Must run first so every other middleware and handler
// executes inside the AsyncLocalStorage scope. The implementation lives in a
// server-only module loaded via dynamic import — start.ts itself is pulled
// into the client bundle, and a static import of pino/Sentry would leak the
// server bundle into it.
const requestContextMiddleware = createMiddleware().server(
  async ({ next, request }) => {
    const { handleRequest } = await import("#/server/observability.server");
    return handleRequest(request, next);
  },
);

// Scopes the UI locale (PARAGLIDE_LOCALE cookie, then Accept-Language) to the
// request so SSR and server-function messages match what the client renders.
// Dynamic import: the server module pulls in node:async_hooks.
const localeMiddleware = createMiddleware().server(async ({ next, request }) => {
  const { runWithRequestLocale } = await import("#/server/locale.server");
  return runWithRequestLocale(request, () => next());
});

// Reports errors thrown inside server-function handlers — these are
// serialized into RPC responses by TanStack before the request middleware
// could see them.
const errorCaptureFunctionMiddleware = createMiddleware({
  type: "function",
}).server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    const { onServerFnError } = await import("#/server/observability.server");
    onServerFnError(error);
    throw error;
  }
});


// Arms the hourly compliance sweep (GDPR deletion grace period, AI raw
// response retention) on the first request — there is no external cron.
// Dynamic import for the same client-bundle reason as above; no-op after
// the first call.
const maintenanceMiddleware = createMiddleware().server(async ({ next }) => {
  const { ensureMaintenanceLoop } = await import("#/server/maintenance.server");
  ensureMaintenanceLoop();
  return next();
});


// Rejects state-changing requests that are provably cross-site (CSRF).
// sameSite=lax session cookies are the primary defense; this backstops them
// with Sec-Fetch-Site / Origin checks on every non-GET request.
const csrfMiddleware = createMiddleware().server(({ next, request }) => {
  if (isForbiddenCrossSite(request.method, request.headers, request.url)) {
    return new Response("Cross-site request rejected", { status: 403 });
  }
  return next();
});

// Adds standard security headers (CSP, nosniff, frame denial, referrer
// policy, HSTS in prod) to every response.
const securityHeadersMiddleware = createMiddleware().server(
  async ({ next }) => {
    const result = await next();
    const headers = securityHeaders(process.env.NODE_ENV === "production");
    for (const [name, value] of Object.entries(headers)) {
      result.response.headers.set(name, value);
    }
    return result;
  },
);

export const startInstance = createStart(() => ({
  requestMiddleware: [
    requestContextMiddleware,
    localeMiddleware,
    maintenanceMiddleware,
    csrfMiddleware,
    securityHeadersMiddleware,
  ],
  functionMiddleware: [errorCaptureFunctionMiddleware],
}));
