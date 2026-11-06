import { AsyncLocalStorage } from "node:async_hooks";
import {
  extractLocaleFromRequest,
  overwriteServerAsyncLocalStorage,
  type Locale,
} from "#/paraglide/runtime";

interface LocaleStore {
  locale?: Locale;
  origin?: string;
  messageCalls?: Set<string>;
}

// Paraglide's getLocale() reads this store on the server, so SSR output and
// server-function messages use the request's locale instead of the base one.
// Without it the server would render English and the client would then
// hydrate in the cookie's language.
const localeStorage = new AsyncLocalStorage<LocaleStore>();
overwriteServerAsyncLocalStorage(localeStorage);

/** Runs `handler` with the locale resolved from the request (cookie, then Accept-Language). */
export function runWithRequestLocale<T>(request: Request, handler: () => T): T {
  const locale = extractLocaleFromRequest(request);
  return localeStorage.run(
    { locale, origin: new URL(request.url).origin, messageCalls: new Set() },
    handler,
  );
}
