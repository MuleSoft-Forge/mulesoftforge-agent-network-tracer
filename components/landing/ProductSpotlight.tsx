"use client";

import Image from "next/image";
import { ArrowRight } from "lucide-react";
import BetaBadge from "@/components/ui/BetaBadge";
import type { SuiteProduct } from "@/components/landing/products";
import { storePostAuthRedirect } from "@/lib/post-auth-redirect";

const MULE_ICON_SRC: Record<"exchange" | "graph" | "llm", string> = {
  exchange: "/icons/mule/exchange-light.svg",
  graph: "/icons/mule/graph_view_icon_light.svg",
  llm: "/icons/mule/llm-icon.svg",
};

function ProductImage({ product }: { product: SuiteProduct }) {
  if (product.image.kind === "mule") {
    return (
      <div className={`flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br ${product.accent} p-3 shadow-lg`}>
        <img src={MULE_ICON_SRC[product.image.icon]} alt="" className="h-full w-full object-contain brightness-0 invert" />
      </div>
    );
  }

  return (
    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-gray-200/80">
      <Image src={product.image.src} alt={product.image.alt} fill className="object-contain p-1.5" sizes="64px" />
    </div>
  );
}

export default function ProductSpotlight({ product }: { product: SuiteProduct }) {
  function handleSignIn() {
    storePostAuthRedirect(product.redirectPath);
    document.getElementById("suite-sign-in")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-3xl border border-gray-200/50 bg-white/80 p-6 shadow-xl backdrop-blur-sm transition-all duration-500 hover:-translate-y-1 hover:border-primary/30 hover:shadow-2xl">
      <div className={`absolute inset-0 bg-gradient-to-br ${product.accent} opacity-0 transition-opacity duration-500 group-hover:opacity-[0.06]`} />
      <div className="relative flex items-start gap-4">
        <ProductImage product={product} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">
            <span className="inline-flex items-center gap-1.5">
              {product.name}
              {product.beta ? <BetaBadge /> : null}
            </span>
          </p>
          <h3 className="mt-1 text-xl font-bold text-gray-900">{product.headline}</h3>
        </div>
      </div>
      <p className="relative mt-4 text-sm leading-relaxed text-gray-600">{product.tagline}</p>
      <ul className="relative mt-4 flex-1 space-y-2 text-sm text-gray-700">
        {product.bullets.map((bullet) => (
          <li key={bullet} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={handleSignIn}
        className="relative mt-6 inline-flex w-full items-center justify-center gap-2 rounded-anypoint-button bg-gradient-to-r from-primary to-purple-600 px-4 py-2.5 text-sm font-medium text-white shadow-md transition-all hover:scale-[1.02] hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
      >
        Sign in to open {product.name}
        <ArrowRight className="h-4 w-4" />
      </button>
    </article>
  );
}
