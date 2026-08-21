/**
 * BullMQ queue definition shared by the enqueue route (producer) and the worker
 * (consumer).
 *
 * The queued payload is deliberately small: the project bundle plus non-secret
 * references, and the acting user's short-lived token which rides only on the
 * transient job payload (never on the persisted JobRecord).
 */

import { Queue } from "bullmq";
import { config } from "./config";
import { createRedis } from "./redis";
import type {
  CliCommand,
  DeployOptions,
  JobActor,
  ProjectFileEntry,
  RemovalOptions,
} from "./contracts";

export interface LifecycleJobData {
  jobId: string;
  command: CliCommand;
  orgId: string;
  connectionRef: string;
  actor: JobActor;
  /** Empty for a removal that targets a remote GAV. */
  project: ProjectFileEntry[];
  deploy?: DeployOptions;
  removal?: RemovalOptions;
  /**
   * The acting user's short-lived Anypoint access token. When present the worker
   * authenticates the CLI as the user (ANYPOINT_BEARER) instead of resolving a
   * per-org Connected App secret. Lives only on the transient queue payload,
   * never on the persisted JobRecord.
   */
  userToken?: string;
  /** Control-plane base URL for the token, used to derive ANYPOINT_HOST. */
  baseUrl?: string;
}

export function createQueue(): Queue<LifecycleJobData> {
  return new Queue<LifecycleJobData>(config.queueName, {
    connection: createRedis(),
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { age: config.jobRetentionSeconds },
      removeOnFail: { age: config.jobRetentionSeconds },
    },
  });
}
