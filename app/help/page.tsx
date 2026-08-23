import Link from "next/link";
import { ArrowRight, Radar, Boxes, Rocket } from "lucide-react";
import HelpFrame from "@/components/help/HelpFrame";
import { helpHref } from "@/lib/help/help-map";
import { H2, Lead, P, UL, LI, Callout, Steps, Step, Code, XLink, Ext, Shot } from "@/components/help/ui";

export default function HelpHomePage() {
  return (
    <HelpFrame pageId="home">
      <Lead>
        You know Anypoint Platform. You&apos;ve wired flows in Studio, published to Exchange, deployed
        to CloudHub. <strong>Agent Networks</strong> are the next thing you&apos;ll build there — and this
        studio is the friendly, UI-first way in. No code editor required to get started.
      </Lead>

      <H2 id="what-is-this">What is this?</H2>
      <P>
        <strong>Agent Network Studio</strong> is a suite of three browser tools for building, shipping, and
        observing MuleSoft <em>Agent Networks</em> — AI agents that talk to each other, call tools, and
        reason with LLMs over the A2A (Agent-to-Agent) protocol.
      </P>
      <P>
        If Anypoint Code Builder felt code-first and unforgiving when you first met Agent Networks, this is
        the antidote: you compose on a canvas, you deploy with a button, and you watch what your agents
        actually did on a live graph. Think of it as <em>Anypoint Studio for agents</em>.
      </P>

      <Callout tone="tip" title="New to the vocabulary?">
        Start with <XLink to="concepts">Concepts</XLink>. It defines broker, A2A, MCP, AgentScript, and the
        rest in one page — the terms every other page assumes you know.
      </Callout>

      <H2 id="from-integration">Coming from MuleSoft integration</H2>
      <P>
        Almost everything you already know maps across. Here&apos;s the Rosetta Stone:
      </P>
      <div className="my-5 overflow-hidden rounded-anypoint border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">In integration you&apos;d…</th>
              <th className="px-4 py-2 font-medium">In an Agent Network you…</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-gray-700">
            <tr>
              <td className="px-4 py-2">Build a Mule app in Studio</td>
              <td className="px-4 py-2">Compose a <strong>broker</strong> (the deployed agent runtime) in <strong>Builder</strong></td>
            </tr>
            <tr>
              <td className="px-4 py-2">Draw a flow of connectors &amp; components</td>
              <td className="px-4 py-2">Draw a <strong>node graph</strong> of LLM, tool, and routing steps in <strong>AgentScript</strong></td>
            </tr>
            <tr>
              <td className="px-4 py-2">Reuse Exchange assets (connectors, APIs)</td>
              <td className="px-4 py-2">Reuse Exchange assets (LLMs, MCP servers, agents)</td>
            </tr>
            <tr>
              <td className="px-4 py-2">Expose an API via APIkit / a listener</td>
              <td className="px-4 py-2">Expose an <strong>A2A card</strong> — the agent&apos;s public front door</td>
            </tr>
            <tr>
              <td className="px-4 py-2">Publish &amp; deploy to CloudHub</td>
              <td className="px-4 py-2">Publish &amp; deploy the same way in <strong>Build &amp; Publish</strong></td>
            </tr>
            <tr>
              <td className="px-4 py-2">Debug with Anypoint Monitoring</td>
              <td className="px-4 py-2">Trace every task, hop, and LLM decision in <strong>Tracer</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
      <P>
        The big new idea: instead of a deterministic flow you author every step of, a broker is
        <em> LLM-driven</em>. You describe intent, wire the tools it&apos;s allowed to use, and it decides
        what to do at runtime. Builder keeps that honest with a visual graph so the non-determinism stays
        readable.
      </P>

      <H2 id="the-three-tools">The three tools</H2>
      <div className="my-6 grid gap-4 sm:grid-cols-3">
        <ToolCard
          href={helpHref("tracer")}
          icon={<Radar className="h-5 w-5" />}
          name="Tracer"
          tagline="See what your brokers are doing."
          body="Live observability for deployed brokers: the network graph, per-task traces, and the LLM's reasoning."
        />
        <ToolCard
          href={helpHref("builder")}
          icon={<Boxes className="h-5 w-5" />}
          name="Builder"
          tagline="Compose, never create."
          body="Visually author an Agent Network 2.0 project — wire Exchange assets, draw the broker graph, export the bundle."
        />
        <ToolCard
          href={helpHref("build-publish")}
          icon={<Rocket className="h-5 w-5" />}
          name="Build & Publish"
          tagline="Ship it for real."
          body="Run the real Anypoint CLI lifecycle from the browser: build, publish to Exchange, deploy, and tear down."
        />
      </div>
      <P>
        Two more surfaces ride inside Tracer: <strong>Exchange Versions</strong> (diff two published releases
        of a network) and <strong>LLM Proxy</strong> (test Flex Gateway LLM routing). They share Tracer&apos;s
        shell — see the <XLink to="tracer">Tracer</XLink> page.
      </P>

      <H2 id="quickstart">Quickstart (about 10 minutes)</H2>
      <P>
        The fastest way to <em>feel</em> the whole loop is to open the prebuilt example, deploy it, and trace
        it. You need an Anypoint account with an organization you can publish to.
      </P>
      <Steps>
        <Step n={1} title="Sign in and pick a business group">
          <P>
            Sign in with your Anypoint credentials, then choose a <strong>business group</strong> in the left
            sidebar. Nothing unlocks until you do — it&apos;s the scope for everything that follows.
          </P>
        </Step>
        <Step n={2} title="Open the Vogue Premiere example in Builder">
          <P>
            In <XLink to="builder" anchor="start">Builder</XLink>, choose <strong>Open prebuilt template</strong>.
            It loads a complete, 20-node Style Concierge broker that exercises all seven node kinds — a
            genuinely good teaching artifact. Explore the graph; click nodes to read their playbooks.
          </P>
        </Step>
        <Step n={3} title="Publish & Deploy it">
          <P>
            Open <XLink to="build-publish" anchor="run">Build &amp; Publish</XLink>, load your current Builder
            project, pick an environment and a gateway, fill in any secret variables (your OpenAI key), and
            hit <strong>Publish &amp; Deploy</strong>. Watch the CLI stream its work.
          </P>
        </Step>
        <Step n={4} title="Trace it live in Tracer">
          <P>
            Back in <XLink to="tracer" anchor="overview">Tracer</XLink>, select the environment and your new
            broker, then use the <strong>Invoke</strong> rail to send it a message. The graph lights up
            node-by-node; open a task to read exactly what the LLM decided and why.
          </P>
        </Step>
      </Steps>
      <Callout tone="info">
        No org to deploy into yet? You can still explore Builder end-to-end (it never touches the platform)
        and read every page here. MuleSoft offers a free 30-day trial if you need one.
      </Callout>

      <Shot
        src="/images/help/landing-three-tools.png"
        alt="Agent Network Studio landing page with the three tools"
        route="/"
        state="Signed-out landing page showing Tracer, Builder, and Build & Publish"
        caption="The studio landing page — your three tools, one sign-in."
      />

      <H2 id="prerequisites">What you need</H2>
      <UL>
        <LI>
          <strong>An Anypoint Platform account.</strong> The studio signs in with a Connected App (OAuth) —
          no separate username/password. Your <em>own</em> Anypoint roles govern what you can publish and
          deploy.
        </LI>
        <LI>
          <strong>A business group you can publish to</strong> for the full deploy loop. Read-only exploration
          (Tracer, Exchange Versions) needs only membership.
        </LI>
        <LI>
          <strong>An LLM credential</strong> (e.g. an OpenAI API key) if you deploy the example — brokers call
          real models at runtime.
        </LI>
        <LI>
          <strong>A Chromium browser</strong> (Chrome/Edge) if you want &quot;Save to folder&quot; in Builder
          or &quot;Choose folder&quot; in Build &amp; Publish. Everything else works in any modern browser.
        </LI>
      </UL>
      <P>
        For the deeper &quot;why do I need <Code>view:monitoring</Code>?&quot; questions and the entitlement
        that unlocks full-fidelity tracing, see the <XLink to="tracer" anchor="entitlement">entitlement</XLink>
        section. Full Anypoint docs live at{" "}
        <Ext href="https://docs.mulesoft.com/agent-network/latest/">docs.mulesoft.com/agent-network</Ext>.
      </P>
    </HelpFrame>
  );
}

function ToolCard({
  href,
  icon,
  name,
  tagline,
  body,
}: {
  href: string;
  icon: React.ReactNode;
  name: string;
  tagline: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-anypoint border border-gray-200 p-4 transition-all hover:border-primary/40 hover:shadow-md"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-anypoint bg-gradient-to-br from-primary/15 to-violet/15 text-primary">
        {icon}
      </div>
      <p className="mt-3 font-semibold text-gray-900">{name}</p>
      <p className="text-xs font-medium text-primary">{tagline}</p>
      <p className="mt-1.5 flex-1 text-sm text-gray-600">{body}</p>
      <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">
        Open guide
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
    </Link>
  );
}
