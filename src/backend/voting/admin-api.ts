import { NextResponse } from "next/server";
import { getCurrentUser } from "@/backend/auth/session";

export async function requireAdminApi() {
  const user = await getCurrentUser();
  if (!user) {
    return { user: null, response: NextResponse.json({ error: "Sign in required." }, { status: 401 }) };
  }
  if (user.role !== "ADMIN") {
    return { user: null, response: NextResponse.json({ error: "Administrator access required." }, { status: 403 }) };
  }
  return { user, response: null };
}