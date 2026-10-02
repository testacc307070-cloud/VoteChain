import { NextResponse } from "next/server";
import { ElectionStatus, UserRole, UserStatus } from "@prisma/client";
import { requireAdminApi } from "@/backend/voting/admin-api";
import { prisma } from "@/database/prisma";

export const runtime = "nodejs";

/**
 * GET /api/admin/elections/[electionId]/trustees
 * Returns the assigned trustees for this specific election.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ electionId: string }> }
) {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;

  const { electionId } = await context.params;

  try {
    const election = await prisma.election.findUnique({
      where: { id: electionId },
      include: {
        trustees: {
          orderBy: { slotIndex: "asc" },
          include: {
            authority: {
              select: {
                id: true,
                name: true,
                email: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (!election) {
      return NextResponse.json({ error: "Election not found." }, { status: 404 });
    }

    const assigned = election.trustees.map((t) => ({
      slotIndex: t.slotIndex,
      authorityId: t.authorityId,
      name: t.authority.name,
      email: t.authority.email,
      status: t.authority.status,
    }));

    return NextResponse.json({
      electionId: election.id,
      trustees: assigned,
      isConfigured: assigned.length === 3,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not fetch election trustees.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/admin/elections/[electionId]/trustees
 * Assigns exactly 3 active authorities from the global pool to Slots 1, 2, and 3 (x = 1, 2, 3).
 * Allowed only while the election is in DRAFT status.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ electionId: string }> }
) {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;

  const { electionId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const { authorityIds } = body as { authorityIds?: unknown };

  if (!Array.isArray(authorityIds) || authorityIds.length !== 3) {
    return NextResponse.json(
      { error: "Exactly 3 distinct authority trustee IDs must be provided for the 2-of-3 threshold architecture." },
      { status: 400 }
    );
  }

  const cleanIds = authorityIds.map((id) => String(id).trim()).filter(Boolean);
  const uniqueIds = Array.from(new Set(cleanIds));

  if (uniqueIds.length !== 3) {
    return NextResponse.json(
      { error: "The 3 selected authority trustees must be distinct accounts." },
      { status: 400 }
    );
  }

  try {
    const election = await prisma.election.findUnique({
      where: { id: electionId },
      select: { id: true, status: true, candidatesLocked: true },
    });

    if (!election) {
      return NextResponse.json({ error: "Election not found." }, { status: 404 });
    }

    if (election.status !== ElectionStatus.DRAFT || election.candidatesLocked) {
      return NextResponse.json(
        { error: "Trustee assignment is locked. Trustees can only be configured while the election is in DRAFT status." },
        { status: 409 }
      );
    }

    // Verify all 3 authorities exist, have role AUTHORITY, and are ACTIVE
    const matchingAuthorities = await prisma.user.findMany({
      where: {
        id: { in: uniqueIds },
        role: UserRole.AUTHORITY,
        status: UserStatus.ACTIVE,
      },
    });

    if (matchingAuthorities.length !== 3) {
      return NextResponse.json(
        { error: "All 3 selected trustees must be active, confirmed Election Authority accounts." },
        { status: 400 }
      );
    }

    // Replace assignments in transaction
    await prisma.$transaction(async (tx) => {
      await tx.electionTrustee.deleteMany({
        where: { electionId },
      });

      for (let i = 0; i < uniqueIds.length; i++) {
        await tx.electionTrustee.create({
          data: {
            electionId,
            authorityId: uniqueIds[i],
            slotIndex: i + 1, // Slots 1, 2, 3 corresponding to Shamir x = 1, 2, 3
          },
        });
      }
    });

    return NextResponse.json({
      ok: true,
      message: "Successfully assigned 3 election authority trustees (Slots 1, 2, 3).",
      trustees: uniqueIds.map((id, idx) => ({
        slotIndex: idx + 1,
        authorityId: id,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not assign trustees.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
