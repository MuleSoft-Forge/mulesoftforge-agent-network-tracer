import { NextRequest, NextResponse } from "next/server";
import { getRegionById } from "@/lib/regions";
import type { RegionId } from "@/lib/regions";

const REGION_ENV: Record<
  RegionId,
  { clientId: string; clientSecret: string } | undefined
> = {
  us: process.env.ANYPOINT_CLIENT_ID
    ? {
        clientId: process.env.ANYPOINT_CLIENT_ID,
        clientSecret: process.env.ANYPOINT_CLIENT_SECRET ?? "",
      }
    : undefined,
  eu: process.env.ANYPOINT_EU_CLIENT_ID
    ? {
        clientId: process.env.ANYPOINT_EU_CLIENT_ID,
        clientSecret: process.env.ANYPOINT_EU_CLIENT_SECRET ?? "",
      }
    : undefined,
  ca: process.env.ANYPOINT_CA_CLIENT_ID
    ? {
        clientId: process.env.ANYPOINT_CA_CLIENT_ID,
        clientSecret: process.env.ANYPOINT_CA_CLIENT_SECRET ?? "",
      }
    : undefined,
  jp: process.env.ANYPOINT_JP_CLIENT_ID
    ? {
        clientId: process.env.ANYPOINT_JP_CLIENT_ID,
        clientSecret: process.env.ANYPOINT_JP_CLIENT_SECRET ?? "",
      }
    : undefined,
};

export async function GET(request: NextRequest) {
  const region = (request.nextUrl.searchParams.get("region") ?? "us") as RegionId;
  const regionOption = getRegionById(region);

  if (!regionOption?.available) {
    return NextResponse.json(
      { error: `Region ${region} is not available` },
      { status: 400 }
    );
  }

  const creds = REGION_ENV[region];
  if (!creds?.clientId) {
    return NextResponse.json(
      { error: `Client ID not configured for region ${region}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    clientId: creds.clientId,
    baseUrl: regionOption.baseUrl,
  });
}
