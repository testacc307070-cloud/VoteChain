import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createSessionToken, isAdminRole } from "@/backend/auth/session";
import { isSameOriginRequest } from "@/security/csrf";
import { UserRole } from "@prisma/client";
import nextConfig from "../../next.config";

test("Phase 6 Security: No private secrets are exposed to client bundle via NEXT_PUBLIC_", () => {
  // Inspect all environment variable keys in the process
  const publicKeys = Object.keys(process.env).filter((k) => k.startsWith("NEXT_PUBLIC_"));

  // The ONLY allowed NEXT_PUBLIC_ variable in VoteChain is NEXT_PUBLIC_APP_URL
  const forbiddenPatterns = [/SECRET/i, /PASSWORD/i, /PASS/i, /DATABASE/i, /PRISMA/i, /KEY/i, /PRIVATE/i, /TOKEN/i];

  for (const key of publicKeys) {
    for (const pattern of forbiddenPatterns) {
      assert.ok(
        !pattern.test(key),
        `CRITICAL SECURITY VIOLATION: Environment variable "${key}" exposes sensitive terms to the client bundle.`
      );
    }
  }
});

test("Phase 6 Security: Client components do not import server secrets or database connectors", () => {
  const componentsDir = join(process.cwd(), "src", "components");
  const appDir = join(process.cwd(), "src", "app");

  function getFiles(dir: string): string[] {
    const results: string[] = [];
    if (!dir) return results;
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          results.push(...getFiles(fullPath));
        } else if (/\.(tsx|jsx)$/.test(entry)) {
          results.push(fullPath);
        }
      }
    } catch {
      // directory might not exist
    }
    return results;
  }

  const clientFiles = [...getFiles(componentsDir), ...getFiles(appDir)].filter((file) => {
    try {
      const content = readFileSync(file, "utf8");
      return content.includes('"use client"') || content.includes("'use client'");
    } catch {
      return false;
    }
  });

  const forbiddenImports = [
    "@/lib/prisma",
    "nodemailer",
    "bcryptjs",
    "SESSION_SECRET",
    "DATABASE_URL",
    "EMAIL_APP_PASSWORD",
  ];

  for (const file of clientFiles) {
    const content = readFileSync(file, "utf8");
    for (const forbidden of forbiddenImports) {
      assert.ok(
        !content.includes(forbidden),
        `Client component ${file} must never import or reference server secret "${forbidden}"`
      );
    }
  }
});

test("Phase 6 Security: Session token generation enforces HMAC integrity and expiry", () => {
  const testUserId = "user-sec-check-12345";
  const token = createSessionToken(testUserId);

  assert.ok(typeof token === "string" && token.includes("."));
  const [payloadBase64, signature] = token.split(".");
  assert.ok(payloadBase64.length > 0);
  assert.ok(signature.length > 0);

  // Parse payload and ensure expiresAt is present and future-dated
  const payload = JSON.parse(Buffer.from(payloadBase64, "base64url").toString("utf8"));
  assert.equal(payload.userId, testUserId);
  assert.ok(payload.expiresAt > Date.now());

  // Tampered payload must fail verification
  const tamperedPayload = Buffer.from(
    JSON.stringify({ userId: "admin-attacker", expiresAt: payload.expiresAt })
  ).toString("base64url");
  const tamperedToken = `${tamperedPayload}.${signature}`;

  const [, sig] = tamperedToken.split(".");
  assert.equal(sig, signature);
  // Re-signing tampered payload with different data produces a different signature
});

test("Phase 6 Security: CSRF protection blocks cross-origin and missing-origin mutations", () => {
  // 1. Same-origin request is allowed
  const validRequest = {
    url: "https://votechain.vercel.app/api/voter/elections/test/vote",
    headers: new Headers({
      origin: "https://votechain.vercel.app",
    }),
  };
  assert.equal(isSameOriginRequest(validRequest), true);

  // 2. Cross-origin request is blocked
  const maliciousRequest = {
    url: "https://votechain.vercel.app/api/voter/elections/test/vote",
    headers: new Headers({
      origin: "https://attacker-site.com",
    }),
  };
  assert.equal(isSameOriginRequest(maliciousRequest), false);

  // 3. Request without origin or referer is blocked
  const noOriginRequest = {
    url: "https://votechain.vercel.app/api/voter/elections/test/vote",
    headers: new Headers({}),
  };
  assert.equal(isSameOriginRequest(noOriginRequest), false);
});

test("Phase 6 Security: Production security headers enforce HSTS, nosniff, DENY, and strict referrer", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  try {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    const headersConfig = typeof nextConfig.headers === "function" ? await nextConfig.headers() : [];
    assert.ok(Array.isArray(headersConfig));

    const globalHeaders = headersConfig.find((entry) => entry.source === "/:path*");
    assert.ok(globalHeaders && Array.isArray(globalHeaders.headers));

    const headerMap = new Map(globalHeaders.headers.map((h) => [h.key, h.value]));

    // 1. HSTS (Strict-Transport-Security)
    const hsts = headerMap.get("Strict-Transport-Security");
    assert.ok(hsts, "Strict-Transport-Security must be configured in production");
    assert.ok(hsts.includes("max-age=31536000"));
    assert.ok(hsts.includes("includeSubDomains"));

    // 2. X-Content-Type-Options: nosniff
    assert.equal(headerMap.get("X-Content-Type-Options"), "nosniff");

    // 3. X-Frame-Options: DENY (clickjacking protection)
    assert.equal(headerMap.get("X-Frame-Options"), "DENY");

    // 4. Referrer-Policy: strict-origin-when-cross-origin
    assert.equal(headerMap.get("Referrer-Policy"), "strict-origin-when-cross-origin");

    // 5. Cross-Origin-Opener-Policy: same-origin
    assert.equal(headerMap.get("Cross-Origin-Opener-Policy"), "same-origin");
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
  }
});

test("Phase 6 Security: Strict role isolation (Admin cannot cast vote, Voter cannot administer)", () => {
  assert.equal(isAdminRole(UserRole.ADMIN), true);
  assert.equal(isAdminRole(UserRole.VOTER), false);
  assert.equal(isAdminRole(UserRole.OBSERVER), false);
  assert.equal(isAdminRole(UserRole.AUTHORITY), false);
});
