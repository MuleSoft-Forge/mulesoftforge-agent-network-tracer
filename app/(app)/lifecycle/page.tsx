import AgentNetworkLifecyclePanel from "@/components/desktop/AgentNetworkLifecyclePanel";
import LifecycleContextSidebar from "@/components/desktop/LifecycleContextSidebar";

export const metadata = {
  title: "Build & Publish",
};

export default function LifecyclePage() {
  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <LifecycleContextSidebar />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <header className="mb-8">
            <h1 className="text-2xl font-semibold text-gray-900">Build &amp; Publish</h1>
            <p className="mt-1 max-w-3xl text-sm text-gray-600">
              Run publish and deploy through your configured lifecycle worker backend. This page loads project
              files and streams CLI execution from the worker.
            </p>
          </header>
          <AgentNetworkLifecyclePanel />
        </div>
      </div>
    </div>
  );
}
