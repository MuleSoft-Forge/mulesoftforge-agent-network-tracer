import siteConfig from "@/config/site.json";

const taglines: string[] = siteConfig.taglines ?? [];

/** Returns one tagline at random (for rotation). */
export function getTagline(): string {
  if (taglines.length === 0) return "Visualize your agent network and monitor performance";
  return taglines[Math.floor(Math.random() * taglines.length)]!;
}

/** Returns the first tagline (for stable metadata). */
export function getTaglineForMetadata(): string {
  return taglines[0] ?? "Visualize your agent network and monitor performance";
}
