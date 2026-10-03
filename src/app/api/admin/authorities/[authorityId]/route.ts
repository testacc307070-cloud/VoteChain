import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { ElectionStatus, UserRole, UserStatus } from "@prisma/client";
import { prisma } from "@/database/prisma";
import { requireAdminApi } from "@/backend/voting/admin-api";

export const runtime = "nodejs";

/**
 * DELETE /api/admin/authorities/[authorityId]
 * Safely removes an authority trustee account:
 * - If assigned to DRAFT elections, removes the trustee assignment and allows deletion.
 * - If assigned to non-DRAFT/historical elections or submitted key shares, prevents physical
 *   deletion to protect blockchain audit trail and threshold integrity, returning a clear error.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ authorityId: string }> }
) {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;

  const { authorityId } = await context.params;

  try {
    const authorityUser = await prisma.user.findUnique({
      where: { id: authorityId },
      select: { id: true, name: true, email: true, role: true, status: true },
    });

    if (!authorityUser || authorityUser.role !== UserRole.AUTHORITY) {
      return NextResponse.json({ error: "Authority account not found." }, { status: 404 });
    }

    // 1. Check for cryptographic key shares or election approvals
    const approvalCount = await prisma.electionAuthorityApproval.count({
      where: { authorityId: authorityUser.id },
    });

    // 2. Check all election trustee assignments
    const trusteeAssignments = await prisma.electionTrustee.findMany({
      where: { authorityId: authorityUser.id },
      include: {
        election: {
          select: { id: true, name: true, status: true },
        },
      },
    });

    const historicalAssignments = trusteeAssignments.filter(
      (t) => t.election.status !== ElectionStatus.DRAFT
    );

    // 3. Block physical deletion if tied to active or historical elections
    if (historicalAssignments.length > 0 || approvalCount > 0) {
      const electionList = historicalAssignments
        .map((t) => `"${t.election.name}" (${t.election.status})`)
        .join(", ");

      const reason = historicalAssignments.length > 0
        ? `This authority is assigned as a trustee to active/historical election(s): ${electionList}.`
        : `This authority has submitted threshold cryptographic key shares.`;

      return NextResponse.json(
        {
          error: `Cannot delete authority "${authorityUser.name}". ${reason} To preserve mathematical threshold recovery, blockchain verification, and cryptographic audit integrity, historical trustee records cannot be removed. You may suspend the account instead to revoke access.`,
          isHistorical: true,
          status: authorityUser.status,
        },
        { status: 400 }
      );
    }

    // 4. Safe removal: unassign from DRAFT elections, remove pending tokens, then delete user
    await prisma.$transaction(async (tx) => {
      // Clean up draft trustee assignments
      await tx.electionTrustee.deleteMany({
        where: {
          authorityId: authorityUser.id,
          election: { status: ElectionStatus.DRAFT },
        },
      });

      // Clean up verification/invitation tokens
      await tx.verificationToken.deleteMany({
        where: { userId: authorityUser.id },
      });

      // Safely delete the authority user
      await tx.user.delete({
        where: { id: authorityUser.id },
      });

      // Record audit log
      await tx.auditLog.create({
        data: {
          eventType: "AUTHORITY_REMOVED",
          actorReference: `admin:${auth.user.email}`,
          details: `Removed Authority Trustee "${authorityUser.name}" (${authorityUser.email}) and cleared draft trustee assignments.`,
          eventHash: createHash("sha256").update(`${authorityUser.id}:REMOVED:${Date.now()}`).digest("hex"),
        },
      });
    });

    return NextResponse.json({
      ok: true,
      message: `Authority "${authorityUser.name}" (${authorityUser.email}) removed successfully.`,
    });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "Unknown database error";
    // Sanitize any raw Prisma errors into clear, human-readable explanations
    let friendlyMessage = "Could not delete authority account.";
    if (rawMessage.includes("foreign key constraint") || rawMessage.includes("ElectionTrustee")) {
      friendlyMessage = "Cannot delete authority because they are linked to existing election records. Please ensure draft elections are updated or suspend the account.";
    }
    return NextResponse.json({ error: friendlyMessage }, { status: 400 });
  }
}

/**
 * PATCH /api/admin/authorities/[authorityId]
 * Updates authority status (e.g., SUSPENDED or ACTIVE) for accounts that cannot be deleted
 * due to historical election records.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ authorityId: string }> }
) {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;

  const { authorityId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { status } = (body || {}) as { status?: string };
  if (!status || (status !== "ACTIVE" && status !== "SUSPENDED")) {
    return NextResponse.json({ error: "Invalid status. Allowed values: ACTIVE, SUSPENDED." }, { status: 400 });
  }

  try {
    const authority = await prisma.user.findUnique({
      where: { id: authorityId },
      select: { id: true, name: true, email: true, role: true },
    });

    if (!authority || authority.role !== UserRole.AUTHORITY) {
      return NextResponse.json({ error: "Authority account not found." }, { status: 404 });
    }

    const updated = await prisma.user.update({
      where: { id: authorityId },
      data: { status: status as UserStatus },
      select: { id: true, name: true, email: true, status: true },
    });

    await prisma.auditLog.create({
      data: {
        eventType: "AUTHORITY_STATUS_UPDATED",
        actorReference: `admin:${auth.user.email}`,
        details: `Updated Authority Trustee "${authority.name}" status to ${status}.`,
        eventHash: createHash("sha256").update(`${authorityId}:${status}:${Date.now()}`).digest("hex"),
      },
    });

    return NextResponse.json({
      ok: true,
      message: `Authority "${authority.name}" status updated to ${status}.`,
      authority: updated,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update authority status.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
