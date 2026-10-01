import { NextResponse } from "next/server";
import { requireAdminApi } from "@/backend/voting/admin-api";
import { prisma } from "@/database/prisma";
import { parseEligibilityCsv } from "@/backend/voting/csv-eligibility";
import { importElectionEligibilityList } from "@/backend/voting/eligibility";

export const runtime = "nodejs";

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
      select: { id: true, name: true, status: true },
    });

    if (!election) {
      return NextResponse.json({ error: "Election not found." }, { status: 404 });
    }

    const eligibleVoters = await prisma.electionEligibleVoter.findMany({
      where: { electionId },
      orderBy: [{ studentId: "asc" }, { email: "asc" }],
    });

    return NextResponse.json({
      electionId,
      electionName: election.name,
      count: eligibleVoters.length,
      eligibleVoters,
    });
  } catch (error) {
    console.error("Error loading eligibility list:", error);
    return NextResponse.json({ error: "Could not load eligibility list." }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ electionId: string }> }
) {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;

  const { electionId } = await context.params;

  try {
    const election = await prisma.election.findUnique({
      where: { id: electionId },
      select: { id: true, status: true },
    });

    if (!election) {
      return NextResponse.json({ error: "Election not found." }, { status: 404 });
    }

    if (election.status === "CLOSED" || election.status === "RESULTS_PUBLISHED") {
      return NextResponse.json(
        { error: "Eligibility register cannot be modified after an election has closed." },
        { status: 409 }
      );
    }

    let csvContent = "";
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file || typeof file === "string") {
        return NextResponse.json(
          { error: "Please upload a valid CSV file (multipart field 'file')." },
          { status: 400 }
        );
      }
      csvContent = await (file as Blob).text();
    } else {
      const body = (await request.json()) as { csv?: unknown; csvContent?: unknown };
      csvContent = String(body.csv || body.csvContent || "");
    }

    if (!csvContent.trim()) {
      return NextResponse.json(
        { error: "CSV data is empty. Please provide CSV content with student_id,email." },
        { status: 400 }
      );
    }

    const parseResult = parseEligibilityCsv(csvContent);
    if (!parseResult.ok) {
      return NextResponse.json(
        {
          error: parseResult.error,
          errors: parseResult.errors,
        },
        { status: 400 }
      );
    }

    const result = await importElectionEligibilityList(
      electionId,
      parseResult.records,
      auth.user.email
    );

    return NextResponse.json({
      success: true,
      message: `Successfully imported ${result.count} eligible voters (${result.duplicatesIgnored} duplicates ignored).`,
      count: result.count,
      duplicatesIgnored: result.duplicatesIgnored,
      sample: parseResult.records.slice(0, 5),
    });
  } catch (error) {
    console.error("Error importing eligibility list:", error);
    const message = error instanceof Error ? error.message : "Failed to import eligibility list.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
