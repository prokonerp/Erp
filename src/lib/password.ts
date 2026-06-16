// Strong password policy + strength meter (client-side).
// Server enforces the same rules in admin-users.functions.ts.

export type PasswordCheck = { ok: boolean; errors: string[] };

export function validateStrongPassword(pw: string): PasswordCheck {
  const errors: string[] = [];
  if (!pw || pw.length < 8) errors.push("At least 8 characters");
  if (!/[A-Z]/.test(pw)) errors.push("At least 1 uppercase letter");
  if (!/[a-z]/.test(pw)) errors.push("At least 1 lowercase letter");
  if (!/[0-9]/.test(pw)) errors.push("At least 1 number");
  if (!/[^A-Za-z0-9]/.test(pw)) errors.push("At least 1 special character");
  return { ok: errors.length === 0, errors };
}

export type StrengthLabel = "Weak" | "Medium" | "Strong";
export function passwordStrength(pw: string): { score: number; label: StrengthLabel } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const label: StrengthLabel = score <= 2 ? "Weak" : score <= 4 ? "Medium" : "Strong";
  return { score: Math.min(score, 5), label };
}

export const PASSWORD_EXPIRY_DAYS = 30;