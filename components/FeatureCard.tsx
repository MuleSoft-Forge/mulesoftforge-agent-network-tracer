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
      {/* Animated gradient background */}
      <div
        className={`absolute inset-0 bg-gradient-to-br ${color} opacity-0 group-hover:opacity-10 transition-all duration-500`}
      ></div>
      
      {/* Shimmer effect on hover */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500">
        <div className="shimmer absolute inset-0"></div>
      </div>

      {/* Animated icon container */}
      <div className="relative mb-6">
        <div className={`absolute inset-0 bg-gradient-to-br ${color} opacity-20 blur-xl group-hover:opacity-40 group-hover:blur-2xl transition-all duration-500 rounded-2xl`}></div>
        <div
          className={`relative inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br ${color} text-white shadow-xl group-hover:shadow-2xl group-hover:scale-110 transition-all duration-300`}
        >
          <Icon className="h-8 w-8 group-hover:rotate-12 transition-transform duration-300" />
        </div>
      </div>

      {/* Content */}
      <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-gray-800 transition-colors">{title}</h3>
      <p className="text-gray-600 leading-relaxed group-hover:text-gray-700 transition-colors">{description}</p>

      {/* Decorative elements */}
      <div
        className={`absolute top-0 right-0 w-40 h-40 bg-gradient-to-br ${color} opacity-0 group-hover:opacity-5 rounded-bl-full transition-opacity duration-500`}
      ></div>
      <div
        className={`absolute bottom-0 left-0 w-24 h-24 bg-gradient-to-tr ${color} opacity-0 group-hover:opacity-5 rounded-tr-full transition-opacity duration-500`}
      ></div>
    </>
  );

  if (showScreenshot) {
    return (
      <>
        <button
          onClick={() => setIsModalOpen(true)}
          className="group relative overflow-hidden rounded-3xl bg-white/80 backdrop-blur-sm p-8 shadow-xl transition-all duration-500 hover:shadow-2xl hover:-translate-y-2 border border-gray-200/50 text-left w-full cursor-pointer hover:border-primary/30"
        >
          {cardContent}
        </button>
        <ScreenshotModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
      </>
    );
  }

  return (
    <div className="group relative overflow-hidden rounded-3xl bg-white/80 backdrop-blur-sm p-8 shadow-xl transition-all duration-500 hover:shadow-2xl hover:-translate-y-2 border border-gray-200/50 hover:border-primary/30">
      {cardContent}
    </div>
  );
}
