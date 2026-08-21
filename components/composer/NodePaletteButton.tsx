"use client";

import HelpTip from "@/components/composer/HelpTip";
import { MuleIcon } from "@/components/composer/MuleIcon";
import { accentForKind } from "@/components/composer/graph/kind-accent";
import { helpForNodeKind } from "@/lib/composer/help/help-catalog";
import { useHelpMode } from "@/lib/composer/help/help-mode";
import type { GraphNodeKind } from "@/lib/composer/model";

export default function NodePaletteButton({
  kind,
  onAdd,
}: {
  kind: GraphNodeKind;
  onAdd: () => void;
}) {
  const { helpMode } = useHelpMode();
  const help = helpForNodeKind(kind);
  const accent = accentForKind(kind);

  return (
    <div className="flex flex-col">
      <div className="relative">
        <button
          type="button"
          onClick={onAdd}
          title={help.tagline}
          className="flex w-[4.75rem] flex-col items-center gap-1 rounded-anypoint border border-composer-border bg-composer-surface p-2 transition-anypoint hover:border-primary/30 hover:bg-primary/5 hover:shadow-sm"
        >
          <div
            className="flex h-9 w-9 items-center justify-center rounded-anypoint"
            style={{ backgroundColor: `${accent}1a` }}
          >
            <MuleIcon kind={kind} size={18} />
          </div>
          <span className="text-xs font-medium capitalize text-composer-label">{kind}</span>
        </button>
        <div className="absolute -right-0.5 -top-0.5">
          <HelpTip entry={help} align="left" stopPropagation label={`About the ${help.title} node`} />
        </div>
      </div>
      {helpMode ? (
        <p className="mt-1 max-w-[4.75rem] px-0.5 text-xs leading-snug text-primary/80">{help.tagline}</p>
      ) : null}
    </div>
  );
}
