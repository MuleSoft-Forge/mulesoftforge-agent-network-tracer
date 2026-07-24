"use client";

import { MuleIcon } from "@/components/composer/MuleIcon";
import HelpTip from "@/components/composer/HelpTip";
import { helpForNodeKind } from "@/lib/composer/help/help-catalog";
import { useHelpMode } from "@/lib/composer/help/help-mode";
import type { GraphNodeKind } from "@/lib/composer/model";
import { Button } from "@/components/composer/ui";

export default function NodePaletteButton({
  kind,
  onAdd,
}: {
  kind: GraphNodeKind;
  onAdd: () => void;
}) {
  const { helpMode } = useHelpMode();
  const help = helpForNodeKind(kind);

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-0.5">
        <Button variant="ghost" onClick={onAdd} title={help.tagline} className="!px-2">
          <MuleIcon kind={kind} size={14} />
          {kind}
        </Button>
        <HelpTip entry={help} align="left" stopPropagation label={`About the ${help.title} node`} />
      </div>
      {helpMode ? (
        <p className="max-w-[140px] px-1 text-[9px] leading-snug text-primary/80">{help.tagline}</p>
      ) : null}
    </div>
  );
}
