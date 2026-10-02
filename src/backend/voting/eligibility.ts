import { createHash } from "node:crypto";
import { prisma } from "@/database/prisma";
import {
  isValidPsgEmail,
  normalizeEmail,
  normalizeStudentId,
} from "@/backend/auth/auth-validation";
import type { EligibleVoterRecord } from "./csv-eligibility";

export type EligibilityCheckInput = {
  userId: string;
  eligibleVoterIds: string[];
  isEligible: boolean;
};

export type EligibilityCheckResult =
  | { ok: true; voterId: string }
  | { ok: false; reason: string };

/**
 * Legacy eligibility checker for local prototype backwards compatibility.
 */
export function checkElectionEligibility({
  userId,
  eligibleVoterIds,
  isEligible,
}: EligibilityCheckInput): EligibilityCheckResult {
  if (!userId || userId.trim().length === 0) {
    return { ok: false, reason: "A valid voter identifier is required." };
  }

  if (!isEligible) {
    return { ok: false, reason: "This voter is not eligible for the election." };
  }

  if (!eligibleVoterIds.includes(userId)) {
    return { ok: false, reason: "This voter is not registered for the election." };
  }

  return { ok: true, voterId: userId };
}

export interface VoterEligibilityInput {
  userId: string;
  email: string;
  voterId?: string | null; // Student ID
  role: string;
  emailVerified: boolean;
  electionId: string;
}

export interface VoterEligibilityResult {
  ok: boolean;
  reason?: string;
  errorCode?: "NOT_VOTER" | "UNVERIFIED_EMAIL" | "INVALID_DOMAIN" | "NOT_IN_ELIGIBILITY_LIST" | "STUDENT_ID_MISMATCH";
}

/**
 * Phase 2 Class Eligibility Checker
 * Formula:
 * @psgtech.ac.in + verified email + email in this election's eligibility list = eligible voter
 */
export async function checkVoterElectionEligibility(
  input: VoterEligibilityInput
): Promise<VoterEligibilityResult> {
  const { userId, email, voterId, role, emailVerified, electionId } = input;

  // 1. Role must be VOTER
  if (role !== "VOTER") {
    return {
      ok: false,
      reason: "Only registered voters can cast ballots in campus elections.",
      errorCode: "NOT_VOTER",
    };
  }

  // 2. Email domain must be @psgtech.ac.in (or local test accounts for demo)
  const isPsg = isValidPsgEmail(email);
  const isLocalDemo = email.endsWith("@votechain.local");
  if (!isPsg && !isLocalDemo) {
    return {
      ok: false,
      reason: "Only verified institutional @psgtech.ac.in accounts are eligible.",
      errorCode: "INVALID_DOMAIN",
    };
  }

  // 3. Email must be verified
  if (!emailVerified) {
    return {
      ok: false,
      reason: "Your email must be verified before you can participate in elections.",
      errorCode: "UNVERIFIED_EMAIL",
    };
  }

  const cleanEmail = normalizeEmail(email);

  // 4. Check election-specific class eligibility list
  const totalEligibleInElection = await prisma.electionEligibleVoter.count({
    where: { electionId },
  });

  if (totalEligibleInElection > 0) {
    // Official class eligibility list is active for this election
    const record = await prisma.electionEligibleVoter.findUnique({
      where: {
        electionId_email: {
          electionId,
          email: cleanEmail,
        },
      },
    });

    if (!record) {
      return {
        ok: false,
        reason: "You are not on the official class eligibility register for this election.",
        errorCode: "NOT_IN_ELIGIBILITY_LIST",
      };
    }

    // Check student ID matching ("wrong email/ID blocked")
    if (voterId) {
      const normalizedUserStudentId = normalizeStudentId(voterId);
      const normalizedListStudentId = normalizeStudentId(record.studentId);
      if (normalizedUserStudentId !== normalizedListStudentId) {
        return {
          ok: false,
          reason: `Student ID mismatch: your account (${normalizedUserStudentId}) does not match the official election register (${normalizedListStudentId}) for this email.`,
          errorCode: "STUDENT_ID_MISMATCH",
        };
      }
    }

    return { ok: true };
  }

  // 5. Fallback for elections without uploaded CSV class list (e.g. prototype demo elections)
  const election = await prisma.election.findUnique({
    where: { id: electionId },
    select: { eligibleVoterIds: true },
  });

  if (election && election.eligibleVoterIds.length > 0) {
    if (!election.eligibleVoterIds.includes(userId)) {
      return {
        ok: false,
        reason: "This voter is not registered for the election.",
        errorCode: "NOT_IN_ELIGIBILITY_LIST",
      };
    }
  }

  return { ok: true };
}

