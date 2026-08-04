import type { Broker } from "@/lib/composer/model";

/** File name (under brokers/) for a broker's .agent file. */
export function brokerFileName(broker: Broker): string {
  return `${broker.name || "broker"}.agent`;
}

/** Yaml brokers map key — identical to broker.name. */
export function brokerKey(broker: Broker): string {
  return broker.name || "broker";
}

/** Indent every line of a block by `spaces`. */
export function indentBlock(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? pad + line : line))
    .join("\n");
}
