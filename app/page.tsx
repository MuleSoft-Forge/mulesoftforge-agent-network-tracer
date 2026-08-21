import { redirect } from "next/navigation";
import ControlPlaneSignIn from "@/components/ControlPlaneSignIn";
import FeatureCard from "@/components/FeatureCard";
import ProductSpotlight from "@/components/landing/ProductSpotlight";
import { SUITE_PRODUCTS, TRACER_HIGHLIGHTS } from "@/components/landing/products";
import SuiteHero from "@/components/landing/SuiteHero";
import { getSessionStatus } from "@/lib/session";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { getTagline } from "@/lib/site-config";
import { getSignInRegionIds, getDefaultRegionId, getConfiguredRegionIds } from "@/lib/regions";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const session = await getSessionStatus();
  const params = await searchParams;

  if (session.authenticated) {
    redirect(safeRedirectPath(params.redirect));
  }

  const configuredRegions = getSignInRegionIds();
  const defaultRegion = getDefaultRegionId();
  const oauthRegions = getConfiguredRegionIds();
  const redirectPath = params.redirect ? safeRedirectPath(params.redirect) : undefined;

  return (
    <div className="relative min-h-screen">
      <div className="pointer-events-none fixed inset-0 mesh-gradient animate-gradient" />
      <div className="pointer-events-none fixed top-20 left-10 h-72 w-72 animate-pulse-glow rounded-full bg-gradient-to-r from-blue-400/20 to-purple-400/20 blur-3xl" />
      <div
        className="pointer-events-none fixed bottom-20 right-10 h-96 w-96 animate-pulse-glow rounded-full bg-gradient-to-r from-teal-400/20 to-indigo-400/20 blur-3xl"
        style={{ animationDelay: "1s" }}
      />
      <div
        className="pointer-events-none fixed top-1/2 left-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 animate-pulse-glow rounded-full bg-gradient-to-r from-violet-400/10 to-pink-400/10 blur-3xl"
        style={{ animationDelay: "2s" }}
      />

      <div className="relative z-10">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <SuiteHero
            tagline={getTagline()}
            defaultRegion={defaultRegion}
            configuredRegions={configuredRegions}
            oauthRegions={oauthRegions}
            redirectPath={redirectPath}
          />

          <section aria-labelledby="suite-products-heading" className="mt-20">
            <div className="mb-10 text-center">
              <h2 id="suite-products-heading" className="text-2xl font-bold text-gray-900 sm:text-3xl">
                Four tools, one studio
              </h2>
              <p className="mx-auto mt-3 max-w-2xl text-gray-600">
                Pick the tool you need — sign in once with Anypoint Platform and jump straight in.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {SUITE_PRODUCTS.map((product) => (
                <ProductSpotlight key={product.id} product={product} />
              ))}
            </div>
          </section>

          <section aria-labelledby="tracer-highlights-heading" className="mt-24">
            <div className="mb-10 text-center">
              <h2 id="tracer-highlights-heading" className="text-xl font-semibold text-gray-900">
                Tracer highlights
              </h2>
              <p className="mt-2 text-sm text-gray-500">Deep visibility when you need to debug live broker activity.</p>
            </div>
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
              {TRACER_HIGHLIGHTS.map((feature, index) => (
                <div
                  key={feature.title}
                  className="animate-fade-in-up opacity-0"
                  style={{ animationDelay: `${index * 100}ms` }}
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
          </section>

          <div className="mb-24 mt-24 text-center">
            <div className="inline-block transform transition-all duration-300 hover:scale-105">
              <div className="relative animate-gradient rounded-3xl bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 p-[2px] shadow-2xl">
                <div className="rounded-3xl border border-white/20 bg-white/95 px-10 py-8 backdrop-blur-sm">
                  <h2 className="mb-3 bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-3xl font-bold text-transparent">
                    Ready to open the studio?
                  </h2>
                  <p className="mb-8 text-lg text-gray-600">
                    Sign in with your Anypoint Platform credentials to use Tracer, Builder, Exchange, and LLM Proxy.
                  </p>
                  <div className="flex justify-center">
                    <ControlPlaneSignIn
                      defaultRegion={defaultRegion}
                      configuredRegions={configuredRegions}
                      oauthRegions={oauthRegions}
                      redirectPath={redirectPath}
                    />
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
