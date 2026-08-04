import AgentNetworkLifecyclePanel from "@/components/desktop/AgentNetworkLifecyclePanel";
import { Clock } from "lucide-react";

export const metadata = {
  title: "Build & Publish",
};

export default function LifecyclePage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div
        role="status"
        className="mb-6 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
      >
        <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
        <div>
          <p className="font-semibold text-amber-900">Coming soon</p>
          <p className="mt-0.5 leading-relaxed text-amber-800/90">
            Build &amp; Publish is in active testing. We&apos;re validating safety, local data handling, and
            the desktop build workflow before a wider release. Preview the flow below — use the desktop app
            from source only if you&apos;re comfortable testing locally.
          </p>
        </div>
      </div>

      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Build &amp; Publish</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">
          Run the Agent Network lifecycle locally with the Anypoint CLI. On the web this page explains
          how to compile the desktop app; in the desktop app you can build, publish, and deploy from your
          project folder.
        </p>
      </header>
      <AgentNetworkLifecyclePanel />
    </div>
  );
}
