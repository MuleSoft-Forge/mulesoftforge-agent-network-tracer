import { Suspense } from "react";
import MainContent from "@/components/MainContent";

export default function AgentNetworkPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-gray-500">Loading…</div>}>
      <MainContent />
    </Suspense>
  );
}
