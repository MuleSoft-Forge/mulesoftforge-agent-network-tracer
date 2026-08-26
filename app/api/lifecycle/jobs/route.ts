import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { requireAuth } from "@/lib/api/auth-middleware";
import { resolveActorAndOrg } from "@/lib/lifecycle/actor";
import { getStore, getQueue, isLifecycleConfigured } from "@/lib/lifecycle-server/runtime";
import { config } from "@/lib/lifecycle-server/config";
import {
  JOB_COMMANDS,
  GAV_PATTERN,
  isRemovalJobCommand,
  type JobRecord,
} from "@/lib/lifecycle-server/contracts";
import type { LifecycleJobData } from "@/lib/lifecycle-server/queue";
import { validateAgentScriptEntries } from "@/lib/composer/agentscript-conformance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const projectFileSchema = z.object({
  filename: z.string().min(1).max(1024),
  content: z.string(),
});

// Deploy options are re-validated strictly by the worker (deploy-argv); here we
// only enforce the coarse shape so obviously bad requests fail fast.
const deploySchema = z
  .object({
    /**
     * Business group id from the signed-in user's session context. The org
     * *name* the CLI needs is resolved here from the profile, so the client
     * never supplies (or has to know) it.
     */
    organizationId: z.string().optional(),
    environment: z.string().min(1),
    targetKind: z.enum(["shared", "private"]),
    gateway: z.string().optional(),
    targetSpace: z.string().optional(),
    ingressGw: z.string().optional(),
    egressGw: z.string().optional(),
    properties: z
      .array(z.object({ name: z.string(), value: z.string() }))
      .default([]),
  })
  .passthrough();

// Same split of responsibility as deploy: coarse shape here, strict argv
// validation in the worker (removal-argv).
const removalSchema = z.object({
  organizationId: z.string().optional(),
  environment: z.string().max(128).optional(),
  gav: z.string().max(512).regex(GAV_PATTERN, "Expected groupId:assetId:version").optional(),
  hardDelete: z.boolean().optional(),
});

const submitSchema = z
  .object({
    command: z.enum(JOB_COMMANDS),
    project: z.array(projectFileSchema).max(2000).default([]),
    deploy: deploySchema.optional(),
    removal: removalSchema.optional(),
    connectionRef: z.string().min(1).max(256).optional(),
    idempotencyKey: z.string().min(1).max(256).optional(),
  })
  .refine((body) => !isRemovalJobCommand(body.command) || body.removal !== undefined, {
    message: "removal options are required for unpublish, undeploy, and teardown",
    path: ["removal"],
  })
  // `build` (run by every command as a prerequisite) resolves API instances
  // against the selected environment, so publish needs it just as much as
  // deploy does — even though publish itself takes no gateway/space.
  .refine(
    (body) => (body.command !== "deploy" && body.command !== "publish") || body.deploy !== undefined,
    {
      message: "deploy options are required for the publish and deploy commands",
      path: ["deploy"],
    }
  )
  // teardown's first step is undeploy, so it needs the same environment.
  .refine(
    (body) =>
      (body.command !== "undeploy" && body.command !== "teardown") ||
      Boolean(body.removal?.environment?.trim()),
    {
      message: "an environment is required to undeploy",
      path: ["removal", "environment"],
    }
  )
  // Every other command needs files; a removal by GAV deliberately has none.
  .refine((body) => Boolean(body.removal?.gav) || body.project.length > 0, {
    message: "a project bundle is required unless a gav is supplied",
    path: ["project"],
  });

function bundleBytes(project: { content: string }[]): number {
  let total = 0;
  for (const entry of project) total += Buffer.byteLength(entry.content, "utf8");
  return total;
}