/**
 * Import or replace official class eligibility list for an election.
 */
export async function importElectionEligibilityList(
  electionId: string,
  records: EligibleVoterRecord[],
  adminEmail: string
): Promise<{ count: number; duplicatesIgnored: number }> {
  const election = await prisma.election.findUnique({
    where: { id: electionId },
  });

  if (!election) {
    throw new Error("Election not found.");
  }

  if (election.status === "CLOSED" || election.status === "RESULTS_PUBLISHED") {
    throw new Error("Eligibility register cannot be modified after an election has closed.");
  }

  // Deduplicate records by email
  const uniqueRecordsMap = new Map<string, EligibleVoterRecord>();
  let duplicatesIgnored = 0;

  for (const record of records) {
    const cleanEmail = normalizeEmail(record.email);
    const cleanStudentId = normalizeStudentId(record.studentId);
    if (uniqueRecordsMap.has(cleanEmail)) {
      duplicatesIgnored++;
    } else {
      uniqueRecordsMap.set(cleanEmail, { email: cleanEmail, studentId: cleanStudentId });
    }
  }

  const uniqueRecords = Array.from(uniqueRecordsMap.values());

  await prisma.$transaction(async (tx) => {
    // 1. Delete existing list for this election
    await tx.electionEligibleVoter.deleteMany({
      where: { electionId },
    });

    // 2. Insert new eligible voters
    if (uniqueRecords.length > 0) {
      await tx.electionEligibleVoter.createMany({
        data: uniqueRecords.map((r) => ({
          electionId,
          email: r.email,
          studentId: r.studentId,
        })),
      });
    }

    // 2.5 Ensure authority accounts cannot be registered as eligible voters (role isolation)
    const existingAuthorities = await tx.user.findMany({
      where: {
        email: { in: uniqueRecords.map((r) => r.email) },
        role: "AUTHORITY",
      },
      select: { email: true },
    });
    if (existingAuthorities.length > 0) {
      throw new Error(
        `Cannot register authority accounts as eligible voters: ${existingAuthorities.map((a) => a.email).join(", ")}. Authority accounts must remain strictly isolated from voter roles.`
      );
    }

    // 3. Find any registered users that match these emails and update election.eligibleVoterIds
    const matchingUsers = await tx.user.findMany({
      where: {
        email: { in: uniqueRecords.map((r) => r.email) },
        role: "VOTER",
      },
      select: { id: true },
    });

    await tx.election.update({
      where: { id: electionId },
      data: {
        eligibleVoterIds: matchingUsers.map((u) => u.id),
      },
    });

    // 4. Log audit record
    await tx.auditLog.create({
      data: {
        eventType: "ELIGIBILITY_LIST_UPLOADED",
        actorReference: `admin:${adminEmail}`,
        electionId,
        details: `Imported ${uniqueRecords.length} eligible voters for election "${election.name}" (${duplicatesIgnored} duplicates ignored).`,
        eventHash: createHash("sha256").update(`${electionId}:${uniqueRecords.length}:${Date.now()}`).digest("hex"),
      },
    });
  }, { timeout: 15000, maxWait: 10000 });

  return { count: uniqueRecords.length, duplicatesIgnored };
}
