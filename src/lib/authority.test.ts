import assert from "node:assert/strict";
import test from "node:test";

import { buildAuthorityReviewStatus, evaluateAuthorityThreshold, stringifyAuthorityStatus } from "./authority";

test("approves when the required threshold is met", () => {
  const result = evaluateAuthorityThreshold(
    [
      { authorityId: "A", approved: true },
      { authorityId: "B", approved: true },
      { authorityId: "C", approved: true },
      { authorityId: "D", approved: false },
      { authorityId: "E", approved: false },
    ],
    3,
  );

  assert.equal(result.approved, true);
  assert.equal(result.approvals, 3);
  assert.equal(result.required, 3);
  assert.equal(result.status, "APPROVED");
});

test("reports pending when the required threshold is not met", () => {
  const result = evaluateAuthorityThreshold(
    [
      { authorityId: "A", approved: true },
      { authorityId: "B", approved: false },
      { authorityId: "C", approved: false },
      { authorityId: "D", approved: false },
      { authorityId: "E", approved: false },
    ],
    3,
  );

  assert.equal(result.approved, false);
  assert.equal(result.approvals, 1);
  assert.equal(result.required, 3);
  assert.equal(result.status, "PENDING");
});

test("creates a human-readable verification label", () => {
  const label = stringifyAuthorityStatus({ approvals: 3, required: 5, approved: false, status: "PENDING" });
  assert.equal(label, "3/5 authorities approved");
});

test("builds a publication decision for the authority review state", () => {
  const review = buildAuthorityReviewStatus(
    [
      { authorityId: "A", approved: true },
      { authorityId: "B", approved: true },
      { authorityId: "C", approved: false },
      { authorityId: "D", approved: false },
      { authorityId: "E", approved: false },
    ],
    2,
  );

  assert.equal(review.approved, true);
  assert.equal(review.canPublish, true);
  assert.equal(review.status, "APPROVED");
});

test("counts each authority only once", () => {
  const result = evaluateAuthorityThreshold(
    [
      { authorityId: "A", approved: true },
      { authorityId: "A", approved: true },
      { authorityId: "B", approved: false },
    ],
    2,
  );

  assert.equal(result.approvals, 1);
  assert.equal(result.approved, false);
});

test("normalizes an invalid threshold to one authority", () => {
  const result = evaluateAuthorityThreshold([{ authorityId: "A", approved: true }], 0);

  assert.equal(result.required, 1);
  assert.equal(result.approved, true);
});
