import { NextResponse } from "next/server";
import { ElectionStatus } from "@prisma/client";
import { requireAdminApi } from "@/lib/admin-api";
import { parseElectionInput } from "@/lib/election-validation";
import { prisma } from "@/lib/prisma";
import { generateElectionKey } from "@/lib/election-keys";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;

  try {
    const elections = await prisma.election.findMany({
      orderBy: [{ updatedAt: "desc" }],
      include: { candidates: { orderBy: { sortOrder: "asc" } } },
    });
    return NextResponse.json({ elections });
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
    return NextResponse.json({ election }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Could not create the election." }, { status: 500 });
  }
}