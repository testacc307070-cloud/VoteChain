import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuthorityReviewStatus,
  evaluateAuthorityThreshold,
  reconstructSecretFromShares,
  splitSecretToShares,
  stringifyAuthorityStatus,
} from "./authority";

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
  const label = stringifyAuthorityStatus({
    approvals: 3,
    required: 5,
    approved: false,
    status: "PENDING",
    sharesSubmitted: 3,
    canReconstructKey: false,
  });
  assert.equal(label, "3/5 authorities approved (3/5 shares)");
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

test("splits a 32-byte secret into 5 shares and reconstructs with any 3 shares", () => {
  const secretKey = "election-master-decryption-key-32";
  const shares = splitSecretToShares(secretKey, 5, 3);

  assert.equal(shares.length, 5);
  shares.forEach((share) => {
    assert.equal(share.startsWith("keyshare:"), true);
  });

  // Reconstruct with shares 1, 3, 5
  const recovered1 = reconstructSecretFromShares([shares[0], shares[2], shares[4]], 3);
  assert.equal(recovered1, secretKey);

  // Reconstruct with shares 2, 4, 5
  const recovered2 = reconstructSecretFromShares([shares[1], shares[3], shares[4]], 3);
  assert.equal(recovered2, secretKey);

  // Reconstruct with shares 1, 2, 3
  const recovered3 = reconstructSecretFromShares([shares[0], shares[1], shares[2]], 3);
  assert.equal(recovered3, secretKey);
});

test("fails to reconstruct when fewer than threshold shares are provided", () => {
  const secretKey = "election-master-decryption-key-32";
  const shares = splitSecretToShares(secretKey, 5, 3);

  assert.throws(
    () => reconstructSecretFromShares([shares[0], shares[1]], 3),
    /Insufficient authority key shares/,
  );
});
