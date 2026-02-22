"use client";

import { Network, GitBranch, Brain, Zap, Eye, BarChart3, LucideIcon } from "lucide-react";
import { useState } from "react";
import ScreenshotModal from "./ScreenshotModal";

const iconMap: Record<string, LucideIcon> = {
  Network,
  GitBranch,
  Brain,
  Zap,
  Eye,
  BarChart3,
};

interface FeatureCardProps {
  iconName: string;
  title: string;
  description: string;
  color: string;
  showScreenshot?: boolean;
}

export default function FeatureCard({
  iconName,
  title,
  description,
  color,
  showScreenshot = false,
}: FeatureCardProps) {
  const Icon = iconMap[iconName] || Network;
  const [isModalOpen, setIsModalOpen] = useState(false);

  const cardContent = (
    <>
      {/* Gradient background on hover */}
      <div
        className={`absolute inset-0 bg-gradient-to-br ${color} opacity-0 group-hover:opacity-5 transition-opacity duration-300`}
      ></div>

      {/* Icon */}
      <div
        className={`inline-flex items-center justify-center w-14 h-14 rounded-xl bg-gradient-to-br ${color} text-white mb-4 shadow-lg`}
      >
        <Icon className="h-7 w-7" />
      </div>

      {/* Content */}
      <h3 className="text-xl font-semibold text-gray-900 mb-3">{title}</h3>
      <p className="text-gray-600 leading-relaxed">{description}</p>

      {/* Decorative corner */}
      <div
        className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${color} opacity-0 group-hover:opacity-5 rounded-bl-full transition-opacity duration-300`}
      ></div>

      {/* Click hint for screenshot card */}
      {showScreenshot && (
        <div className="mt-4 text-sm text-gray-500 font-medium group-hover:text-gray-700 transition-colors">
          Click to see it in action →
        </div>
      )}
    </>
  );

  if (showScreenshot) {
    return (
      <>
        <button
          onClick={() => setIsModalOpen(true)}
          className="group relative overflow-hidden rounded-2xl bg-white p-8 shadow-lg transition-all duration-300 hover:shadow-2xl hover:-translate-y-1 border border-gray-100 text-left w-full cursor-pointer"
        >
          {cardContent}
        </button>
        <ScreenshotModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
      </>
    );
  }

  return (
    <div className="group relative overflow-hidden rounded-2xl bg-white p-8 shadow-lg transition-all duration-300 hover:shadow-2xl hover:-translate-y-1 border border-gray-100">
      {cardContent}
    </div>
  );
}
