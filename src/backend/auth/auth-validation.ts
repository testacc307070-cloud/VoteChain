export const ALLOWED_EMAIL_DOMAIN = "@psgtech.ac.in";
export const DEFAULT_MIN_PASSWORD_LENGTH = 10;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Validates strictly that the email belongs to the PSG Tech student domain (@psgtech.ac.in).
 */
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

/**
 * Validates any RFC-compliant institutional or personal email address
 * (used for Authority Trustees, Observers, and administrative accounts).
 */
export function isValidEmail(email: string): boolean {
  if (typeof email !== "string") return false;
  const normalized = normalizeEmail(email);
  if (!normalized || normalized.length > 254) return false;

  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  return emailRegex.test(normalized);
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

export interface PasswordPolicyResult {
  valid: boolean;
  errors: string[];
  reason?: string;
}

/**
 * Centralized VoteChain Password Policy:
 * - Minimum 10 characters (configurable via MIN_PASSWORD_LENGTH)
 * - Maximum 1024 characters (prevents Bcrypt DoS)
 * - At least one uppercase letter (A-Z)
 * - At least one lowercase letter (a-z)
 * - At least one numeric digit (0-9)
 * - At least one special symbol (!@#$%^&*()_+-=[]{}|;:,.<>?)
 */
export function validatePasswordPolicy(password: string): PasswordPolicyResult {
  const minLength = Number(process.env.MIN_PASSWORD_LENGTH || DEFAULT_MIN_PASSWORD_LENGTH);
  const errors: string[] = [];

  if (typeof password !== "string") {
    return { valid: false, errors: ["Password must be text."], reason: "Password must be text." };
  }
  if (password.length < minLength) {
    errors.push(`Password must be at least ${minLength} characters long.`);
  }
  if (password.length > 1024) {
    errors.push("Password cannot exceed 1024 characters.");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter (A-Z).");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter (a-z).");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("Password must contain at least one number (0-9).");
  }
  if (!/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)) {
    errors.push("Password must contain at least one special symbol (!@#$%^&*).");
  }

  return {
    valid: errors.length === 0,
    errors,
    reason: errors.join(" "),
  };
}

/**
 * Validates password length for basic checks (minimum 8 characters).
 * For strict complexity enforcement in invitations and resets, use validatePasswordPolicy().
 */
export function isValidPassword(password: string): { valid: boolean; reason?: string } {
  if (typeof password !== "string") return { valid: false, reason: "Password must be text." };
  if (password.length < 8) return { valid: false, reason: "Password must be at least 8 characters." };
  if (password.length > 1024) return { valid: false, reason: "Password cannot exceed 1024 characters." };
  return { valid: true };
}