export async function POST(request: NextRequest) {
  if (!isLifecycleConfigured()) {
    return NextResponse.json({ error: "remote_lifecycle_disabled" }, { status: 501 });
  }

  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const { baseUrl, accessToken } = authResult;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  if (bundleBytes(parsed.data.project) > config.maxBundleBytes) {
    return NextResponse.json(
      { error: "bundle_too_large", maxBytes: config.maxBundleBytes },
      { status: 413 }
    );
  }

  if (!isRemovalJobCommand(parsed.data.command)) {
    try {
      const conformanceErrors = await validateAgentScriptEntries(parsed.data.project);
      if (conformanceErrors.length > 0) {
        return NextResponse.json(
          { error: "invalid_agentscript", details: conformanceErrors },
          { status: 400 }
        );
      }
    } catch (error) {
      return NextResponse.json(
        {
          error: "agentscript_validation_unavailable",
          message: error instanceof Error ? error.message : String(error),
        },
        { status: 503 }
      );
    }
  }

  let actorAndOrg;
  try {
    actorAndOrg = await resolveActorAndOrg(baseUrl, accessToken);
  } catch (err) {
    return NextResponse.json(
      { error: "profile_unavailable", message: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }

  const { actor, orgId, businessGroups } = actorAndOrg;

  // The CLI resolves environment and gateway names inside --organization, so a
  // deploy must name the business group the UI listed them from. The client
  // sends only the id it already holds in session context; the name comes from
  // the profile, and an id the user isn't a member of is rejected rather than
  // silently falling back to the root org.
  const resolveOrganizationName = (organizationId: string | undefined): string | null => {
    const targetOrgId = organizationId?.trim() || orgId;
    return businessGroups.find((group) => group.id === targetOrgId)?.name ?? null;
  };
  const unknownBusinessGroup = (organizationId: string | undefined) =>
    NextResponse.json(
      { error: "unknown_business_group", organizationId: organizationId?.trim() || orgId },
      { status: 400 }
    );

  let deploy = parsed.data.deploy;
  if (deploy) {
    const organization = resolveOrganizationName(deploy.organizationId);
    if (!organization) return unknownBusinessGroup(deploy.organizationId);
    const { organizationId: _ignored, ...rest } = deploy;
    deploy = { ...rest, organization };
  }

  // Teardown resolves names inside a business group the same way, so it needs
  // the same id-to-name mapping and the same membership check.
  let removal;
  if (parsed.data.removal) {
    const organization = resolveOrganizationName(parsed.data.removal.organizationId);
    if (!organization) return unknownBusinessGroup(parsed.data.removal.organizationId);
    const { organizationId: _ignored, ...rest } = parsed.data.removal;
    removal = { ...rest, organization };
  }

  const connectionRef = parsed.data.connectionRef?.trim() || orgId;
  const store = getStore();
  const jobId = crypto.randomUUID();

  if (parsed.data.idempotencyKey) {
    const winnerId = await store.reserveIdempotencyKey(parsed.data.idempotencyKey, jobId);
    if (winnerId !== jobId) {
      const existing = await store.getJob(winnerId);
      if (existing) {
        return NextResponse.json(
          { jobId: existing.id, status: existing.status, deduped: true },
          { status: 200 }
        );
      }
    }
  }

  const record: JobRecord = {
    id: jobId,
    command: parsed.data.command,
    status: "queued",
    orgId,
    connectionRef,
    actor,
    createdAt: new Date().toISOString(),
  };
  await store.createJob(record);

  const data: LifecycleJobData = {
    jobId,
    command: parsed.data.command,
    orgId,
    connectionRef,
    actor,
    project: parsed.data.project,
    deploy,
    removal,
    // Run the CLI as the signed-in user: forward their short-lived Anypoint
    // access token so the worker authenticates via ANYPOINT_BEARER, using the
    // user's own org permissions. The token comes from the session here — the
    // browser never sends it, and it never lands on the persisted JobRecord.
    userToken: accessToken,
    baseUrl,
  };
  await getQueue().add(parsed.data.command, data, { jobId });

  return NextResponse.json({ jobId, status: "queued" }, { status: 202 });
}
