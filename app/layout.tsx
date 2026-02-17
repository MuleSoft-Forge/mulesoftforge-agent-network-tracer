import type { Metadata } from "next";
import "./globals.css";
import { getTaglineForMetadata } from "@/lib/site-config";
import Header from "@/components/Header";
import { DebugViewerProvider } from "@/components/debug/useDebugViewer";

export const metadata: Metadata = {
  title: "Agent Network Tracer",
  description: getTaglineForMetadata(),
  icons: { icon: "/logo.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
        <DebugViewerProvider>
          <Header />
          <div className="flex min-h-0 flex-1 flex-col overflow-auto">
            {children}
          </div>
        </DebugViewerProvider>
      </body>
    </html>
  );
}
