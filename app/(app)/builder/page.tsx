import ComposerShell from "@/components/composer/ComposerShell";

export const metadata = {
  title: "Agent Network Builder",
};

export default function BuilderPage() {
  return (
    <div className="h-full">
      <ComposerShell />
    </div>
  );
}
