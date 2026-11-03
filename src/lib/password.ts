// The backend's password rule (NewPasswordRequest, ChangePasswordRequest), checked here first so the
// admin sees what's missing before submitting.

export const PASSWORD_RULES: { test: (p: string) => boolean; label: string }[] = [
  { test: (p) => p.length >= 8 && p.length <= 72, label: '8 to 72 characters' },
  { test: (p) => /[a-z]/.test(p), label: 'a lowercase letter' },
  { test: (p) => /[A-Z]/.test(p), label: 'a capital letter' },
  { test: (p) => /\d/.test(p), label: 'a number' },
  { test: (p) => /[^A-Za-z0-9]/.test(p), label: 'a symbol' }
];

/** What the password still lacks, or an empty list when it meets the rule. */
export function passwordProblems(p: string): string[] {
  return PASSWORD_RULES.filter((r) => !r.test(p)).map((r) => r.label);
}

/** An error for a new password and its confirmation, or '' when both are fine. */
export function checkNewPassword(next: string, again: string): string {
  const missing = passwordProblems(next);
  if (missing.length) return `The password needs ${missing.join(', ')}.`;
  if (next !== again) return "The new passwords don't match.";
  return '';
}
