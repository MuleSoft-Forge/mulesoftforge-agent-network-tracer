import { notFound } from "next/navigation";
import OpsDashboard from "@/components/ops/OpsDashboard";
import { sessionHasOpsAccess } from "@/lib/ops/guard";

export const metadata = {
  title: "Ops",
};

export const dynamic = "force-dynamic";

export default async function OpsPage() {
  // 404 rather than 403: the page does not exist as far as anyone else is
  // concerned, and the API routes enforce the same rule independently.
  if (!(await sessionHasOpsAccess())) {
    notFound();
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <OpsDashboard />
      </div>
    </div>
  );
}
