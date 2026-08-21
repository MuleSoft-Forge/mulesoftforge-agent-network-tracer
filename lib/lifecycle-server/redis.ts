/**
 * Redis connection factory. BullMQ requires `maxRetriesPerRequest: null` on the
 * connections it owns, so we centralize creation here.
 */

import { Redis } from "ioredis";
import { config } from "./config";
import { logger } from "./logger";

export function createRedis(): Redis {
  const client = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  // Without a listener, a transport-level failure becomes an unhandled 'error'
  // event. ioredis keeps reconnecting on its own, so log and let it recover.
  client.on("error", (err: Error) => {
    logger.warn("redis connection error", { error: err.message });
  });
  return client;
}
