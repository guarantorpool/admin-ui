interface Named {
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
}

/** First, middle and last name, skipping what's missing; "" when there's none. */
export function fullName(a: Named | null | undefined): string {
  if (!a) return '';
  return [a.firstName, a.middleName, a.lastName].filter(Boolean).join(' ');
}
