import { ArrowUpRight, ShieldCheck } from "lucide-react";

/**
 * Sits beside the sign-in card on the landing hero. Pushes the rebuilt
 * MuleSoft 30-day trial — the important nuance is that Omni Gateway
 * entitlements (Scanners, Governance, API Manager) and Agent Fabric's MCP
 * Bridge now ship in the trial by default, so anyone can try them. We tell
 * people to create a NEW login rather than reuse an existing account, since
 * the entitlements come with the fresh trial org.
 */
const TRIAL_SIGNUP_URL = "https://anypoint.mulesoft.com/login/signup?apintent=generic";

export default function TrialCallout() {
  return (
    <div className="w-full max-w-sm text-left">
      <div className="flex flex-col rounded-2xl border border-blue-200/60 bg-gradient-to-br from-blue-50/90 to-white/90 p-6 shadow-xl backdrop-blur-sm transition-all duration-300 hover:shadow-2xl">
        <div className="mb-3 flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-sky-500 text-white shadow-md">
            <ShieldCheck className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">
              New · 30-day trial
            </p>
            <h3 className="text-base font-bold text-gray-900">
              Everyone can play with Omni &amp; Agent Fabric
            </h3>
          </div>
        </div>

        <p className="text-sm leading-relaxed text-gray-700">
          The rebuilt MuleSoft trial (30-day) now includes Omni Gateway entitlements out of the box —{" "}
          <strong className="font-semibold text-gray-900">
            API Scanners, API Governance &amp; API Manager
          </strong>{" "}
          — plus Agent Fabric&apos;s{" "}
          <strong className="font-semibold text-gray-900">MCP Bridge via Omni Gateway</strong>.
        </p>

        <p className="mt-3 text-sm font-medium text-gray-800">
          No excuses not to upskill as a Muley.
        </p>

        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Create a <strong>brand-new</strong> login for the trial — don&apos;t reuse your existing
          account.
        </div>

        <a
          href={TRIAL_SIGNUP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center justify-center gap-2 rounded-anypoint-button bg-gradient-to-r from-blue-600 to-sky-500 px-6 py-3 text-sm font-medium text-white shadow-lg transition-all duration-200 hover:scale-[1.02] hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Start your free MuleSoft trial
          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
