import assert from "node:assert/strict";
import test from "node:test";
import {
  validatePasswordPolicy,
  isValidPassword,
  isValidEmail,
  isValidPsgEmail,
} from "../../src/backend/auth/auth-validation";

test("Password Policy: Rejects passwords shorter than 10 characters", () => {
  const shortResult = validatePasswordPolicy("Ab1!short");
  assert.equal(shortResult.valid, false);
  assert.ok(shortResult.errors.some((e) => e.includes("at least 10 characters")));
});

test("Password Policy: Rejects passwords missing uppercase letter", () => {
  const result = validatePasswordPolicy("nouppercase123!");
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("uppercase letter")));
});

test("Password Policy: Rejects passwords missing lowercase letter", () => {
  const result = validatePasswordPolicy("NOLOWERCASE123!");
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("lowercase letter")));
});

test("Password Policy: Rejects passwords missing numeric digits", () => {
  const result = validatePasswordPolicy("NoNumbersHere!");
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("number")));
});

test("Password Policy: Rejects passwords missing special symbols", () => {
  const result = validatePasswordPolicy("NoSpecialSymbol123");
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("special symbol")));
});

test("Password Policy: Accepts high-entropy compliant passwords", () => {
  const result = validatePasswordPolicy("SuperSecure2026!#");
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
  assert.equal(isValidPassword("SuperSecure2026!#").valid, true);
});

test("Email Validation: Flexible domain support for Authority and Admin accounts", () => {
  // Institutional / External domains allowed for authorities
  assert.equal(isValidEmail("eleanor.vance@gmail.com"), true);
  assert.equal(isValidEmail("dean@psgtech.ac.in"), true);
  assert.equal(isValidEmail("hod_cse@annauniv.edu"), true);
  assert.equal(isValidEmail("trustee@electionguard.org"), true);

  // Invalid email formats rejected
  assert.equal(isValidEmail("invalid-email"), false);
  assert.equal(isValidEmail("missing@domain"), false);
  assert.equal(isValidEmail("@domain.com"), false);
});

test("Email Validation: Student voter restriction strictly enforced to @psgtech.ac.in", () => {
  assert.equal(isValidPsgEmail("24n236@psgtech.ac.in"), true);
  assert.equal(isValidPsgEmail("eleanor.vance@gmail.com"), false);
  assert.equal(isValidPsgEmail("student@annauniv.edu"), false);
});
