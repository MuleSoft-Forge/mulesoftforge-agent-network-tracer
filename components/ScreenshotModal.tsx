"use client";

import Image from "next/image";
import { X } from "lucide-react";
import { useEffect, useState } from "react";

interface ScreenshotModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ScreenshotModal({ isOpen, onClose }: ScreenshotModalProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      // Trigger fade-in after mount
      setTimeout(() => setIsVisible(true), 10);
    } else {
      document.body.style.overflow = "unset";
      setIsVisible(false);
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm transition-opacity duration-300 ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
      onClick={onClose}
    >
      <div
        className="relative max-w-[95vw] max-h-[95vh] w-full h-full flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/90 hover:bg-white shadow-lg transition-colors group"
          aria-label="Close"
        >
          <X className="h-6 w-6 text-gray-700 group-hover:text-gray-900" />
        </button>

        {/* Screenshot */}
        <div
          className={`relative w-full h-full flex items-center justify-center transition-transform duration-300 ${
            isVisible ? "scale-100" : "scale-95"
          }`}
        >
          <Image
            src="/images/landing-screenshot.png"
            alt="Agent Network Tracer dashboard showing task tracing, agent network flow, and LLM reasoning"
            width={1920}
            height={1080}
            className="max-w-full max-h-full w-auto h-auto object-contain rounded-lg shadow-2xl"
            priority
            sizes="95vw"
          />
        </div>
      </div>
    </div>
  );
}
