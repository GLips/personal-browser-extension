import { format } from "date-fns";

/**
 * Formats `date` the way Gmail's "Pick date & time" Date field expects,
 * inferred from the value Gmail pre-filled. Gmail localizes that field, so
 * echoing its existing shape is safer than guessing the locale.
 */
export function formatDateForGmail(date: Date, originalValue: string): string {
  if (/^\d{1,2}\s[A-Z][a-z]{2},\s\d{4}$/.test(originalValue)) {
    return format(date, "d MMM, yyyy");
  }
  // Slashes are ambiguous between US and EU order; Gmail's US locale uses
  // MM/dd, and that's the only one seen in practice so far.
  if (originalValue.includes("/")) return format(date, "MM/dd/yyyy");
  if (originalValue.includes(".")) return format(date, "dd.MM.yyyy");
  if (/^\d{4}-/.test(originalValue)) return format(date, "yyyy-MM-dd");
  return format(date, "MMM d, yyyy");
}

/** Formats the Time field in Gmail's 12h or 24h style, from its pre-filled value. */
export function formatTimeForGmail(date: Date, originalValue: string): string {
  return /AM|PM/i.test(originalValue)
    ? format(date, "h:mm aa")
    : format(date, "HH:mm");
}
