import { NextResponse } from "next/server";
import { resendVerificationEmailByEmail } from "@/lib/registration";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request payload." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || !("email" in body)) {
    return NextResponse.json({ error: "Email address is required." }, { status: 400 });
  }

  const { email } = body as { email: unknown };
  if (typeof email !== "string" || !email.trim()) {
    return NextResponse.json({ error: "Email address is required." }, { status: 400 });
  }

  const result = await resendVerificationEmailByEmail(email.trim());

  if (!result.success) {
    let statusCode = 400;
    if (result.errorCode === "USER_NOT_FOUND") {
      statusCode = 404;
    } else if (result.errorCode === "INTERNAL_ERROR") {
      statusCode = 500;
    }
    return NextResponse.json({ error: result.error, errorCode: result.errorCode }, { status: statusCode });
  }

  return NextResponse.json({
    success: true,
    message: result.message || "A new verification link has been sent to your email.",
  });
}
