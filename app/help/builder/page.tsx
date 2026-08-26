import HelpFrame from "@/components/help/HelpFrame";
import { H2, H3, Lead, P, UL, LI, Callout, Code, Kbd, Steps, Step, XLink, Ext, Shot } from "@/components/help/ui";

const NODE_KINDS: { name: string; accent: string; tagline: string; needs: string }[] = [
  { name: "trigger", accent: "#14b8a6", tagline: "Entry point — starts the graph when a message arrives.", needs: "An on-message transition. Exactly one per interface; can't be deleted." },
  { name: "generator", accent: "#178bea", tagline: "One LLM call to generate text — no tools, no loop.", needs: "A prompt." },
  { name: "orchestrator", accent: "#9a63f9", tagline: "Coordinates multiple agents & MCP tools to reach a goal.", needs: "Reasoning instructions (loop default 25)." },
  { name: "subagent", accent: "#9a63f9", tagline: "Generic agent loop with a prompt and a set of actions.", needs: "Reasoning instructions." },
  { name: "executor", accent: "#059669", tagline: "Deterministic steps — set variables and run actions. No LLM.", needs: "A non-empty do: block." },
  { name: "router", accent: "#f59e0b", tagline: "Deterministic branching on conditions — no LLM.", needs: "At least one route + an otherwise target." },
  { name: "echo", accent: "#0891b2", tagline: "Sends a response back to the client.", needs: "A kind; status echoes need a state + message, artifact echoes need an artifact." },
];

