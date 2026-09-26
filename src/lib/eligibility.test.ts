import assert from "node:assert/strict";
import test from "node:test";

import { checkElectionEligibility } from "./eligibility";

test("accepts eligible voters and rejects non-registered or disabled accounts", () => {
  const eligible = checkElectionEligibility({
    userId: "user-1",
    eligibleVoterIds: ["user-1", "user-2"],
    isEligible: true,
  });

  const nonRegistered = checkElectionEligibility({
    userId: "user-9",
    eligibleVoterIds: ["user-1", "user-2"],
    isEligible: true,
  });

  const disabled = checkElectionEligibility({
    userId: "user-2",
    eligibleVoterIds: ["user-1", "user-2"],
    isEligible: false,
  });

  assert.equal(eligible.ok, true);
  assert.equal(nonRegistered.ok, false);
  assert.equal(disabled.ok, false);
  assert.equal(disabled.reason?.includes("eligible"), true);
});
