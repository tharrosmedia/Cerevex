import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  // This will be captured by Sentry
  throw new Error("Sentry Test Error from API route");
}
