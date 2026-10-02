import { NextResponse } from "next/server";
import { POST as handleAuthoritiesPost } from "../route";

export const runtime = "nodejs";

/**
 * POST /api/admin/authorities/invite
 * Dedicated endpoint for inviting an authority trustee via email.
 */
export async function POST(request: Request) {
  return handleAuthoritiesPost(request);
}
