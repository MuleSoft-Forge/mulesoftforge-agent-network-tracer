export default function PrivacyPolicyContent() {
  return (
    <div className="space-y-8 text-gray-700">
      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">
          1. The &quot;Stateless&quot; Philosophy
        </h2>
        <p>
          The Agent Network Tracer (&quot;the App&quot;) is designed to be a &quot;Zero-Persistence&quot; tool.
          This means that I do not want, and do not have access to, your data. The App functions as
          a client-side interface that exists only while your browser tab is open.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">2. Information We Do Not Collect</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            <strong>No Databases:</strong> I do not maintain a database. Your user profile, Anypoint
            Organization IDs, and environment configurations are never saved to a persistent storage
            layer.
          </li>
          <li>
            <strong>No PII Logging:</strong> The backend (hosted on Vercel) is configured to
            facilitate API communication (CORS proxying) but does not log the body of your requests,
            your email, or your Anypoint data.
          </li>
          <li>
            <strong>No Analytics:</strong> I do not use third-party tracking cookies, behavioral
            analytics, or &quot;phone-home&quot; telemetry that identifies you or your organization.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">3. How Your Data is Handled</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Authentication:</strong> You authenticate directly via the official MuleSoft
            Anypoint Platform login screen. The App uses the OAuth 2.0 Authorization Code Flow.
          </li>
          <li>
            <strong>Access Tokens:</strong> Your access token is stored only in your browser&apos;s
            session storage. I (the developer) never see, store, or have access to this token on any
            server.
          </li>
          <li>
            <strong>In-Memory Processing:</strong> All retrieved data (brokers, tasks, and traces) is
            stored in your browser&apos;s local memory. This data is destroyed immediately when the
            tab is closed or the cache is cleared.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">
          4. Employee Disclaimer & Limitation of Liability
        </h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Personal Capacity:</strong> I am currently an employee of MuleSoft/Salesforce.
            However, this App is a personal, unofficial project and is not a product of MuleSoft or
            Salesforce.
          </li>
          <li>
            <strong>No Warranty:</strong> This tool is provided &quot;as-is&quot; without any warranties. I
            am not responsible for any downtime, API rate-limiting issues, or inaccuracies in the
            data displayed.
          </li>
          <li>
            <strong>No Official Support:</strong> This project is not supported by MuleSoft Global
            Support. Do not open support cases regarding this tool.
          </li>
          <li>
            <strong>User Responsibility:</strong> You are responsible for ensuring that using a
            third-party visualization tool complies with your company&apos;s internal security and data
            governance policies.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">5. Third-Party Infrastructure</h2>
        <p>
          The App is hosted on Vercel. Vercel may collect standard, anonymized web server logs
          (such as IP addresses and timestamps) for security and DDoS prevention purposes, governed
          by the Vercel Privacy Policy.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">6. Contact Information</h2>
        <p>
          For bug reports or questions regarding this policy, please reach out to me via my
          professional profile. Please do not use official MuleSoft/Salesforce internal channels.
        </p>
        <p className="mt-2">
          LinkedIn:{" "}
          <a
            href="https://www.linkedin.com/in/georgejeffcock"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 rounded"
          >
            https://www.linkedin.com/in/georgejeffcock
          </a>
        </p>
      </section>
    </div>
  );
}
