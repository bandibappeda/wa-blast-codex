import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export interface NormalizedPhone {
  e164: string;
  display: string;
}

export function normalizePhone(input: string, defaultCountry: string): NormalizedPhone | null {
  const country = defaultCountry.toUpperCase() as CountryCode;
  const parsed = parsePhoneNumberFromString(input.trim(), country);
  if (!parsed || !parsed.isValid()) return null;
  return { e164: parsed.number, display: input.trim() };
}
