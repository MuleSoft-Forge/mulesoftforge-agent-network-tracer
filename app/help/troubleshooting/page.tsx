import HelpFrame from "@/components/help/HelpFrame";
import { H2, Lead, P, UL, LI, Callout, Code, XLink } from "@/components/help/ui";

export default function TroubleshootingPage() {
  return (
    <HelpFrame pageId="troubleshooting">
      <Lead>
        The errors you&apos;ll actually hit, in plain language, with the fix. Build &amp; Publish&apos;s diagnosis
        dialog links straight here — each heading matches a diagnosis rule.
      </Lead>

      <H2 id="entitlement">&quot;Log Search required&quot; / Tracer looks thin</H2>
      <P>
        <strong>Symptom:</strong> an orange banner in Tracer&apos;s task list mentioning Log Search, an Advanced
        package, or Titanium — and fewer tasks than you expect, with no trace spans.
      </P>
      <P>
        <strong>Cause:</strong> full-fidelity tracing needs <strong>Enhanced Log Search</strong> (the Advanced
        package or a Titanium subscription). Without it, Tracer degrades to runtime logs.
      </P>
      <Callout tone="tip" title="Fix">
        Nothing is broken — this is <em>reduced fidelity</em>. You still get tasks and details from runtime
        logs (capped at 1000 lines, no spans). For the full experience, have an org admin add the entitlement.
        See <XLink to="tracer" anchor="entitlement">the entitlement section</XLink>.
      </Callout>

      <H2 id="target-changed-after-initial-deploy">Target locked after first deploy</H2>
      <P>
        <strong>Symptom:</strong> a deploy fails with a wall of &quot;component aborted&quot; / errorCode 3025
        lines, and text like <em>&quot;target cannot be changed after the initial deployment.&quot;</em>
      </P>
      <P>
        <strong>Cause:</strong> Anypoint locks a network&apos;s deployment target after the first successful
        deploy. The 3025 cascade is a symptom; the real cause is a single 400 on the deployment update. This is
        the most common deploy failure.
      </P>
      <Callout tone="tip" title="Fix">
        Deploy back to the <em>original</em> target — or delete the deployment in Runtime Manager and deploy
        fresh to the new gateway/space.
      </Callout>

      <H2 id="broker-unreachable-connections">Broker can&apos;t reach its connections</H2>
      <P>
        <strong>Symptom:</strong> deploy fails with &quot;unreachable connections&quot; or &quot;failed
        connection validation&quot; (sometimes with a 404).
      </P>
      <P>
        <strong>Cause:</strong> at deploy time the broker validates it can reach the endpoints it depends on
        (MCP servers, agents). Runtime Manager holds it pending until the CLI times out.
      </P>
      <Callout tone="tip" title="Fix">
        Deploy the connection&apos;s target <em>first</em> (e.g. the MCP server), check its URL/port/path, and
        make sure the broker and its targets share a gateway/space. A 404 means nothing is served at that
        address.
      </Callout>

      <H2 id="deploy-timed-out">Deploy timed out</H2>
      <P>
        <strong>Symptom:</strong> the deploy step runs to its timeout (5 min default) and is terminated.
      </P>
      <P>
        <strong>Cause:</strong> a deploy rarely hangs at random. Almost always the app was <em>created</em> but
        failed to start, or failed health/connection validation.
      </P>
      <Callout tone="tip" title="Fix">
        Read the <strong>Runtime Manager log</strong> that Build &amp; Publish auto-fetches into the diagnosis
        dialog — it says why the app didn&apos;t go healthy. Raising <Code>LIFECYCLE_DEPLOY_TIMEOUT_MS</Code>
        won&apos;t help if validation is what&apos;s failing.
      </Callout>

      <H2 id="permission-denied">Permission denied</H2>
      <P>
        <strong>Symptom:</strong> a <Code>403</Code> / &quot;forbidden&quot; on publish, deploy, unpublish, or
        undeploy.
      </P>
      <P>
        <strong>Cause:</strong> a role or OAuth scope gap — not a project problem. The CLI runs as you, so your
        own grants govern the action in that business group.
      </P>
      <Callout tone="tip" title="Fix">
        Ask an org admin to grant the role for this action in that org, then use <strong>&quot;Refresh Anypoint
        permissions&quot;</strong> from the header account menu to pick up the new grants.
      </Callout>

      <H2 id="deploy-needs-local-build">No build artifacts (errorCode 3046)</H2>
      <P>
        <strong>Symptom:</strong> deploy fails complaining there are no build artifacts.
      </P>
      <P>
        <strong>Cause:</strong> deploy needs a build&apos;s <Code>target/</Code> output, and it wasn&apos;t
        present — normally the worker chains build in automatically.
      </P>
      <Callout tone="tip" title="Fix">
        Resubmit the deploy (it re-runs build first). If it recurs, the build step itself is failing — check the
        earlier build output in the log.
      </Callout>

      <H2 id="unpublish-active-instances">Can&apos;t unpublish (active instances)</H2>
      <P>
        <strong>Symptom:</strong> unpublish is refused because active API instances exist.
      </P>
      <Callout tone="tip" title="Fix">
        <strong>Undeploy first, then unpublish.</strong> Anypoint won&apos;t erase an Exchange version that still
        has live instances. Expect to revoke any active API contracts during undeploy.
      </Callout>

      <H2 id="unpublish-hard-delete-window">Hard-delete window</H2>
      <P>
        <strong>Symptom:</strong> a hard delete is rejected mentioning a hard-delete restriction.
      </P>
      <P>
        <strong>Cause:</strong> Anypoint only permits hard delete roughly <strong>7 days after asset
        creation</strong>, and an org can disable it entirely.
      </P>
      <Callout tone="tip" title="Fix">
        Wait out the window, or have the org enable hard delete. As a last resort use soft delete — but remember
        it burns the version number <em>permanently</em>. See <XLink to="build-publish" anchor="teardown">teardown</XLink>.
      </Callout>

      <H2 id="cli-flag-rejected">&quot;Converting circular structure to JSON&quot;</H2>
      <P>
        <strong>Symptom:</strong> a cryptic <em>&quot;Converting circular structure to JSON&quot;</em> error.
      </P>
      <P>
        <strong>Cause:</strong> the CLI (oclif) couldn&apos;t serialize its own error object — almost always
        because it was passed a flag the installed plugin version doesn&apos;t support. The real cause never
        reaches the log.
      </P>
      <Callout tone="tip" title="Fix">
        This is a server-side toolchain issue, not something you did. If you self-host, check the CLI/plugin
        versions in <strong>Ops</strong>; otherwise report it — the diagnosis dialog flags it as a rejected flag.
      </Callout>

      <H2 id="empty-tracer">Tracer shows nothing</H2>
      <P>
        <strong>Symptom:</strong> a broker is deployed, but the task list is empty or a task&apos;s Task story /
        LLM reasoning panels are blank.
      </P>
      <P><strong>Causes &amp; fixes:</strong></P>
      <UL>
        <LI><strong>Wrong scope</strong> — confirm business group → environment → broker, and widen the activity period.</LI>
        <LI><strong>Object Store expired</strong> — Task story / reasoning age out (24h default TTL). An old task simply won&apos;t have them anymore.</LI>
        <LI><strong>Monitoring not enabled</strong> — the deployment needs the <Code>INSECURE-LOGGING</Code> category enabled in Runtime Manager for full task visibility.</LI>
        <LI><strong>Entitlement</strong> — see above; without Log Search you see fewer tasks.</LI>
        <LI><strong>Just deployed</strong> — no one has invoked the broker yet, so there are no tasks. Use Tracer&apos;s <XLink to="tracer" anchor="invoke">Invoke</XLink> rail to create one.</LI>
      </UL>

      <H2 id="export-blocked">Builder won&apos;t export</H2>
      <P>
        <strong>Symptom:</strong> &quot;Save to folder&quot; or &quot;Download .zip&quot; throws
        <em>&quot;Project validation failed&quot;</em> or <em>&quot;AgentScript conformance failed&quot;</em>.
      </P>
      <P>
        <strong>Cause:</strong> file exports are hard-gated on zero validation errors <em>and</em> clean
        AgentScript conformance.
      </P>
      <Callout tone="tip" title="Fix">
        Open the <strong>validation strip</strong> and click each blocking issue — it jumps to the exact field.
        Clear them all (the green &quot;Valid&quot; chip), then export. To park a work-in-progress, use
        <strong> Save in browser</strong>, which has no gate. See <XLink to="builder" anchor="save-export">saving &amp; exporting</XLink>.
      </Callout>

      <Callout tone="info">
        Still stuck? Use the <strong>bug button</strong> in the header to send a report with a screenshot.
      </Callout>
    </HelpFrame>
  );
}
