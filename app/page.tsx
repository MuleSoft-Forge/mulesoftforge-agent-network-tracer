import Image from "next/image";
import { redirect } from "next/navigation";
import ControlPlaneSignIn from "@/components/ControlPlaneSignIn";
import DebugLoggingCard from "@/components/DebugLoggingCard";
import TierRequirementCard from "@/components/TierRequirementCard";
import { getSessionStatus } from "@/lib/session";
import { getTagline } from "@/lib/site-config";

export default async function HomePage() {
  const session = await getSessionStatus();

  if (session.authenticated) {
    redirect("/agent-network");
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="space-y-6 text-center">
        <div className="flex justify-center">
          <Image
            src="/logo.svg"
            alt="Agent Network Tracer"
            width={80}
            height={80}
            className="h-20 w-20"
          />
        </div>
        <h1 className="text-3xl font-semibold text-gray-900">
          Agent Network Tracer
        </h1>
        <p className="text-lg text-gray-600">{getTagline()}</p>
      </div>

      {/* Sign in card - centered */}
      <div className="mt-8 flex justify-center">
        <ControlPlaneSignIn />
      </div>

      {/* Two cards side by side - equal size */}
      <div className="mt-8 flex flex-col gap-6 sm:flex-row sm:justify-center sm:items-stretch">
        <div className="flex-1 max-w-sm">
          <TierRequirementCard />
        </div>
        <div className="flex-1 max-w-sm">
          <DebugLoggingCard />
        </div>
      </div>
    </div>
  );
}
