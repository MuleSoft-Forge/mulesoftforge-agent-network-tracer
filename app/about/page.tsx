import Image from "next/image";
import Link from "next/link";

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">About</h1>

      {/* LinkedIn embedded post - first entry */}
      <section className="mb-8 flex justify-center">
        <iframe
          src="https://www.linkedin.com/embed/feed/update/urn:li:ugcPost:7429791216717832193"
          height="1214"
          width="504"
          frameBorder="0"
          allowFullScreen
          title="Embedded post"
          className="max-w-full"
        />
      </section>
      
      <div className="space-y-6 text-gray-700">
        <section>
          <h2 className="mb-3 text-xl font-semibold text-gray-900">Agent Network Studio</h2>
          <p className="mb-4">
            Agent Network Studio is a suite of tools for MuleSoft agent networks — observe live
            broker activity, compose new networks, compare Exchange releases, and test Flex Gateway
            LLM Proxy routing.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-gray-900">Tracer</h2>
          <p className="mb-4">
            Tracer provides observability for agent broker networks, helping you visualize,
            trace, and debug A2A task execution and agent interactions in real time.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-gray-900">Builder</h2>
          <p className="mb-4">
            Builder is a visual composer for agent networks. Design broker graphs on the canvas,
            wire Exchange and registry assets, and export AgentScript project files locally.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-gray-900">Exchange Versions</h2>
          <p className="mb-4">
            Compare published agent network releases on Exchange — inspect version diffs, topology
            changes, and asset files between releases.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-gray-900">LLM Proxy</h2>
          <p className="mb-4">
            A Flex Gateway LLM Proxy test harness. Browse deployed proxies, visualize policy routing,
            and send chat requests to validate model routing before production.
          </p>
        </section>

        <section className="rounded-lg border border-gray-200 bg-gray-50 p-6">
          <h2 className="mb-4 text-xl font-semibold text-gray-900">Data access</h2>
          <p className="mb-4">
            Tracer, Exchange Versions, and LLM Proxy are <strong>read-only</strong> — they view and
            analyze data in your Anypoint Platform account without modifying resources. Builder and
            Build &amp; Publish work on local project files; they do not publish to Exchange unless
            you deploy separately.
          </p>
          
          <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
            <h3 className="mb-3 text-lg font-semibold text-blue-900">Permissions Requested</h3>
            <p className="mb-4 text-sm text-blue-800">
              When you authorize this application, you will see a dialog similar to the one shown below.
              All requested permissions are read-only and used solely for viewing and analyzing your agent network data.
            </p>
            
            <div className="mb-4 rounded-lg border border-gray-300 bg-white p-2 shadow-sm">
              <Image
                src="/images/authorize-app-screenshot.png"
                alt="Authorize App dialog showing read-only permissions"
                width={800}
                height={600}
                className="w-full rounded-lg"
                priority
              />
            </div>
            
            <div className="space-y-2 text-sm text-blue-800">
              <p className="font-semibold">The permissions requested include:</p>
              <ul className="ml-4 list-disc space-y-1">
                <li><strong>View Policies</strong> - Read-only access to view API policies</li>
                <li><strong>View APIs Configuration</strong> - Read-only access to view API configurations</li>
                <li><strong>Profile</strong> - Read-only access to your Anypoint profile</li>
                <li><strong>Exchange Viewer</strong> - Read-only access to view and download assets</li>
                <li><strong>Monitoring Viewer</strong> - Read-only access to monitoring data</li>
                <li><strong>Background Access</strong> - Access to your data when you are not logged in (read-only)</li>
              </ul>
            </div>
          </div>

          <div className="rounded-lg border border-green-200 bg-green-50 p-4">
            <h3 className="mb-2 text-lg font-semibold text-green-900">What This Application Does</h3>
            <ul className="ml-4 list-disc space-y-1 text-sm text-green-800">
              <li>Visualizes your agent broker network topology</li>
              <li>Displays task execution traces and logs</li>
              <li>Provides debugging information for agent interactions</li>
            </ul>
          </div>

          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
            <h3 className="mb-2 text-lg font-semibold text-red-900">What This Application Does NOT Do</h3>
            <ul className="ml-4 list-disc space-y-1 text-sm text-red-800">
              <li>Create, modify, or delete any resources</li>
              <li>Change API configurations or policies</li>
              <li>Perform any write operations</li>
            </ul>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-gray-900">Connected Apps</h2>
          <p className="mb-4">
            This application uses Anypoint Platform&apos;s Connected Apps feature to securely access your data
            with read-only permissions. Connected Apps allow you to delegate API access to third-party applications
            using your Anypoint Platform credentials.
          </p>
          <p className="mb-4">
            For more information about Connected Apps and how to manage them, see the{" "}
            <Link
              href="https://docs.mulesoft.com/access-management/connected-apps-end-users"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-600 hover:text-indigo-800 underline"
            >
              Connected Apps for End Users documentation
            </Link>
            .
          </p>
          <p className="text-sm text-gray-600">
            You can manage authorized applications in your profile settings by clicking your profile icon
            and selecting <strong>Profile</strong>. From there, you can view which applications have access
            to your data and revoke access at any time.
          </p>
        </section>

        <section className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <h2 className="mb-3 text-lg font-semibold text-gray-900">Security & Privacy</h2>
          <p className="mb-2 text-sm text-gray-700">
            This application follows security best practices:
          </p>
          <ul className="ml-4 list-disc space-y-1 text-sm text-gray-700">
            <li>All data access is read-only</li>
            <li>No data is stored permanently outside of your Anypoint Platform account</li>
            <li>All API calls use secure OAuth 2.0 authentication</li>
            <li>You can revoke access at any time from your profile settings</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
