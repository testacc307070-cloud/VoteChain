import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { UserRole } from "@prisma/client";
import { prisma } from "@/database/prisma";
import { requireAdminApi } from "@/backend/voting/admin-api";

export const runtime = "nodejs";

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
      select: { id: true, name: true, email: true, role: true },
    });

    if (!authorityUser || authorityUser.role !== UserRole.AUTHORITY) {
      return NextResponse.json({ error: "Authority account not found." }, { status: 404 });
    }

    // Verify whether this authority has submitted approvals for any election
    const approvalCount = await prisma.electionAuthorityApproval.count({
      where: { authorityId: authorityUser.id },
    });

    if (approvalCount > 0) {
      return NextResponse.json(
        {
          error: "Cannot delete an authority who has already submitted approvals or key shares for an election. To preserve threshold audit integrity, account cannot be removed.",
        },
        { status: 400 }
      );
    }

    await prisma.user.delete({
      where: { id: authorityUser.id },
    });

    await prisma.auditLog.create({
      data: {
        eventType: "AUTHORITY_REMOVED",
        actorReference: `admin:${auth.user.email}`,
        details: `Removed Authority Trustee "${authorityUser.name}" (${authorityUser.email}).`,
        eventHash: createHash("sha256").update(`${authorityUser.id}:REMOVED:${Date.now()}`).digest("hex"),
      },
    });

    return NextResponse.json({
      ok: true,
      message: `Authority "${authorityUser.name}" (${authorityUser.email}) removed successfully.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete authority account.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
