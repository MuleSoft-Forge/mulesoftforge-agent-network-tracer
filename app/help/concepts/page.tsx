import HelpFrame from "@/components/help/HelpFrame";
import { H2, Lead, P, UL, LI, Callout, Code, XLink, Ext } from "@/components/help/ui";

export default function ConceptsPage() {
  return (
    <HelpFrame pageId="concepts">
      <Lead>
        Agent Networks come with their own vocabulary. Most of it maps cleanly onto ideas you already use in
        MuleSoft integration — this page draws those lines so the rest of the docs read easily.
      </Lead>

      <Callout tone="info" title="The one-sentence mental model">
        A <strong>broker</strong> is a deployed, LLM-driven agent that receives a message over <strong>A2A</strong>,
        runs a graph you authored in <strong>AgentScript</strong>, calls <strong>LLMs</strong>, <strong>MCP tools</strong>,
        and other <strong>agents</strong> along the way, and answers back. Everything else is detail on those nouns.
      </Callout>

      <H2 id="agent-network">Agent Network</H2>
      <P>
        The published unit of work — a single <strong>Exchange asset</strong> (a GAV: group / asset / version)
        that bundles three files: a network definition (<Code>agent-network.yaml</Code>), an Exchange
        descriptor (<Code>exchange.json</Code>), and one broker&apos;s graph (<Code>brokers/&lt;name&gt;.agent</Code>).
        In integration terms, it&apos;s the deployable application; in Agent Network terms it&apos;s
        &quot;the network&quot;.
      </P>
      <P>
        A network contains exactly <strong>one broker</strong> today. The plural (&quot;networks&quot;) exists
        because a broker can call <em>other</em> networks&apos; brokers as agents — that&apos;s how a network
        of agents forms.
      </P>

      <H2 id="broker">Broker</H2>
      <P>
        The deployed runtime. It&apos;s the thing that&apos;s actually live in Runtime Manager, listening for
        A2A requests. When <XLink to="tracer">Tracer</XLink> lists &quot;deployed brokers&quot;, each one is an
        API Manager instance in an environment. When <XLink to="builder">Builder</XLink> talks about
        &quot;the broker&quot;, it means the graph you&apos;re authoring that will <em>become</em> that runtime.
      </P>
      <P>
        The broker is the network&apos;s only public front door. The network itself has no A2A card — the
        broker&apos;s card is the contract.
      </P>

      <H2 id="agentscript">AgentScript</H2>
      <P>
        The language a broker&apos;s graph is written in — MuleSoft&apos;s <em>AgentFabric dialect</em>, stored
        in a <Code>.agent</Code> file. It declares an LLM-driven <strong>node graph</strong>: a trigger that
        starts on an inbound message, reasoning and routing nodes in the middle, and echo nodes that answer.
      </P>
      <P>
        You almost never hand-write it. In Builder you draw the graph on a canvas and AgentScript is the
        projection; a read-only (and optionally editable) AgentScript view is one toggle away. It&apos;s the
        equivalent of Studio&apos;s XML behind the visual flow.
      </P>

      <H2 id="a2a">A2A (Agent-to-Agent)</H2>
      <P>
        The JSON-RPC 2.0 protocol brokers speak — how a client talks to a broker, and how brokers talk to each
        other. Two versions are in play:
      </P>
      <UL>
        <LI>
          <strong>0.3</strong> — the default. Method <Code>message/send</Code>; the <Code>A2A-Version</Code>
          header is omitted.
        </LI>
        <LI>
          <strong>1.0</strong> — method <Code>SendMessage</Code>; a different message shape and a required
          <Code>A2A-Version</Code> header.
        </LI>
      </UL>
      <Callout tone="warn">
        Version mismatch is a classic confusing failure: 0.3 and 1.0 differ in method name, message shape,
        <em> and</em> header, so a broker built for one will reject the other with an opaque error. Tracer&apos;s
        Invoke rail lets you pick the version explicitly.
      </Callout>

      <H2 id="agent-card">Agent card</H2>
      <P>
        The A2A discovery document that describes a broker and the <strong>skills</strong> it advertises —
        think of it as the agent&apos;s OpenAPI/RAML spec. Clients fetch it (typically from{" "}
        <Code>/.well-known/agent-card.json</Code>) to learn where to send messages and what the agent can do.
        In Builder you edit it on the <strong>A2A card</strong> tab; its security is <em>derived</em> from your
        inbound policies, not hand-typed.
      </P>

      <H2 id="mcp">MCP</H2>
      <P>
        <strong>Model Context Protocol</strong> — the standard way agents call external <em>tools</em>. An MCP
        server exposes named tools (e.g. <Code>get_customer_profile</Code>); a broker calls them as
        <em> actions</em>. On Tracer&apos;s graph, MCP servers are their own node type. In Builder, adding an MCP
        server as an Exchange asset auto-creates one action per tool it advertises.
      </P>

      <H2 id="llm">LLMs</H2>
      <P>
        The models that do the reasoning. An LLM is an Exchange asset you compose in; in AgentScript it becomes
        a <em>binding</em> (<Code>@llm.&lt;name&gt;</Code>) that reasoning nodes use. A network has a default LLM
        and can bind several (e.g. a cheap model for classification, a bigger one for generation).
      </P>
      <Callout tone="info">
        On Tracer&apos;s network graph, LLM nodes are <em>design-time only</em> — they&apos;re synthesized from
        Exchange metadata, because the platform&apos;s topology feed doesn&apos;t report them directly.
      </Callout>

      <H2 id="exchange-assets">Exchange assets &amp; GAV</H2>
      <P>
        Same Exchange you already use. Every reusable thing — an LLM, an MCP server, an agent, a policy, and the
        agent network itself — is an Exchange asset identified by a <strong>GAV</strong>:{" "}
        <Code>groupId : assetId : version</Code>. Builder&apos;s golden rule is <strong>compose, never
        create</strong>: you wire <em>existing published</em> assets; Builder doesn&apos;t publish new ones (that&apos;s
        Build &amp; Publish&apos;s job).
      </P>
      <P>
        A composed asset fans out into three things automatically: an <Code>exchange.json</Code> dependency, a
        connection in the YAML, and deploy variables. You don&apos;t hand-maintain those — they&apos;re derived.
      </P>

      <H2 id="task">Task, context &amp; iteration</H2>
      <P>
        A <strong>task</strong> is one A2A request/turn — the unit Tracer traces. A <strong>contextId</strong>
        groups tasks into a conversation. Within a task, work happens in <strong>iterations</strong>:
      </P>
      <UL>
        <LI><strong>v1 brokers</strong> — an iteration is one LLM tool-selection loop (the ReAct pattern).</LI>
        <LI><strong>v2 brokers</strong> — an iteration is a graph runtime node/phase.</LI>
      </UL>
      <P>
        A task can produce <strong>artifacts</strong> (named outputs) and carries a terminal status
        (Completed / Failed / Canceled / Rejected). Tracer reconstructs the whole ordered timeline — the
        &quot;call stack&quot; — from logs, traces, and Object Store data.
      </P>

      <H2 id="v1-v2">v1 vs v2 brokers</H2>
      <P>
        This is the single most important split to internalize, because the <em>same</em> Tracer UI shows
        different tabs and views depending on which generation a broker is:
      </P>
      <UL>
        <LI>
          <strong>v1</strong> — a ReAct-style reasoning loop. Tracer shows a <strong>Tree</strong> and
          <strong> List</strong> of iterations and steps.
        </LI>
        <LI>
          <strong>v2</strong> — a node-graph (AgentScript) runtime. Tracer shows a <strong>node timeline</strong>,
          a <strong>Task story</strong>, and a graph overlay of the actual execution path.
        </LI>
      </UL>
      <P>
        Builder authors <strong>v2</strong> networks (Agent Network 2.0). If you compare a v1 and a v2 broker
        side by side in Tracer you&apos;ll think features are missing — they&apos;re just format-specific.
      </P>

      <H2 id="object-store">Object Store &amp; retention</H2>
      <P>
        Brokers persist their reasoning and task state in Anypoint <strong>Object Store</strong>. That&apos;s
        what powers Tracer&apos;s richest views — the Task story and LLM reasoning. The catch:
        <strong> it expires</strong>. The documented default TTL is 24 hours (30 days maximum), so if you open a
        task after its keys have aged out, those panels will be empty even though the task ran fine.
      </P>
      <Callout tone="tip">
        Chasing an intermittent &quot;why is Task story blank?&quot; — it&apos;s almost always retention, not a
        bug. See <XLink to="troubleshooting" anchor="empty-tracer">Tracer shows nothing</XLink>.
      </Callout>

      <P>
        Ready to use the tools? Jump to <XLink to="tracer">Tracer</XLink>,{" "}
        <XLink to="builder">Builder</XLink>, or <XLink to="build-publish">Build &amp; Publish</XLink>. Full
        MuleSoft references:{" "}
        <Ext href="https://docs.mulesoft.com/agent-network/latest/af-agent-network-yaml-reference">
          Agent Network YAML
        </Ext>{" "}
        and{" "}
        <Ext href="https://docs.mulesoft.com/agent-network/latest/af-agent-script-reference">
          AgentScript
        </Ext>
        .
      </P>
    </HelpFrame>
  );
}
