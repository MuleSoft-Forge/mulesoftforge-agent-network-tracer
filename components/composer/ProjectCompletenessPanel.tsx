"use client";

import CompletenessPanel from "@/components/composer/CompletenessPanel";
import { buildProjectCompleteness } from "@/lib/composer/project-completeness";
import type { ProjectFocusTarget } from "@/lib/composer/project-field-anchors";
import type { ComposerProject } from "@/lib/composer/model";
import { useMemo } from "react";

export default function ProjectCompletenessPanel({
  project,
  onFocus,
}: {
  project: ComposerProject;
  onFocus?: (target: ProjectFocusTarget) => void;
}) {
  const completeness = useMemo(() => buildProjectCompleteness(project), [project]);

  return (
    <CompletenessPanel
      summaryTitle="Project completeness"
      readyLabel="Export-ready"
      title="Spec vs current project"
      subtitle="What each field means, where it lands in export files, and what's still missing"
      completeness={completeness}
      onFocus={onFocus}
      maxHeightClass="max-h-[calc(100vh-280px)]"
    />
  );
}
