type PrivacyPolicyContentProps = {
  /**
   * Supplied by the server-rendered /privacy page from the environment. Omitted
   * in the pre-sign-in modal, which has no server context — the surrounding
   * copy already directs people to the maintainer, and /privacy carries the
   * address.
   */
  contactEmail?: string | null;
};

export default function PrivacyPolicyContent({
  contactEmail,
}: PrivacyPolicyContentProps = {}) {
  return (
    <div className="space-y-8 text-gray-700">
      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">1. What this is</h2>
        <p>
          Agent Network Studio (the &quot;App&quot;) is an unofficial personal project that helps you
          build, publish, deploy, unpublish, and undeploy agent-network assets using your Anypoint
          account. It is not an official MuleSoft or Salesforce product.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">2. Authentication and scopes</h2>
        <p>
          Sign-in uses MuleSoft Anypoint OAuth (Authorization Code Flow) through a Connected App.
          During authorization, Anypoint may display broad or &quot;Full Access&quot;-style consent
          language. This is required for Agent Network Studio lifecycle operations and API compatibility
          across build, publish, and deploy workflows.
        </p>
        <p className="mt-2">
          You should only grant access if your organization approves these permissions for your intended
          use.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">3. Token handling</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            <strong>Connected App credentials:</strong> The server side uses Connected App credentials
            to complete OAuth token exchange and to execute authorized lifecycle calls on your behalf.
          </li>
          <li>
            <strong>Session storage model:</strong> Auth state is stored in a secure, encrypted,
            HTTP-only session cookie for signed-in operation.
          </li>
          <li>
            <strong>No user password collection:</strong> This app does not ask for or store your
            Anypoint account password directly.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">
          4. Build server and processing model
        </h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Shared worker infrastructure:</strong> Lifecycle jobs run on shared build/worker
            infrastructure.
          </li>
          <li>
            <strong>Queue-based execution:</strong> Jobs are executed asynchronously and isolated per
            run using the project job queue model.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">5. Usage logging</h2>
        <p>
          To keep the App running and to help the people using it, the maintainer keeps basic logs of
          activity. This is done to understand usage, diagnose problems, and provide support —{" "}
          <strong>not</strong> to market to you, profile you, or sell your data to anyone.
        </p>
        <ul className="mt-2 list-disc space-y-2 pl-6">
          <li>
            <strong>Sign-in records:</strong> When you sign in, we record who signed in — your Anypoint
            identity (such as username or email and organization) and when — so we can gauge how the App
            is used and assist you if you ask for help.
          </li>
          <li>
            <strong>Build server activity:</strong> Lifecycle jobs that run on the build/worker server
            are logged — what ran, when, and whether it succeeded or failed — so runs can be traced and
            issues fixed.
          </li>
        </ul>
        <p className="mt-2">
          These logs are used only to operate and improve the App and to help you. They are never used
          for advertising, marketing, or sale to third parties.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">6. Third-party platforms</h2>
        <p>
          This app depends on third-party infrastructure including MuleSoft Anypoint Platform and is
          hosted on{" "}
          <a
            href="https://fly.io/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 rounded"
          >
            Fly.io
          </a>
          . Their independent terms and privacy policies also apply to your usage.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">
          7. Personal project disclaimer and user responsibility
        </h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Unofficial software:</strong> Provided as-is, without warranty or official support.
          </li>
          <li>
            <strong>Governance responsibility:</strong> You are responsible for ensuring this tool&apos;s
            use complies with your internal security, legal, and data governance requirements.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">8. Contact</h2>
        <p>
          For bug reports or privacy questions about this app, contact the project maintainer
          directly. Do not use official MuleSoft/Salesforce support channels for this unofficial
          project.
        </p>
        {contactEmail ? (
          <p className="mt-2">
            Email:{" "}
            <a
              href={`mailto:${contactEmail}`}
              className="font-medium text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 rounded"
            >
              {contactEmail}
            </a>
          </p>
        ) : null}
      </section>
    </div>
  );
}
