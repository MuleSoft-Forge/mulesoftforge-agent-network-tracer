/**
 * Load bundled MuleSoft example projects into the Builder model.
 */

import type { LocalProjectImportResult } from "@/lib/composer/import/import-local-project";
import { importLocalProjectEntries } from "@/lib/composer/import/import-local-project";
import type { ComposerExampleId } from "@/lib/composer/examples/catalog";
import {
  AGENT_YAML as IT_INVESTIGATION_YAML,
  BROKER_AGENT as IT_INVESTIGATION_AGENT,
  EXCHANGE_JSON as IT_INVESTIGATION_EXCHANGE,
} from "@/lib/composer/examples/it-investigation-broker/sources";

const ORG_PLACEHOLDER = "{ENTER YOUR ORG ID HERE}";

function patchOrgPlaceholders(content: string, organizationId: string): string {
  if (!organizationId) return content;
  return content.replaceAll(ORG_PLACEHOLDER, organizationId);
}

function loadItInvestigationBrokerExample(fallbackGroupId?: string): LocalProjectImportResult {
  const orgId = fallbackGroupId?.trim() ?? "";
  const exchangeJson = patchOrgPlaceholders(IT_INVESTIGATION_EXCHANGE, orgId);

  return importLocalProjectEntries(
    [
      { filename: "exchange.json", content: exchangeJson },
      { filename: "agent-network.yaml", content: IT_INVESTIGATION_YAML },
      { filename: "brokers/it-help-investigation.agent", content: IT_INVESTIGATION_AGENT },
    ],
    orgId || undefined
  );
}

export function loadComposerExample(
  id: ComposerExampleId,
  fallbackGroupId?: string
): LocalProjectImportResult {
  switch (id) {
    case "it-investigation-broker":
      return loadItInvestigationBrokerExample(fallbackGroupId);
    default: {
      const _exhaustive: never = id;
      throw new Error(`Unknown example: ${_exhaustive}`);
    }
  }
}
