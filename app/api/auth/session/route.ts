import { NextResponse } from "next/server";
import { getSessionStatus } from "@/lib/session";

export async function GET() {
  const status = await getSessionStatus();
  return NextResponse.json(status);
}
