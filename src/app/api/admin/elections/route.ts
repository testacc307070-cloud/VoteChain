import { NextResponse } from "next/server";
import { ElectionStatus } from "@prisma/client";
import { requireAdminApi } from "@/backend/voting/admin-api";
import { parseElectionInput } from "@/backend/voting/election-validation";
import { prisma } from "@/database/prisma";
import { generateElectionKey } from "@/security/election-keys";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;

  try {
    const elections = await prisma.election.findMany({
      orderBy: [{ updatedAt: "desc" }],
      include: {
        candidates: { orderBy: { sortOrder: "asc" } },
        _count: { select: { votes: true } },
      },
    });
    const sanitizedElections = elections.map((e) => {
      const { encryptedMasterKey, ...safe } = e;
      return {
        ...safe,
        votesCount: e._count.votes,
        hasMasterKey: Boolean(encryptedMasterKey),
      };
    });
    return NextResponse.json({ elections: sanitizedElections });
  } catch {
    return NextResponse.json({ error: "Could not load elections." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const parsed = parseElectionInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const eligibleVoterIds = Array.isArray((body as { eligibleVoterIds?: unknown })?.eligibleVoterIds)
    ? ((body as { eligibleVoterIds?: unknown }).eligibleVoterIds as unknown[])
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim())
    : [];

  try {
    const { encryptedMasterKey, keyCommitment } = generateElectionKey();
    const election = await prisma.election.create({
      data: {
        name: parsed.data.name,
        description: parsed.data.description,
        startTime: parsed.data.startTime,
        endTime: parsed.data.endTime,
        status: ElectionStatus.DRAFT,
        eligibleVoterIds,
        createdById: auth.user.id,
        encryptedMasterKey,
        keyCommitment,
        candidates: { create: parsed.data.candidates.map((candidate, sortOrder) => ({ ...candidate, sortOrder })) },
      },
      include: { candidates: { orderBy: { sortOrder: "asc" } } },
    });
    const { encryptedMasterKey: _, ...safeElection } = election;
    return NextResponse.json(
      {
        election: {
          ...safeElection,
          hasMasterKey: Boolean(election.encryptedMasterKey),
        },
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ error: "Could not create the election." }, { status: 500 });
  }
}