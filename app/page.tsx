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
    <div className="min-h-screen relative">
      {/* Animated background with mesh gradient */}
      <div className="fixed inset-0 mesh-gradient animate-gradient pointer-events-none"></div>
      
      {/* Animated orbs for visual interest */}
      <div className="fixed top-20 left-10 w-72 h-72 bg-gradient-to-r from-blue-400/20 to-purple-400/20 rounded-full blur-3xl animate-pulse-glow pointer-events-none"></div>
      <div className="fixed bottom-20 right-10 w-96 h-96 bg-gradient-to-r from-teal-400/20 to-indigo-400/20 rounded-full blur-3xl animate-pulse-glow pointer-events-none" style={{ animationDelay: '1s' }}></div>
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-gradient-to-r from-violet-400/10 to-pink-400/10 rounded-full blur-3xl animate-pulse-glow pointer-events-none" style={{ animationDelay: '2s' }}></div>

      {/* Main content */}
      <div className="relative z-10">
        {/* Hero Section */}
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="text-center">
            <div className="flex justify-center mb-0">
              <div className="relative">
                <Image
                  src="/ant-logo-landing.png"
                  alt="Agent Network Tracer"
                  width={240}
                  height={240}
                  className="h-56 w-56 drop-shadow-lg sm:h-72 sm:w-72"
                />
              </div>
            </div>
            
            <div className="mb-6 -mt-6 overflow-visible">
              <h1 className="text-5xl font-bold bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 bg-clip-text text-transparent sm:text-6xl lg:text-7xl tracking-tight leading-tight inline-block">
                Agent Network Tracer
              </h1>
            </div>
            
            <p className="text-xl text-gray-700 sm:text-2xl mb-12 max-w-3xl mx-auto font-light leading-relaxed">
              {getTagline()}
            </p>

            {/* Sign in CTA */}
            <div className="flex justify-center mb-20">
              <div className="transform transition-all duration-300 hover:scale-105">
                <ControlPlaneSignIn />
              </div>
            </div>
          </div>

          {/* Feature Cards Grid */}
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3 mt-24">
            {features.map((feature, index) => (
              <div
                key={index}
                className="transform transition-all duration-500 animate-fade-in-up opacity-0"
                style={{
                  animationDelay: `${index * 100}ms`,
                }}
              >
                <FeatureCard
                  iconName={feature.iconName}
                  title={feature.title}
                  description={feature.description}
                  color={feature.color}
                  showScreenshot={feature.showScreenshot}
                />
              </div>
            ))}
          </div>

          {/* Bottom CTA */}
          <div className="mt-24 mb-24 text-center">
            <div className="inline-block transform transition-all duration-300 hover:scale-105">
              <div className="relative rounded-3xl bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 p-[2px] shadow-2xl animate-gradient">
                <div className="rounded-3xl bg-white/95 backdrop-blur-sm px-10 py-8 border border-white/20">
                  <h2 className="text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent mb-3">
                    Ready to explore your agent network?
                  </h2>
                  <p className="text-gray-600 mb-8 text-lg">
                    Sign in with your Anypoint Platform credentials to get started.
                  </p>
                  <div className="flex justify-center">
                    <ControlPlaneSignIn />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
