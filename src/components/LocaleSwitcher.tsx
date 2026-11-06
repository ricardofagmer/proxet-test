import type { ReactElement } from "react";
import { getLocale, locales, setLocale, isLocale } from "#/paraglide/runtime";
import { m } from "#/paraglide/messages";

// Each language is shown in its own language ("Polski", "Español"), the
// convention for language pickers, so no translated names are needed.
function nativeLanguageName(locale: string): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: "language" }).of(locale);
    return name ? name.charAt(0).toLocaleUpperCase(locale) + name.slice(1) : locale;
  } catch {
    return locale;
  }
}

/** Language picker. Changing it stores the choice in a cookie and reloads the page. */
export default function LocaleSwitcher({ id = "locale-switcher" }: { id?: string }): ReactElement {
  const currentLocale = getLocale();

  return (
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor={id} className="text-muted-foreground">
        {m.language_label()}
      </label>
      <select
        id={id}
        value={currentLocale}
        onChange={(event) => {
          const next = event.target.value;
          if (isLocale(next)) setLocale(next);
        }}
        className="flex-1 min-w-0 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {locales.map((locale) => (
          <option key={locale} value={locale}>
            {nativeLanguageName(locale)}
          </option>
        ))}
      </select>
    </div>
  );
}
