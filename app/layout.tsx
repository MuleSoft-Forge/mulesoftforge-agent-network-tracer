import type { Metadata } from "next";
import "./globals.css";
import { getTaglineForMetadata } from "@/lib/site-config";
import Header from "@/components/Header";
import { DebugViewerProvider } from "@/components/debug/useDebugViewer";

export const metadata: Metadata = {
  title: "Agent Network Studio",
  description: getTaglineForMetadata(),
  icons: { icon: "/ant-logo-landing.png" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-br from-gray-50 via-white to-gray-50">
        <DebugViewerProvider>
          <Header />
          <div className="flex min-h-0 flex-1 flex-col overflow-auto">
            {children}
          </div>
          <footer className="shrink-0 border-t border-gray-200/70 bg-white/80 px-3 py-1 text-center text-[11px] text-gray-500 backdrop-blur">
            Open sourced at{" "}
            <a
              href="https://github.com/MuleSoft-Forge/mulesoftforge-agent-network-tracer"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary hover:underline"
            >
              MuleSoft Forge
            </a>
          </footer>
        </DebugViewerProvider>
      </body>
    </html>
  );
}
