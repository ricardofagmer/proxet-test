import type { ComponentProps } from "react";
import { getLocale } from "#/paraglide/runtime";
import { Select, SelectItem } from "#/components/ui/select";

// ISO 4217 code -> region whose flag represents it. EUR uses the EU flag.
const CURRENCY_REGIONS: ReadonlyArray<readonly [string, string]> = [
  ["PLN", "PL"],
  ["EUR", "EU"],
  ["USD", "US"],
  ["GBP", "GB"],
  ["CHF", "CH"],
  ["CZK", "CZ"],
  ["HUF", "HU"],
  ["RON", "RO"],
  ["BGN", "BG"],
  ["SEK", "SE"],
  ["NOK", "NO"],
  ["DKK", "DK"],
  ["ISK", "IS"],
  ["UAH", "UA"],
  ["TRY", "TR"],
  ["CAD", "CA"],
  ["MXN", "MX"],
  ["BRL", "BR"],
  ["ARS", "AR"],
  ["CLP", "CL"],
  ["COP", "CO"],
  ["JPY", "JP"],
  ["CNY", "CN"],
  ["HKD", "HK"],
  ["KRW", "KR"],
  ["INR", "IN"],
  ["SGD", "SG"],
  ["THB", "TH"],
  ["IDR", "ID"],
  ["AUD", "AU"],
  ["NZD", "NZ"],
  ["ZAR", "ZA"],
  ["AED", "AE"],
  ["ILS", "IL"],
];

const REGION_BY_CURRENCY = new Map(CURRENCY_REGIONS);

/** Turns a 2-letter region code into its flag emoji (regional indicators). */
function flagEmoji(region: string): string {
  return String.fromCodePoint(
    ...[...region.toUpperCase()].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65),
  );
}

function currencyName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "currency" }).of(code) ?? code;
  } catch {
    // Older runtimes without Intl.DisplayNames: the code alone is still usable.
    return code;
  }
}

function optionLabel(code: string, locale: string): string {
  const region = REGION_BY_CURRENCY.get(code);
  const flag = region ? `${flagEmoji(region)} ` : "";
  return `${flag}${code} — ${currencyName(code, locale)}`;
}

type CurrencySelectProps = Omit<ComponentProps<"select">, "value" | "onChange"> & {
  value: string;
  onValueChange: (currency: string) => void;
};

/**
 * Dropdown of supported ISO 4217 currencies with flags. A stored code outside
 * the list (e.g. an older account) is kept as an extra option so editing that
 * account never silently changes its currency.
 */
export function CurrencySelect({ value, onValueChange, ...props }: CurrencySelectProps) {
  const locale = getLocale();
  const codes = CURRENCY_REGIONS.map(([code]) => code);
  if (value && !REGION_BY_CURRENCY.has(value)) codes.unshift(value);

  return (
    <Select value={value} onChange={(e) => onValueChange(e.target.value)} {...props}>
      {codes.map((code) => (
        <SelectItem key={code} value={code}>
          {optionLabel(code, locale)}
        </SelectItem>
      ))}
    </Select>
  );
}
