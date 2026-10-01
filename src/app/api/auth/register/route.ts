import { NextResponse } from "next/server";
import { registerStudentVoter } from "@/backend/auth/registration";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request payload." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }

  const { name, studentId, email, password } = body as Record<string, unknown>;

  if (typeof name !== "string" || typeof studentId !== "string" || typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "All fields (name, studentId, email, password) are required." }, { status: 400 });
  }

  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("host");
  const reqBaseUrl = forwardedHost
    ? `${forwardedProto}://${forwardedHost}`
    : host
    ? `${host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https"}://${host}`
    : undefined;

  const result = await registerStudentVoter({
    name,
    studentId,
    email,
    password,
    baseUrl: reqBaseUrl,
  });

  if (!result.success) {
    let statusCode = 400;
    if (result.errorCode === "DUPLICATE_EMAIL" || result.errorCode === "DUPLICATE_STUDENT_ID") {
      statusCode = 409;
    } else if (result.errorCode === "INTERNAL_ERROR") {
      statusCode = 500;
    }
    return NextResponse.json({ error: result.error, errorCode: result.errorCode }, { status: statusCode });
  }

  return NextResponse.json(
    {
      success: true,
      message: "Registration successful. Please check your PSG Tech email for a verification link.",
      email: result.email,
      studentId: result.studentId,
    },
    { status: 201 }
  );
}
