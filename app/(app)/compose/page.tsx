import ComposerShell from "@/components/composer/ComposerShell";

export const metadata = {
  title: "Agent Network Composer",
};

export default function ComposePage() {
  return (
    <div className="h-full">
      <ComposerShell />
    </div>
  );
}
