import { NextResponse } from "next/server";
import { verifyEmailToken } from "@/lib/registration";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request payload." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || !("token" in body)) {
    return NextResponse.json({ error: "Verification token is required." }, { status: 400 });
  }

  const { token } = body as { token: unknown };
  if (typeof token !== "string" || !token.trim()) {
    return NextResponse.json({ error: "Verification token is required." }, { status: 400 });
  }

  const result = await verifyEmailToken(token.trim());

  if (!result.success) {
    const statusCode = result.errorCode === "INTERNAL_ERROR" ? 500 : 400;
    return NextResponse.json({ error: result.error, errorCode: result.errorCode }, { status: statusCode });
  }

  return NextResponse.json({
    success: true,
    message: "Email address verified successfully. You can now sign in.",
    email: result.email,
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Verification token is required." }, { status: 400 });
  }

  const result = await verifyEmailToken(token.trim());

  if (!result.success) {
    const statusCode = result.errorCode === "INTERNAL_ERROR" ? 500 : 400;
    return NextResponse.json({ error: result.error, errorCode: result.errorCode }, { status: statusCode });
  }

  return NextResponse.json({
    success: true,
    message: "Email address verified successfully. You can now sign in.",
    email: result.email,
  });
}
