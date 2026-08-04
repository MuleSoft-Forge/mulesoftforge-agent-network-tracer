import Image from "next/image";
import ControlPlaneSignIn from "@/components/ControlPlaneSignIn";
import type { RegionId } from "@/lib/regions";

export default function SuiteHero({
  tagline,
  defaultRegion,
  configuredRegions,
  oauthRegions,
  redirectPath,
}: {
  tagline: string;
  defaultRegion: RegionId;
  configuredRegions: RegionId[];
  oauthRegions: RegionId[];
  redirectPath?: string;
}) {
  return (
    <div className="text-center">
      <div className="mb-0 flex justify-center">
        <div className="relative">
          <Image
            src="/ant-logo-landing.png"
            alt="Agent Network Studio"
            width={240}
            height={240}
            className="h-48 w-48 drop-shadow-lg sm:h-64 sm:w-64"
            priority
          />
        </div>
      </div>

      <div className="-mt-4 mb-4 overflow-visible">
        <h1 className="inline-block bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 bg-clip-text text-4xl font-bold leading-tight tracking-tight text-transparent sm:text-5xl lg:text-6xl">
          Agent Network Studio
        </h1>
      </div>

      <p className="mx-auto mb-3 max-w-3xl text-lg font-light leading-relaxed text-gray-700 sm:text-xl">
        {tagline}
      </p>
      <p className="mx-auto mb-3 max-w-2xl text-sm text-gray-500 sm:text-base">
        Your studio for agent networks — observe with Tracer, compose with Builder, compare Exchange
        releases, and test LLM Proxy routing.
      </p>
      <p className="mx-auto mb-10 text-xs font-medium uppercase tracking-wider text-gray-400">
        Tracing since February 17, 2026 · Building since August 4, 2026
      </p>

      <div id="suite-sign-in" className="flex scroll-mt-24 justify-center">
        <div className="transform transition-all duration-300 hover:scale-105">
          <ControlPlaneSignIn
            defaultRegion={defaultRegion}
            configuredRegions={configuredRegions}
            oauthRegions={oauthRegions}
            redirectPath={redirectPath}
          />
        </div>
      </div>
    </div>
  );
}
