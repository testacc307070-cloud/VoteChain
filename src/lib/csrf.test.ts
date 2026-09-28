import assert from "node:assert/strict";
import test from "node:test";

import { isSameOriginRequest } from "./csrf";

const requestUrl = "https://votechain.example/api/auth/login";

test("accepts a same-origin mutation request", () => {
  const request = new Request(requestUrl, {
    method: "POST",
    headers: { origin: "https://votechain.example" },
  });

  assert.equal(isSameOriginRequest(request), true);
});

test("rejects a cross-origin mutation request", () => {
  const request = new Request(requestUrl, {
    method: "POST",
    headers: { origin: "https://attacker.example" },
  });

  assert.equal(isSameOriginRequest(request), false);
});

test("uses a same-origin referrer when Origin is absent", () => {
  const request = new Request(requestUrl, {
    method: "POST",
    headers: { referer: "https://votechain.example/portal" },
  });

  assert.equal(isSameOriginRequest(request), true);
});

test("rejects mutation requests without a verifiable source", () => {
  const request = new Request(requestUrl, { method: "POST" });

  assert.equal(isSameOriginRequest(request), false);
});