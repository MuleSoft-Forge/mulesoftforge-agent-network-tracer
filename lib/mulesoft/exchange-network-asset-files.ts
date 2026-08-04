/**
 * Helpers for locating project zips and metadata files on published agent-network assets.
 */

export interface ExchangeAssetFileEntry {
  classifier?: string | null;
  packaging?: string;
  downloadURL?: string;
  externalLink?: string;
}

export function isFatClassifier(classifier: string | null | undefined): boolean {
  return (classifier ?? "").toLowerCase().startsWith("fat-");
}

/** Non-fat project zip (agent-network.yaml, exchange.json, brokers/*.agent). */
export function findProjectZipFile(
  files: ExchangeAssetFileEntry[]
): ExchangeAssetFileEntry | undefined {
  return files.find(
    (f) =>
      f.packaging === "zip" &&
      !isFatClassifier(f.classifier) &&
      (f.classifier === "agent-network" ||
        f.classifier === "agentic-network" ||
        f.classifier === "broker-group")
  );
}

export function findAgentNetworkMetadataFile(
  files: ExchangeAssetFileEntry[]
): ExchangeAssetFileEntry | undefined {
  return files.find(
    (f) => !isFatClassifier(f.classifier) && f.classifier === "agent-network-metadata"
  );
}
