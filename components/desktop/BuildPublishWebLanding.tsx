import Image from "next/image";
import Link from "next/link";
import { Hammer, Lock, Monitor, Rocket, Shield, Upload } from "lucide-react";

const PRIVACY_POINTS = [
  {
    icon: Lock,
    title: "Your project never leaves your machine",
    body: "Build, publish, and deploy run the Anypoint CLI against folders on your disk. We do not upload exchange.json, registry yaml, or AgentScript to Agent Network Studio servers.",
  },
  {
    icon: Shield,
    title: "Credentials stay local",
    body: "Anypoint username/password and CLI output live in the desktop app’s config directory on your Mac or PC — not in a shared cloud workspace.",
  },
  {
    icon: Monitor,
    title: "Why Electron, not the browser",
    body: "Browsers cannot spawn the Anypoint CLI or read arbitrary project folders securely. Electron wraps the same Studio UI you already trust, but adds a native shell that can run lifecycle commands locally.",
  },
] as const;

const LIFECYCLE_STEPS = [
  { icon: Hammer, label: "Build", detail: "Serialize your project into target/" },
  { icon: Upload, label: "Publish", detail: "Push assets to Exchange" },
  { icon: Rocket, label: "Deploy", detail: "Ship to your chosen environment and gateway" },
] as const;

export default function BuildPublishWebLanding() {
  return (
    <div className="flex flex-col gap-10">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Build from source</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
            Build &amp; Publish on your machine
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-gray-600 sm:text-base">
            The full Agent Network lifecycle — build, publish, and deploy — runs through the Anypoint CLI on
            your laptop. Agent Network Studio in the browser shows you what is possible; the{" "}
            <strong className="font-medium text-gray-900">desktop app you compile locally</strong> runs it with
            complete data privacy.
          </p>

          <ul className="mt-6 space-y-3">
            {LIFECYCLE_STEPS.map(({ icon: Icon, label, detail }) => (
              <li key={label} className="flex gap-3 text-sm text-gray-700">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span>
                  <span className="font-semibold text-gray-900">{label}</span>
                  <span className="text-gray-600"> — {detail}</span>
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-8 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 to-violet-500/5 p-4">
            <p className="text-sm font-medium text-gray-900">Compile the desktop app locally</p>
            <p className="mt-1 text-sm text-gray-600">
              Clone this repo, add your Anypoint Connected App credentials to{" "}
              <code className="rounded bg-white/80 px-1 py-0.5 text-xs">.env.local</code>, then run{" "}
              <code className="rounded bg-white/80 px-1 py-0.5 text-xs">
                SESSION_SECRET=$(openssl rand -base64 48) npm run electron:install-local
              </code>
              . You compile what you run — no signed installer required. The same Builder project folder is
              remembered for Build &amp; Publish.
            </p>
            <Link
              href="/about"
              className="mt-3 inline-flex text-sm font-medium text-primary hover:text-primary/80"
            >
              Learn more about data access &amp; privacy →
            </Link>
            <a
              href="https://github.com/MuleSoft-Forge/mulesoftforge-agent-network-tracer/blob/main/BUILD-DESKTOP.md"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 block text-sm font-medium text-primary hover:text-primary/80"
            >
              Full build instructions (BUILD-DESKTOP.md) →
            </a>
          </div>
        </div>

        <figure className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl ring-1 ring-gray-100">
          <Image
            src="/images/build-publish-desktop.png"
            alt="Build and Publish in the Agent Network Studio desktop app — Anypoint CLI detection, project folder, deploy options, and lifecycle actions"
            width={1440}
            height={900}
            className="h-auto w-full"
            priority
          />
          <figcaption className="border-t border-gray-100 bg-gray-50 px-4 py-2.5 text-xs text-gray-500">
            Build &amp; Publish in the desktop app — CLI runs locally; deploy options come from your project&apos;s
            exchange.json.
          </figcaption>
        </figure>
      </div>

      <section aria-labelledby="build-publish-privacy-heading" className="grid gap-4 sm:grid-cols-3">
        <h2 id="build-publish-privacy-heading" className="sr-only">
          Privacy and local processing
        </h2>
        {PRIVACY_POINTS.map(({ icon: Icon, title, body }) => (
          <article key={title} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <Icon className="h-5 w-5 text-primary" aria-hidden />
            <h3 className="mt-3 text-sm font-semibold text-gray-900">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">{body}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
