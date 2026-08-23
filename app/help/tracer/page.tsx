import HelpFrame from "@/components/help/HelpFrame";
import { H2, H3, Lead, P, UL, LI, Callout, Code, Kbd, Steps, Step, XLink, Shot } from "@/components/help/ui";

export default function TracerPage() {
  return (
    <HelpFrame pageId="tracer" beta>
      <Lead>
        Tracer answers one question about a broker that&apos;s already live: <em>&quot;someone talked to my
        agent — what did it actually do, and why did it decide that?&quot;</em> It&apos;s read-only observability
        for deployed Agent Networks.
      </Lead>

      <H2 id="overview">What Tracer does</H2>
      <P>You do four things in Tracer:</P>
      <UL>
        <LI><strong>Pick a scope</strong> — business group → environment → deployed broker → time window.</LI>
        <LI><strong>Read the topology</strong> — a live graph of your broker and everything it talks to (agents, MCP servers, LLMs), with edges drawn from real traffic.</LI>
        <LI><strong>Drill into a task</strong> — one A2A turn, expanded to its iterations, tool calls, node transitions, LLM reasoning, conversation, artifacts, trace spans, and raw logs.</LI>
        <LI><strong>Invoke the broker live</strong> — send it a message from a chat rail and watch the canvas light up node-by-node.</LI>
      </UL>
      <P>
        Two adjacent modes share the same shell: <strong>Exchange Versions</strong> and <strong>LLM Proxy</strong>
        (covered below). Tracer is strictly read-only against the platform except the Invoke rail and the LLM
        Proxy playground, which send real requests to your endpoints.
      </P>

      <Shot
        src="/images/help/tracer-broker-activity.png"
        alt="Tracer with the network graph and a selected task"
        route="/agent-network"
        state="Broker Activity view: sidebar scope pickers, network canvas on top, task details below"
        caption="Tracer's Broker Activity view — scope on the left, graph and task details on the right."
      />

      <H2 id="layout">The layout</H2>
      <P>
        Tracer is a left sidebar plus a content column. At the top of the content column, three pill buttons
        switch the view mode: <strong>Broker Activity</strong> (the default), <strong>Exchange Versions</strong>,
        and <strong>LLM Proxy</strong>.
      </P>
      <P>
        In Broker Activity, the content splits into a <strong>network canvas</strong> on top and, once you pick a
        task, a <strong>task details</strong> pane below (drag the divider, or collapse either). A resizable
        <strong> Invoke</strong> rail sits on the right.
      </P>

      <H2 id="scope-picker">Picking a scope</H2>
      <P>The left sidebar is a chain of selectors — each one unlocks the next:</P>
      <Steps>
        <Step n={1} title="Business group">
          <P>The scope for everything. <Code>ALL</Code> is a valid choice but suppresses the downstream selectors.</P>
        </Step>
        <Step n={2} title="Environment">
          <P>Sandbox, Production, etc. Disabled until a business group is chosen.</P>
        </Step>
        <Step n={3} title="Broker (deployed)">
          <P>
            The live brokers found in that environment, grouped by their parent agent network. If you see
            &quot;No Brokers Activity Exists&quot;, nothing agentic is deployed there.
          </P>
        </Step>
        <Step n={4} title="Activity period">
          <P>
            The time window for the task list — 5 minutes up to 7 days, defaulting to <strong>Last 1 hour</strong>.
          </P>
        </Step>
      </Steps>
      <Callout tone="warn" title="Time period ≠ graph window">
        The activity period governs the <strong>task list</strong> only. The network graph&apos;s runtime edges
        always use a fixed 7-day window, and every task query is hard-capped at 7 days. So a quiet task list and
        a busy graph aren&apos;t a contradiction.
      </Callout>

      <H2 id="network-graph">The network graph</H2>
      <P>
        A hand-drawn SVG canvas (not a generic graph widget) showing four node types: <strong>broker</strong>,
        <strong> agent</strong>, <strong>MCP</strong>, and <strong>LLM</strong>. Edges are either design-time
        (declared) or runtime (drawn from actual traffic).
      </P>
      <H3 id="graph-controls">Getting around</H3>
      <UL>
        <LI><strong>Pan</strong> by dragging the background, <strong>zoom</strong> with the scroll wheel, and <strong>drag</strong> individual nodes to rearrange.</LI>
        <LI>Keyboard: <Kbd>F</Kbd> fits the view, <Kbd>+</Kbd> / <Kbd>-</Kbd> zoom. Bottom-right buttons do the same.</LI>
        <LI>Click a node for a details card (label, type, version, framework, asset id).</LI>
        <LI>The <strong>options menu</strong> sets layout (Tree / Radial), edge style (Straight / Bent), and filters to hide Agents, MCP servers, or LLMs.</LI>
      </UL>
      <Callout tone="info">
        Node positions and canvas options <em>don&apos;t</em> persist across reloads — only your sidebar and
        invoke-panel expansion do. And unknown node types quietly render as agents.
      </Callout>

      <H2 id="task-list">The task list</H2>
      <P>
        Below the selectors, the task list fills the sidebar once a broker is chosen. Each row is one task:
        its id, context, first tool, start/end, duration, iteration count, tools used, and status. Error tasks
        show a snippet inline. Click a row to open it; there&apos;s a manual refresh too.
      </P>
      <P>
        How many tasks you see — and how much detail — depends on your <strong>entitlement</strong> (below).
        Without Enhanced Log Search, Tracer falls back to runtime logs: fewer tasks, capped log pages, and no
        trace spans.
      </P>

      <H2 id="task-details">Task details</H2>
      <P>
        Selecting a task opens the drill-down: a timeline/tree on the left, a tabbed panel on the right. The
        tabs are <strong>API status</strong>, <strong>Message</strong>, <strong>Metadata</strong>,
        <strong> Task story</strong>, <strong>Traces</strong>, <strong>LLM Reasoning</strong>, and
        <strong> Raw Log</strong>.
      </P>
      <P>
        The left side offers <strong>Tree</strong>, <strong>List</strong>, and <strong>Graph</strong> views — but
        which are useful depends on the broker generation (see <XLink to="concepts" anchor="v1-v2">v1 vs
        v2</XLink>):
      </P>
      <UL>
        <LI><strong>v1</strong> brokers open on <strong>API status</strong> with a Tree/List of iterations and steps.</LI>
        <LI><strong>v2</strong> brokers open on <strong>Task story</strong> with a node timeline and a graph overlay of the path actually taken.</LI>
      </UL>
      <H3 id="graph-overlay">Graph execution overlay</H3>
      <P>
        For v2 brokers, the <strong>Graph</strong> view overlays what actually ran onto your design-time
        AgentScript graph: traversed edges, visited nodes, and a legend for taken / not-taken / ran-but-no-detail.
        If a node ran that isn&apos;t in the drawn version, you&apos;ll get a <strong>version-drift</strong> warning —
        the graph is the Exchange version inferred from the task&apos;s start time.
      </P>
      <Callout tone="info" title="Trace hierarchy is inferred">
        In the <strong>Traces</strong> tab, parent/child nesting is inferred from time containment, not from
        span parent ids — so on overlapping spans the tree can look approximate. That&apos;s expected.
      </Callout>

      <H2 id="invoke">Invoking a broker</H2>
      <P>
        The Invoke rail turns Tracer into a test client. It pre-fills a suggested URL from the selected broker;
        pick an auth mode (none / API key / basic / MuleSoft client id+secret) and load the agent card. Then chat.
      </P>
      <UL>
        <LI>The conversation panel offers the card&apos;s <strong>example prompts</strong> and <strong>skills</strong> as one-click starters.</LI>
        <LI><Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> makes a newline; Enter sends.</LI>
        <LI>While the broker works, the canvas animates node status transitions live.</LI>
        <LI>With no URL set, it runs a local simulation instead of a real call.</LI>
      </UL>
      <Callout tone="warn">
        Invoke sends <strong>real requests to a real endpoint</strong>. If the broker calls paid LLMs or mutating
        tools, an invocation has real effects and real cost.
      </Callout>

      <H2 id="exchange-versions">Exchange Versions</H2>
      <P>
        Switch to <strong>Exchange Versions</strong> to compare published releases of an agent network. View a
        single version&apos;s files, or <strong>compare</strong> two — Tracer diffs the project files and the
        network topology, listing added / removed / changed nodes, and tells you plainly when there&apos;s
        &quot;No differences in network topology between these versions.&quot; You can download a version&apos;s
        raw project zip.
      </P>
      <Callout tone="info">
        Exchange networks are listed <strong>per business group, not per environment</strong> — the sidebar says
        so, but it still trips people. This mode drops the environment selector for that reason.
      </Callout>

      <H2 id="llm-proxy">LLM Proxy</H2>
      <P>
        The <strong>LLM Proxy</strong> mode is a test harness for Flex Gateway LLM proxies. Browse deployed
        proxies, then chat against one with full control over model, temperature, top-p, max tokens, and
        streaming. It surfaces routing decisions, the <Code>x-llm-proxy-*</Code> response headers, token usage,
        and a raw request/response inspector. A separate network diagram shows the request path — green for the
        traced route, red only when a deny list matched.
      </P>

      <H2 id="entitlement">The entitlement wall</H2>
      <P>
        The biggest surprise for new users. Full-fidelity tracing depends on <strong>Enhanced Log Search</strong>,
        which requires the Anypoint <strong>Advanced</strong> package or a <strong>Titanium</strong> subscription.
        Tracer probes this per organization, so switching business groups can change what you see.
      </P>
      <Callout tone="warn" title="Without the entitlement, Tracer still works">
        It degrades gracefully to runtime logs: fewer tasks, log pages capped at 1000 lines, and trace fetching
        skipped entirely. It&apos;s <em>reduced fidelity</em>, not broken. Think &quot;fewer signals&quot;, not
        &quot;nothing works.&quot;
      </Callout>
      <P>
        For full task visibility, the deployment also needs the <Code>INSECURE-LOGGING</Code> monitoring category
        enabled in Runtime Manager, and the broker&apos;s Object Store keys must not have expired.
      </P>

      <H2 id="gotchas">Gotchas</H2>
      <UL>
        <LI><strong>No exports.</strong> There&apos;s no canvas image download and no task CSV/JSON export. To keep a trace, copy from the <strong>Raw Log</strong> tab. (The only screenshot feature anywhere is the bug-report widget.)</LI>
        <LI><strong>Object Store data expires.</strong> Task story and LLM reasoning vanish once keys TTL out (24h default). An empty panel on an old task is retention, not a failure.</LI>
        <LI><strong>v1 and v2 look different.</strong> Same UI, different tabs and default view. Don&apos;t assume a feature is missing.</LI>
        <LI><strong>LLM reasoning extraction is heuristic.</strong> For older brokers it&apos;s scraped from serialized Object Store payloads — partial or noisy output is expected.</LI>
        <LI><strong>Only the first instance is queried.</strong> Multi-instance brokers may under-report tasks.</LI>
        <LI><strong>A2A version mismatch</strong> in Invoke produces confusing broker errors — match 0.3 vs 1.0 to the broker.</LI>
        <LI><strong>Nothing is URL-addressable but the mode.</strong> Help can deep-link to Broker Activity / Exchange Versions / LLM Proxy, but not to a specific broker or task.</LI>
      </UL>
      <Callout tone="tip">
        Hitting a specific error? The <XLink to="troubleshooting">Troubleshooting</XLink> page has the
        &quot;Tracer shows nothing&quot; and entitlement cases with fixes.
      </Callout>
    </HelpFrame>
  );
}
