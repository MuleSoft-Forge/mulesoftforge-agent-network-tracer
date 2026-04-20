import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function POST() {
  const session = await getSession();
  session.destroy();
  /** Required so iron-session writes the cleared cookie on the response; omitting this leaves `ant_session` stale. */
  await session.save();
  return NextResponse.json({ ok: true });
}
