export interface LogLine {
  channel: "stdout" | "stderr" | "meta";
  text: string;
}
