import assert from "node:assert/strict";
import test from "node:test";

import { getRoleLandingRoute } from "@/backend/auth/role-routing";

test("routes administrators to the admin dashboard", () => {
  assert.equal(getRoleLandingRoute("ADMIN"), "/");
});

test("routes observers to the observer dashboard", () => {
  assert.equal(getRoleLandingRoute("OBSERVER"), "/observer");
});

test("routes authorities to the authority review dashboard", () => {
  assert.equal(getRoleLandingRoute("AUTHORITY"), "/authority");
});

test("routes voters to the voter portal", () => {
  assert.equal(getRoleLandingRoute("VOTER"), "/portal");
});