export default function BuilderPage() {
  return (
    <HelpFrame pageId="builder" beta>
      <Lead>
        Builder is where you author an Agent Network — visually, on a canvas, the way you&apos;d build a flow in
        Studio. It edits one project made of three files, and it never publishes anything: you compose existing
        Exchange assets and export a bundle. (In the code it&apos;s called &quot;Composer&quot;.)
      </Lead>

      <H2 id="overview">What Builder does</H2>
      <P>
        You build one <strong>broker</strong>: an LLM-driven agent, reachable over A2A, that receives a message
        and runs a node graph — calling LLMs, MCP tools, and other agents before answering. The output is a
        local project bundle; <XLink to="build-publish">Build &amp; Publish</XLink> takes it from there.
      </P>
      <Callout tone="info" title="Compose, never create">
        Builder&apos;s golden rule. You wire <em>existing published</em> Exchange assets (or registry-local
        connections); Builder never publishes new assets to Exchange. If an LLM or MCP server isn&apos;t on
        Exchange yet, publish it there first.
      </Callout>

      <H2 id="start">Starting a project</H2>
      <P>
        First, pick a <strong>business group</strong> in the sidebar — nothing is available until you do. Then
        choose one of four starting points:
      </P>
      <UL>
        <LI><strong>Open from Exchange</strong> — import a published agent-network asset and version.</LI>
        <LI><strong>Open local project</strong> — a project folder or a <Code>.zip</Code>.</LI>
        <LI><strong>Start blank</strong> — an empty identity, a broker shell, and zero graph nodes.</LI>
        <LI><strong>Open prebuilt template</strong> — the Vogue Premiere Style Concierge (recommended for a first run).</LI>
      </UL>
      <Callout tone="tip" title="Learn from the example first">
        The Vogue Premiere template is a 20-node broker covering all seven node kinds — intent classification,
        routing, three subagents behind an orchestrator, two MCP servers, and a confirmation gate before an
        order is placed. Open it, explore the graph, and click nodes to read their playbooks. It loads through
        the exact same parser as your own projects.
      </Callout>

      <Shot
        src="/images/help/builder-canvas-vogue.png"
        alt="Builder graph canvas with the Vogue Premiere example loaded"
        route="/builder"
        state="Editing phase, Vogue Premiere template open, AS Graph tab showing the node graph"
        caption="The Builder canvas with the prebuilt example — nodes colored by kind, coach on each card."
      />

      <H2 id="the-model">One model, three files</H2>
      <P>
        Everything you edit lives in a single in-memory project. The three files are one-way projections of it:
      </P>
      <UL>
        <LI><Code>exchange.json</Code> — the Exchange descriptor: identity, dependencies, deploy variables.</LI>
        <LI><Code>agent-network.yaml</Code> — the network: registry, connections, and the broker&apos;s A2A card.</LI>
        <LI><Code>brokers/&lt;key&gt;.agent</Code> — the AgentScript graph (the executable part).</LI>
      </UL>
      <P>
        This is why a single rename fans out everywhere. Add an Exchange asset and Builder auto-creates the
        dependency, the connection, the deploy variables, and — for MCP servers — one action per tool. Delete
        it and all of that (plus references in graph nodes) is stripped back out. <strong>Don&apos;t
        hand-maintain derivations</strong>; edit the source and let them recompute.
      </P>
      <Callout tone="info" title="The four-hop chain worth memorizing">
        Exchange <strong>asset</strong> → YAML <strong>connection</strong> → an <strong>action</strong>{" "}
        (<Code>@actions.x</Code>) or <strong>LLM binding</strong> (<Code>@llm.x</Code>) → a graph{" "}
        <strong>node</strong> that references it. That&apos;s how a published tool becomes something a node can call.
      </Callout>

      <H2 id="guided-order">The guided build order</H2>
      <P>
        Builder ships an opinionated order and can gently enforce it (the <strong>Ordered tabs</strong> toggle;
        a methodology modal explains it on first entry). Tabs lock with a padlock until their prerequisite is
        met. The order:
      </P>
      <Steps>
        <Step n={1} title="Project (identity)">
          <P>Name, org, a valid Exchange asset id, version, version group. Org and descriptor version are one-way once set.</P>
        </Step>
        <Step n={2} title="Inventory (Exchange Assets)">
          <P>Compose at least one asset — an LLM, MCP server, or agent. This is where most of the auto-wiring happens.</P>
        </Step>
        <Step n={3} title="Variables">
          <P>Review derived deploy variables; add custom ones for any <Code>{"${group.field}"}</Code> markers you typed into prompts.</P>
        </Step>
        <Step n={4} title="A2A Interface then A2A card">
          <P>Set inbound/outbound policies first — they <em>generate</em> the card&apos;s security — then fill the card (name, version, description, endpoint URL).</P>
        </Step>
        <Step n={5} title="Instructions → LLM → Actions">
          <P>The broker persona, the LLM bindings, and the actions each node may call. Asset import usually pre-satisfies actions.</P>
        </Step>
        <Step n={6} title="Graph">
          <P>Where the real work happens — see below.</P>
        </Step>
      </Steps>
      <Callout tone="warn" title="Gating can switch itself off">
        With Ordered tabs on &quot;auto&quot;, gating is only active while some stage is short of data. An
        imported or example project arrives complete, so nothing locks — the guided walkthrough you read about
        may simply not appear. That&apos;s expected.
      </Callout>

      <H2 id="assets">Composing Exchange assets</H2>
      <P>
        &quot;Compose from Exchange&quot; opens the asset picker, filtered by kind (Agents / MCP Servers / LLMs /
        Policies) and scope (your business group / MuleSoft-supplied). Adding an asset auto-wires downstream
        objects — the mechanic to internalize:
      </P>
      <UL>
        <LI><strong>LLM</strong> → an LLM binding (and becomes the broker default if none exists yet).</LI>
        <LI><strong>MCP server</strong> → one action per advertised tool (metadata fetched at pick time).</LI>
        <LI><strong>Agent</strong> → one <Code>a2a:send_message</Code> action.</LI>
      </UL>
      <P>
        Renaming an asset&apos;s connection re-points every action and binding that used it. Removing an asset
        drops its actions/bindings and strips dangling references from graph nodes.
      </P>
      <Callout tone="info">
        The <strong>Legacy Registry</strong> tab inlines definitions instead of composing published assets.
        It exists for older projects and is discouraged — prefer Exchange Assets.
      </Callout>

      <H2 id="node-kinds">The seven node kinds</H2>
      <P>
        A crucial naming trap: <strong>MCP, A2A, and LLM are not node types.</strong> They reach the graph
        indirectly, as actions and bindings. The nodes on the canvas are these seven kinds:
      </P>
      <div className="my-5 space-y-2">
        {NODE_KINDS.map((k) => (
          <div key={k.name} className="flex gap-3 rounded-anypoint border border-gray-200 p-3">
            <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: k.accent }} aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-mono text-sm font-semibold text-gray-900">{k.name}</p>
              <p className="text-sm text-gray-600">{k.tagline}</p>
              <p className="mt-0.5 text-xs text-gray-400">Requires: {k.needs}</p>
            </div>
          </div>
        ))}
      </div>
      <P>
        <strong>Orchestrator vs subagent</strong> share a shape — orchestrator is a subagent specialized for
        coordinating multiple agents. <strong>Generator/orchestrator/subagent</strong> reason with an LLM;
        <strong> executor/router</strong> are deterministic (executors even forbid slot-filling, since there&apos;s
        no LLM to resolve arguments).
      </P>
      <Callout tone="tip" title="Structured outputs unlock clean routing">
        Give a reasoning node declared <Code>outputs</Code> and a router can branch on
        <Code>@node.output.field</Code> instead of parsing prose. The in-canvas coach nags about exactly this.
      </Callout>

      <H2 id="graph">Building the graph</H2>
      <P>The <strong>AS Graph</strong> tab is a React Flow canvas. Several ways to add nodes:</P>
      <UL>
        <LI><strong>Palette</strong> (top-left) — pick a kind to drop a node.</LI>
        <LI><strong>Drag-to-create</strong> — drag a connection onto empty canvas and pick a kind; it&apos;s created <em>and</em> wired.</LI>
        <LI><strong>Insert-on-edge</strong> — the <Code>+</Code> on any edge splices a node into <Code>source → new → target</Code>.</LI>
        <LI><strong>&quot;What next?&quot;</strong> — the coach on each node suggests and wires a sensible successor.</LI>
      </UL>
      <H3 id="graph-rules">Rules the canvas enforces</H3>
      <UL>
        <LI>Nothing can transition <em>into</em> the trigger; it&apos;s the entry point.</LI>
        <LI><strong>Echo is terminal-ish</strong> — it accepts inbound edges only (no source handle). A status echo in Completed/Failed/Canceled/Rejected ends a path; other states must transition onward.</LI>
        <LI>Every reachable path must reach a terminal echo, or you get a blocking error.</LI>
        <LI>Incompatible connections show a red &quot;Schema mismatch&quot; ping and a reason toast.</LI>
        <LI>Layout controls (Vertical / Horizontal) reflow the graph; the model owns positions, so adding nodes never disturbs a hand-arranged layout.</LI>
      </UL>
      <P>
        Shortcuts: <Kbd>⌘K</Kbd> command palette, <Kbd>⌘F</Kbd> canvas search, <Kbd>⌘Z</Kbd> / <Kbd>⇧⌘Z</Kbd>
        undo/redo. A <strong>Builder / AgentScript</strong> toggle (top bar, on the graph tab) reveals the raw
        <Code>.agent</Code> source with a live official-graph render.
      </P>

      <H2 id="validation">Validation &amp; the coach</H2>
      <P>
        A <strong>validation strip</strong> at the top shows a green &quot;Valid&quot; chip or
        &quot;N blocking · N warnings&quot;. Every issue is clickable — it opens the right tab and focuses the
        offending field. Each graph node also carries the <strong>ANT Coach</strong>: &quot;Node tips&quot;
        lists Required / Recommended / Optional advice, and &quot;What next?&quot; suggests successors.
      </P>
      <P>Validation runs in layers, and you meet them in this order:</P>
      <UL>
        <LI><strong>Structural</strong> — the project shape itself.</LI>
        <LI><strong>Consistency</strong> — the graph rules (triggers, echoes, routes, actions, LLMs).</LI>
        <LI><strong>Official schema</strong> — the Agent Network v2 JSON Schema.</LI>
        <LI><strong>A2A card completeness</strong> — required and recommended card fields.</LI>
        <LI><strong>AgentScript conformance</strong> — the official AgentFabric linter over the exact bytes.</LI>
      </UL>
      <Callout tone="info">
        Governance warnings (e.g. an MCP tool ref with no <Code>allowed</Code> list) are intentionally
        non-blocking — advice, not errors.
      </Callout>

      <H2 id="save-export">Saving &amp; exporting</H2>
      <P>Three options at the bottom of the left nav:</P>
      <UL>
        <LI><strong>Save in browser</strong> — a localStorage library keyed by GAV, 25 entries max. <em>No validation gate</em>, so you can park an incomplete project.</LI>
        <LI><strong>Save to folder…</strong> — writes real files. Chromium only (Chrome/Edge).</LI>
        <LI><strong>Download .zip</strong> — the bundle as <Code>&lt;assetId&gt;.zip</Code>.</LI>
      </UL>
      <Callout tone="info" title="No export is validation-gated">
        Save to folder and Download .zip write whatever is in Builder, validation errors and all — the
        validation strip is advisory everywhere, not a gate on any save/export/deploy path. This is
        intentional: Builder&apos;s checks can be stale relative to what the real build server accepts, so
        the build step in <XLink to="build-publish">Build &amp; Publish</XLink> is the actual gate. There is
        <strong> no publish or deploy from Builder itself</strong> — hand the bundle to Build &amp; Publish
        for that.
      </Callout>

      <H2 id="gotchas">Gotchas</H2>
      <UL>
        <LI><strong>Deleting an asset silently rewrites the graph</strong> — its actions, bindings, and every node reference to them are removed.</LI>
        <LI><strong>The trigger can&apos;t be deleted, and there&apos;s only ever one.</strong></LI>
        <LI><strong>Org id and descriptor version are one-way</strong> — to change org, go back to the landing page.</LI>
        <LI><strong>Card security can&apos;t be hand-edited</strong> — it&apos;s derived from your A2A Interface policies only.</LI>
        <LI><strong>An edit can re-lock the tab you&apos;re on</strong> — e.g. clearing the project name kicks you back to the Project stage.</LI>
        <LI><strong>Editing files or AgentScript while the model changed underneath</strong> blocks Apply until you reset. Semantic warnings need a second &quot;Apply with migrations&quot; click.</LI>
        <LI><strong>v1 projects are rejected on import</strong>, and multiple ambiguous <Code>.agent</Code> files throw.</LI>
        <LI><strong>&quot;Save in browser&quot; doesn&apos;t validate</strong>, and it overwrites in place at the same GAV.</LI>
      </UL>
      <P>
        Node and field references live in MuleSoft&apos;s{" "}
        <Ext href="https://docs.mulesoft.com/agent-network/latest/af-agent-script-reference">AgentScript reference</Ext>.
      </P>
    </HelpFrame>
  );
}
