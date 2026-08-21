"use client";

interface SpinnerProps {
  size?: "s" | "m" | "l";
  className?: string;
}

export default function Spinner({ size = "m", className = "" }: SpinnerProps) {
  const sizeClasses = {
    s: "h-5 w-5 border-[2px]",
    m: "h-10 w-10 border-[4px]",
    l: "h-20 w-20 border-[8px]",
  };

  return (
    <div
      className={`${sizeClasses[size]} ${className} rounded-full border-t-primary border-l-transparent border-r-transparent border-b-transparent`}
      style={{
        animation: "spin 0.8s linear infinite",
      }}
      role="status"
      aria-label="Loading"
    />
  );
}
