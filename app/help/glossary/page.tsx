import HelpFrame from "@/components/help/HelpFrame";
import { Lead, DefList, DefRow, XLink, Code } from "@/components/help/ui";

export default function GlossaryPage() {
  return (
    <HelpFrame pageId="glossary">
      <Lead>Every term, one line each. For the fuller picture, see <XLink to="concepts">Concepts</XLink>.</Lead>

      <DefList>
        <DefRow term="A2A (Agent-to-Agent)" id="a2a">
          The JSON-RPC 2.0 protocol brokers speak. Versions <strong>0.3</strong> (default) and <strong>1.0</strong>
          differ in method name, message shape, and header.
        </DefRow>
        <DefRow term="Action" id="action">
          A callable capability in AgentScript (<Code>@actions.x</Code>) — an MCP tool or an A2A send — that a
          node is allowed to run. Auto-created when you compose an MCP server or agent.
        </DefRow>
        <DefRow term="Agent card" id="agent-card">
          The A2A discovery document describing a broker and its skills; the public contract. Usually served at
          <Code>/.well-known/agent-card.json</Code>.
        </DefRow>
        <DefRow term="Agent Network" id="agent-network">
          The published unit — one Exchange asset bundling <Code>agent-network.yaml</Code>, <Code>exchange.json</Code>,
          and one broker&apos;s <Code>.agent</Code> file. Contains exactly one broker.
        </DefRow>
        <DefRow term="AgentScript" id="agentscript">
          MuleSoft&apos;s AgentFabric dialect for a broker&apos;s node graph, stored in a <Code>.agent</Code>
          file. Builder generates it from the canvas.
        </DefRow>
        <DefRow term="Anypoint CLI v4" id="cli">
          The command-line tool (<Code>anypoint-cli-v4</Code>) plus the agent-fabric plugin that Build &amp;
          Publish shells out to for build/publish/deploy.
        </DefRow>
        <DefRow term="Artifact" id="artifact">
          A named output a task produces, surfaced in Tracer&apos;s Task story.
        </DefRow>
        <DefRow term="Broker" id="broker">
          The deployed, LLM-driven agent runtime that receives A2A requests and runs its graph. A network&apos;s
          only front door.
        </DefRow>
        <DefRow term="Business group" id="business-group">
          The Anypoint org scope selected in the left sidebar; governs which assets, environments, and gateways
          you see. Passed to the CLI as <Code>--organization</Code>.
        </DefRow>
        <DefRow term="Connection" id="connection">
          A <Code>context.connections</Code> entry in the YAML that a composed Exchange asset becomes; targeted
          by actions and LLM bindings.
        </DefRow>
        <DefRow term="Context / contextId" id="context">
          The id grouping multiple tasks into one conversation.
        </DefRow>
        <DefRow term="Echo" id="echo">
          The graph node kind that sends a response to the client. Terminal on a Completed/Failed/Canceled/Rejected
          status; otherwise must transition onward.
        </DefRow>
        <DefRow term="Enhanced Log Search" id="log-search">
          The Anypoint entitlement (Advanced package / Titanium) that unlocks full-fidelity tracing. Without it,
          Tracer falls back to runtime logs.
        </DefRow>
        <DefRow term="Exchange asset / GAV" id="gav">
          A reusable published artifact identified by <Code>groupId : assetId : version</Code>. LLMs, MCP servers,
          agents, policies, and networks are all Exchange assets.
        </DefRow>
        <DefRow term="Executor" id="executor">
          A deterministic node kind — sets variables and runs actions, no LLM. Forbids slot-filling.
        </DefRow>
        <DefRow term="Gateway" id="gateway">
          A Flex Gateway used as a deployment target. For shared-space deploys you pick one gateway; the CLI
          derives the space.
        </DefRow>
        <DefRow term="Generator" id="generator">
          A node kind: a single LLM call to produce text — no tools, no loop.
        </DefRow>
        <DefRow term="LLM binding" id="llm">
          An LLM asset wired into AgentScript (<Code>@llm.x</Code>) that reasoning nodes use. On Tracer&apos;s
          graph, LLM nodes are design-time only.
        </DefRow>
        <DefRow term="MCP (Model Context Protocol)" id="mcp">
          The standard for agents calling external tools. An MCP server exposes named tools; a broker calls them
          as actions.
        </DefRow>
        <DefRow term="Object Store" id="object-store">
          Where brokers persist task state and reasoning — the source of Tracer&apos;s Task story. Keys expire
          (24h default TTL, 30d max).
        </DefRow>
        <DefRow term="Orchestrator" id="orchestrator">
          A subagent node specialized for coordinating multiple agents and MCP tools toward a goal.
        </DefRow>
        <DefRow term="Private space" id="private-space">
          A CloudHub 2.0 private space / Runtime Fabric deploy target; needs a space plus ingress and egress
          gateways.
        </DefRow>
        <DefRow term="Router" id="router">
          A deterministic branching node — routes on conditions, no LLM. Needs routes plus an <Code>otherwise</Code>
          target.
        </DefRow>
        <DefRow term="Shared space" id="shared-space">
          A CloudHub 2.0 shared regional space (the <Code>Cloudhub-</Code> prefix), derived by the CLI from your
          chosen gateway.
        </DefRow>
        <DefRow term="Skill" id="skill">
          A capability a broker advertises on its agent card; Tracer&apos;s Invoke rail offers skills as
          one-click starters.
        </DefRow>
        <DefRow term="Structured outputs" id="structured-outputs">
          Declared <Code>outputs</Code> on a reasoning node, letting a router branch on
          <Code>@node.output.field</Code> instead of parsing prose.
        </DefRow>
        <DefRow term="Subagent" id="subagent">
          A node kind: a generic agent loop with a prompt and a set of actions.
        </DefRow>
        <DefRow term="Task" id="task">
          One A2A request/turn — the unit Tracer traces. Carries iterations, artifacts, and a terminal status.
        </DefRow>
        <DefRow term="Task story" id="task-story">
          Tracer&apos;s structured v2 view of a task — conversation history, artifacts, and state — decoded from
          Object Store.
        </DefRow>
        <DefRow term="Teardown" id="teardown">
          Undeploy (stop the running network) and unpublish (erase the Exchange version). Undeploy first.
        </DefRow>
        <DefRow term="Trigger" id="trigger">
          The single graph entry point that starts the flow when a message arrives. Can&apos;t be deleted; nothing
          transitions into it.
        </DefRow>
        <DefRow term="v1 vs v2 broker" id="v1-v2">
          v1 = ReAct-style reasoning loop (Tree/List views); v2 = node-graph AgentScript runtime (timeline, Task
          story, graph overlay). Builder authors v2.
        </DefRow>
        <DefRow term="Variables / properties" id="variables">
          <Code>exchange.json</Code> deploy variables referenced as <Code>{"${group.field}"}</Code>, passed to the
          CLI as <Code>--property name:value</Code>. Secrets re-entered each session.
        </DefRow>
      </DefList>
    </HelpFrame>
  );
}
