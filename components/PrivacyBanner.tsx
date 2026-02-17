import { Shield, ExternalLink } from "lucide-react";

export default function PrivacyBanner() {
  return (
    <div className="w-full rounded-lg border border-indigo-200 bg-indigo-50 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-100">
          <Shield className="h-4 w-4 text-indigo-600" />
        </div>
        <div className="flex-1 space-y-2">
          <h3 className="text-sm font-semibold text-indigo-900">
            Privacy Notice
          </h3>
          <p className="text-sm text-indigo-800">
            This application processes all data client-side and does not log or store any information on the server. Historical activity cannot be investigated or retrieved.
          </p>
          <div className="rounded-md bg-white border border-indigo-200 p-2.5">
            <p className="text-xs text-indigo-800">
              <strong>Exception:</strong> Connected app registration as an external user is logged by Anypoint Platform.{" "}
              <a
                href="https://docs.mulesoft.com/access-management/connected-apps-end-users"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-indigo-700 hover:text-indigo-900 hover:underline"
              >
                See Anypoint documentation
                <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
