import HelpFrame from "@/components/help/HelpFrame";
import { H2, H3, Lead, P, UL, LI, Callout, Code, Steps, Step, XLink, Shot } from "@/components/help/ui";

export default function BuildPublishPage() {
  return (
    <HelpFrame pageId="build-publish" beta>
      <Lead>
        Build &amp; Publish runs the <strong>real</strong> Anypoint CLI Agent Fabric lifecycle against your own
        Anypoint org — building, publishing to Exchange, deploying, and tearing down — except the CLI runs on a
        hosted worker, not your laptop. It&apos;s the &quot;deploy to CloudHub&quot; step, in the browser.
      </Lead>

      <H2 id="overview">What Build &amp; Publish does</H2>
      <P>
        You hand it an Agent Network project — your current Builder draft, an uploaded <Code>.zip</Code>, or a
        picked folder — and it runs the genuine <Code>anypoint-cli-v4</Code> with the agent-fabric plugin. It
        authenticates <strong>as you</strong> (your signed-in token), so your Anypoint roles govern every
        outcome. Progress streams back live.
      </P>
      <Callout tone="info">
        The CLI runs as your user via your access token — so &quot;can I publish here?&quot; is answered by your
        own Anypoint role grants, exactly as if you ran the CLI yourself.
      </Callout>

      <Shot
        src="/images/help/build-publish-panel.png"
        alt="Build & Publish panel with a loaded project and lifecycle actions"
        route="/lifecycle"
        state="Remote lifecycle enabled: Project card loaded, Deploy options, and the Publish/Deploy tiles"
        caption="The Build & Publish workflow — load a project, set deploy options, then Publish or Deploy."
      />

      <H2 id="pipeline">The pipeline model</H2>
      <P>
        The UI offers <strong>Publish</strong>, <strong>Deploy</strong>, and <strong>Publish &amp; Deploy</strong>,
        plus teardown. There&apos;s no standalone Build button on purpose — publish and deploy each chain a build
        first, because the build artifacts they need live in a fresh workspace that&apos;s deleted after the job:
      </P>
      <UL>
        <LI><strong>Publish</strong> → build → publish assets to Exchange.</LI>
        <LI><strong>Deploy</strong> → build → deploy to your environment and gateway.</LI>
        <LI><strong>Publish &amp; Deploy</strong> → a <em>single</em> deploy job that includes build and any required publish.</LI>
      </UL>
      <Callout tone="warn" title="Publish & Deploy is one job">
        Publish is implicit inside it. Don&apos;t run Publish first and then Publish &amp; Deploy — you&apos;ll
        double-publish. Pick one path.
      </Callout>
      <P>
        Jobs stream over SSE with a live log and a structured Activity view. They <strong>never retry</strong>
        (a failure is final until you resubmit), and logs expire after 24 hours. A Cancel button is always in
        reach; cancelling wins over the exit code.
      </P>

      <H2 id="context">Business group &amp; environment</H2>
      <Callout tone="warn" title="This is the #1 orientation gotcha">
        Business group and environment are <strong>not</strong> fields in the deploy form. They live in the
        <strong> left sidebar</strong> and are inherited (shared with Builder and Tracer). They&apos;re passed to
        the CLI as <Code>--organization</Code> and <Code>--environment</Code>, and gateways are looked up inside
        that business group — so both must match. Nothing enables until both are set.
      </Callout>
      <P>
        The org id is resolved to a name from your profile, and an id you aren&apos;t a member of is rejected
        outright rather than silently falling back to your root org.
      </P>

      <H2 id="load-project">Loading a project</H2>
      <P>Three load paths, in order of preference:</P>
      <Steps>
        <Step n={1} title="Use current Builder project">
          <P>The primary path. Enabled when a non-empty Builder draft exists in this browser session.</P>
        </Step>
        <Step n={2} title="Upload .zip">
          <P>A fallback — a zipped project bundle. A wrapping folder is detected and stripped automatically.</P>
        </Step>
        <Step n={3} title="Choose folder…">
          <P>Chromium-only (File System Access API). Other browsers see only zip upload.</P>
        </Step>
      </Steps>
      <Callout tone="info">
        <Code>exchange.json</Code> must sit at the bundle <strong>root</strong>. A Builder project already
        serializes correctly; for zips/folders the wrapper is handled for you.
      </Callout>

      <H2 id="deploy-target">Deployment target</H2>
      <P>
        The model is <strong>shared space vs private space</strong>, not a CloudHub/RTF toggle:
      </P>
      <UL>
        <LI>
          <strong>Shared space</strong> — pick one <strong>gateway</strong>. The CLI derives the shared space
          itself at deploy time (mirroring Anypoint Code Builder). Shared spaces use the <Code>Cloudhub-</Code>
          prefix in Runtime Manager.
        </LI>
        <LI>
          <strong>Private space</strong> — pick a <strong>private space</strong>, plus an <strong>ingress</strong>
          and <strong>egress</strong> gateway. This maps to a CloudHub 2.0 private space / Runtime Fabric target.
        </LI>
      </UL>
      <P>
        Gateways and spaces are looked up live from Gateway Manager and Runtime Manager for the selected
        environment.
      </P>

      <H2 id="variables">Variables &amp; secrets</H2>
      <P>
        The <strong>Variables</strong> section is derived from your project&apos;s <Code>exchange.json</Code>{" "}
        <Code>metadata.variables</Code>, grouped by key prefix (e.g. <Code>openaiLlm.baseUrl</Code> → group
        <Code>openaiLlm</Code>). Each becomes a <Code>--property name:value</Code> flag. Non-secret values seed
        from their defaults; each group shows a <em>complete</em> or <em>N missing</em> badge.
      </P>
      <Callout tone="warn" title="Secrets are re-entered every session">
        Secret variables (your LLM API key, etc.) are never persisted — you must re-enter them each session.
        Deploy is blocked until every secret has a value. Deploy variables also don&apos;t apply to teardown.
      </Callout>

      <H2 id="run">Publish &amp; Deploy</H2>
      <P>
        With a project loaded and deploy options complete, the action tiles enable. Each tile spells out its
        chained stages, and the blocking reason appears as a tooltip while it&apos;s disabled.
      </P>
      <H3 id="reading-activity">Reading the activity</H3>
      <UL>
        <LI><strong>Activity</strong> view — structured steps: run start, deployment progress (Starting → Waiting → Ready), endpoints, errors, outcome.</LI>
        <LI><strong>CLI output</strong> view — the raw stream, secrets redacted.</LI>
        <LI><strong>Parsed summary</strong> — published assets as <Code>assetId vX.Y.Z</Code> with clickable Exchange links, plus any error codes.</LI>
      </UL>
      <P>
        A healthy publish or deploy finishes in a couple of minutes. Timeouts are generous (build 4m, publish
        6m, deploy 5m, undeploy 15m) — hitting one usually means something is genuinely wedged, not slow.
      </P>

      <H2 id="teardown">Teardown</H2>
      <P>
        A separate, red-bordered card — because these actions remove things and one of them is irreversible.
        Targets are <strong>picker-only</strong> (chosen from live Exchange), so you can&apos;t fat-finger a GAV
        onto the wrong version.
      </P>
      <UL>
        <LI>
          <strong>Undeploy</strong> — stops the running network; the Exchange asset survives, so you can deploy
          again. Requires an environment. Runs a pre-flight check for active API contracts and offers to revoke
          them (Anypoint refuses to remove an instance with an approved contract).
        </LI>
        <LI>
          <strong>Unpublish</strong> — erases the asset version from Exchange. Irreversible.
        </LI>
      </UL>
      <Callout tone="danger" title="Hard vs soft delete is asymmetric">
        <strong>Hard delete</strong> (the default) frees the coordinates so you can republish the same version —
        but Anypoint only permits it ~7 days after asset creation, and an org can disable it. <strong>Soft
        delete</strong> reserves the coordinates <em>permanently</em>: that version number can never be
        republished. Soft is the more dangerous default, which is why it isn&apos;t the default here.
      </Callout>
      <P>
        The right order: <strong>undeploy before unpublish</strong>, and expect to revoke contracts first.
      </P>

      <H2 id="diagnosis">Reading a failure</H2>
      <P>
        When a job fails, a <strong>diagnosis dialog</strong> pops up: a plain-language explanation, error-code
        chips, and a numbered &quot;How to fix&quot; list. On a failed <em>deploy</em>, Build &amp; Publish also
        automatically fetches the deployment&apos;s <strong>Runtime Manager logs</strong> and shows them inline —
        because a deploy rarely hangs at random; the app was usually created but never went healthy.
      </P>
      <Callout tone="tip">
        The diagnosis catalog is the same one documented on the <XLink to="troubleshooting">Troubleshooting</XLink>
        page — every rule there (target locked, unreachable connections, permission denied, timed out, and the
        rest) is what this dialog is matching against.
      </Callout>

      <H2 id="gotchas">Gotchas</H2>
      <UL>
        <LI><strong>There is no Build button</strong> — Publish and Deploy each chain a build.</LI>
        <LI><strong>Business group and environment live in the left sidebar</strong>, not the form.</LI>
        <LI><strong>The deployment target locks after the first successful deploy.</strong> Changing gateway/space later throws a wall of 3025 errors whose real cause is a single 400 — delete the deployment in Runtime Manager first. See <XLink to="troubleshooting" anchor="target-changed-after-initial-deploy">the fix</XLink>.</LI>
        <LI><strong>A deploy timeout rarely means &quot;retry&quot;</strong> — read the auto-fetched RM log.</LI>
        <LI><strong>Brokers must reach their connections at deploy time</strong> — deploy the MCP server (or other endpoint) first, on the same gateway/space.</LI>
        <LI><strong>Secret variables reset every session</strong>; jobs never retry; logs expire after 24h.</LI>
        <LI><strong>&quot;Choose folder…&quot; is Chromium-only.</strong></LI>
        <LI><strong>Ignore the setup landing copy</strong> if you ever see it — when the worker is enabled, your bundle <em>is</em> uploaded to the hosted worker (over your authenticated session); the marketing landing page says otherwise and is stale.</LI>
      </UL>
    </HelpFrame>
  );
}
