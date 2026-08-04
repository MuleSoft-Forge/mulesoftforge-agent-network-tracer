import { AfTriggerNode } from "@/components/composer/graph/nodes/AfTriggerNode";
import { AfRouterNode } from "@/components/composer/graph/nodes/AfRouterNode";
import { AfNode } from "@/components/composer/graph/nodes/AfNode";

export const agentFabricNodeTypes = {
  "af-trigger": AfTriggerNode,
  "af-router": AfRouterNode,
  "af-node": AfNode,
};
