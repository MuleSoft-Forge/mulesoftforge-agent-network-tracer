import type { Metadata } from "next";
import HelpSidebar from "@/components/help/HelpSidebar";

export const metadata: Metadata = {
  title: "Help · Agent Network Studio",
  description:
    "Guides for MuleSoft developers new to Agent Networks — concepts, and how to use Tracer, Builder, and Build & Publish.",
};

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 lg:px-6">
      <div className="lg:flex lg:gap-8">
        <aside className="mb-6 shrink-0 lg:mb-0 lg:w-56">
          <div className="sticky top-20">
            <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Help centre
            </p>
            <HelpSidebar />
          </div>
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
