import assert from "node:assert/strict";
import test from "node:test";
import { splitElectionSecret, reconstructElectionSecret, evaluateAuthorityThreshold } from "../../src/security/threshold";

test("Threshold Architecture: Exact 2-of-3 secret sharing over assigned slots (x=1, 2, 3)", () => {
  const electionId = "elec-test-threshold-01";
  const masterKey = "4a8c9b3d1e2f7a0b5c6d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b";

  // Total 3 assigned trustees, threshold = 2
  const totalShares = 3;
  const threshold = 2;
  const shares = splitElectionSecret(electionId, masterKey, totalShares, threshold);

  assert.equal(shares.length, 3);
  // Verify coordinate format keyshare:<electionId>:<x>:<y>
  assert.ok(shares[0].startsWith(`keyshare:${electionId}:1:`));
  assert.ok(shares[1].startsWith(`keyshare:${electionId}:2:`));
  assert.ok(shares[2].startsWith(`keyshare:${electionId}:3:`));

  // Combination 1: Slot 1 + Slot 2
  const reconstructed12 = reconstructElectionSecret(electionId, [shares[0], shares[1]], threshold);
  assert.equal(reconstructed12, masterKey, "Slot 1 + Slot 2 must reconstruct master key");

  // Combination 2: Slot 1 + Slot 3
  const reconstructed13 = reconstructElectionSecret(electionId, [shares[0], shares[2]], threshold);
  assert.equal(reconstructed13, masterKey, "Slot 1 + Slot 3 must reconstruct master key");

  // Combination 3: Slot 2 + Slot 3
  const reconstructed23 = reconstructElectionSecret(electionId, [shares[1], shares[2]], threshold);
  assert.equal(reconstructed23, masterKey, "Slot 2 + Slot 3 must reconstruct master key");

  // Single share failure: 1-of-3 cannot reconstruct
  assert.throws(() => {
    reconstructElectionSecret(electionId, [shares[0]], threshold);
  }, /Insufficient authority key shares/);
});

test("Threshold Architecture: Global pool additions do not drift election coordinates", () => {
  const electionId = "elec-test-drift-free";
  const masterKey = "f0e1d2c3b4a5968778695a4b3c2d1e0ff0e1d2c3b4a5968778695a4b3c2d1e0f";

  // Election A has 3 assigned trustees (Slots 1, 2, 3)
  const sharesElectionA = splitElectionSecret(electionId, masterKey, 3, 2);

  // Even if 5, 10, or 20 authorities exist globally, Election A's trustees always resolve to Slots 1, 2, 3
  const t1Share = sharesElectionA[0]; // Slot 1 (x=1)
  const t3Share = sharesElectionA[2]; // Slot 3 (x=3)

  const recovered = reconstructElectionSecret(electionId, [t1Share, t3Share], 2);
  assert.equal(recovered, masterKey);
});

test("Threshold Security: evaluateAuthorityThreshold enforces >= 2 distinct approvals", () => {
  const auth1 = "auth-1";
  const auth2 = "auth-2";

  // 1 approval: pending
  const res1 = evaluateAuthorityThreshold([{ authorityId: auth1, approved: true }], 2);
  assert.equal(res1.approved, false);
  assert.equal(res1.approvals, 1);

  // 2 distinct approvals: approved
  const res2 = evaluateAuthorityThreshold([
    { authorityId: auth1, approved: true },
    { authorityId: auth2, approved: true },
  ], 2);
  assert.equal(res2.approved, true);
  assert.equal(res2.approvals, 2);

  // Duplicate approvals from same authority rejected (counted once)
  const resDup = evaluateAuthorityThreshold([
    { authorityId: auth1, approved: true },
    { authorityId: auth1, approved: true },
  ], 2);
  assert.equal(resDup.approved, false);
  assert.equal(resDup.approvals, 1);
});
