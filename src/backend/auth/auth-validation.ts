export const ALLOWED_EMAIL_DOMAIN = "@psgtech.ac.in";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidPsgEmail(email: string): boolean {
  if (typeof email !== "string") return false;
  const normalized = normalizeEmail(email);
  if (normalized.length > 254) return false;

  // Must strictly end with @psgtech.ac.in
  if (!normalized.endsWith(ALLOWED_EMAIL_DOMAIN)) return false;

  // Local part (before @) must not be empty and must be valid
  const localPart = normalized.slice(0, -ALLOWED_EMAIL_DOMAIN.length);
  if (!localPart || localPart.length > 64) return false;

  // Disallow special characters that violate standard email format
  const validLocalPartRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
  return validLocalPartRegex.test(localPart);
}

export function normalizeStudentId(studentId: string): string {
  return studentId.trim().toUpperCase();
}

export function isValidStudentId(studentId: string): boolean {
  if (typeof studentId !== "string") return false;
  const normalized = normalizeStudentId(studentId);
  // Student ID must be alphanumeric and between 3 and 30 characters
  // e.g. 24N236, 24n236, 21MX101, VTR-1001
  if (normalized.length < 3 || normalized.length > 30) return false;
  const studentIdRegex = /^[A-Z0-9-]+$/;
  return studentIdRegex.test(normalized);
}

export function isValidName(name: string): { valid: boolean; reason?: string } {
  if (typeof name !== "string") return { valid: false, reason: "Name must be text." };
  const trimmed = name.trim();
  if (trimmed.length < 2) return { valid: false, reason: "Name must be at least 2 characters." };
  if (trimmed.length > 100) return { valid: false, reason: "Name cannot exceed 100 characters." };
  return { valid: true };
}

export function isValidPassword(password: string): { valid: boolean; reason?: string } {
  if (typeof password !== "string") return { valid: false, reason: "Password must be text." };
  if (password.length < 8) return { valid: false, reason: "Password must be at least 8 characters long." };
  if (password.length > 1024) return { valid: false, reason: "Password cannot exceed 1024 characters." };
  return { valid: true };
}
