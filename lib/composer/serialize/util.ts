import type { Broker } from "@/lib/composer/model";
import { toIdentifier } from "@/lib/composer/model";

/** kebab-case slug for file names. */
export function kebab(input: string): string {
  return (
    input
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "broker"
  );
}

/** File name (under brokers/) for a broker's .agent file. */
export function brokerFileName(broker: Broker): string {
  return `${kebab(broker.name || "broker")}.agent`;
}

/** Sanitize a broker name for use as an identifier in yaml keys / URIs. */
export function brokerKey(broker: Broker): string {
  return toIdentifier(broker.name || "broker", "broker");
}

/** Indent every line of a block by `spaces`. */
export function indentBlock(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? pad + line : line))
    .join("\n");
}
