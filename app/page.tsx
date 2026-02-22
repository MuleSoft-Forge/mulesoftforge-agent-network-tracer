import Image from "next/image";
import { redirect } from "next/navigation";
import ControlPlaneSignIn from "@/components/ControlPlaneSignIn";
import FeatureCard from "@/components/FeatureCard";
import { getSessionStatus } from "@/lib/session";
import { getTagline } from "@/lib/site-config";

export default async function HomePage() {
  const session = await getSessionStatus();

  if (session.authenticated) {
    redirect("/agent-network");
  }

  const features = [
    {
      iconName: "Network",
      title: "Network Visualization",
      description: "See your entire agent broker network at a glance. Visualize connections between brokers, agents, MCPs, and LLMs in an interactive diagram.",
      color: "from-blue-500 to-blue-600",
      showScreenshot: true, // First card shows screenshot
    },
    {
      iconName: "GitBranch",
      title: "Task Tracing",
      description: "Trace end-to-end task execution across your agent network. Follow requests from inbound through iterations, tool calls, and downstream agents.",
      color: "from-purple-500 to-purple-600",
    },
    {
      iconName: "Brain",
      title: "LLM Reasoning",
      description: "Peek inside the LLM's decision-making process. See tool selection, reasoning steps, and how agents orchestrate complex workflows.",
      color: "from-green-500 to-green-600",
    },
    {
      iconName: "Zap",
      title: "Real-Time Monitoring",
      description: "Monitor task execution in real-time. Track iterations, durations, and agent interactions as they happen across your network.",
      color: "from-orange-500 to-orange-600",
    },
    {
      iconName: "Eye",
      title: "Deep Visibility",
      description: "Dive into detailed logs, trace spans, and API status for every task. Understand exactly what happened and why.",
      color: "from-indigo-500 to-indigo-600",
    },
    {
      iconName: "BarChart3",
      title: "Performance Insights",
      description: "Analyze task durations, iteration counts, and agent performance. Identify bottlenecks and optimize your agent workflows.",
      color: "from-pink-500 to-pink-600",
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      {/* Hero Section */}
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <div className="relative">
              <Image
                src="/logo.svg"
                alt="Agent Network Tracer"
                width={100}
                height={100}
                className="h-24 w-24 drop-shadow-lg"
              />
              <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full blur opacity-20 animate-pulse"></div>
            </div>
          </div>
          
          <h1 className="text-5xl font-bold text-gray-900 sm:text-6xl lg:text-7xl mb-6">
            Agent Network Tracer
          </h1>
          
          <p className="text-xl text-gray-600 sm:text-2xl mb-8 max-w-3xl mx-auto">
            {getTagline()}
          </p>

          {/* Sign in CTA */}
          <div className="flex justify-center mb-16">
            <ControlPlaneSignIn />
          </div>
        </div>

        {/* Feature Cards Grid */}
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3 mt-20">
          {features.map((feature, index) => (
            <FeatureCard
              key={index}
              iconName={feature.iconName}
              title={feature.title}
              description={feature.description}
              color={feature.color}
              showScreenshot={feature.showScreenshot}
            />
          ))}
        </div>

        {/* Bottom CTA */}
        <div className="mt-20 text-center">
          <div className="inline-block rounded-2xl bg-gradient-to-r from-blue-500 to-purple-500 p-1 shadow-xl">
            <div className="rounded-xl bg-white px-8 py-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                Ready to explore your agent network?
              </h2>
              <p className="text-gray-600 mb-6">
                Sign in with your Anypoint Platform credentials to get started.
              </p>
              <ControlPlaneSignIn />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
