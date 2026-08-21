/** A2A TaskState values for echo `status_update_event` nodes (a2a_v1.json). */
export const A2A_TASK_STATES = [
  "TASK_STATE_SUBMITTED",
  "TASK_STATE_WORKING",
  "TASK_STATE_COMPLETED",
  "TASK_STATE_FAILED",
  "TASK_STATE_CANCELED",
  "TASK_STATE_INPUT_REQUIRED",
  "TASK_STATE_REJECTED",
  "TASK_STATE_AUTH_REQUIRED",
] as const;

export type A2aTaskState = (typeof A2A_TASK_STATES)[number];

export const A2A_TASK_STATE_OPTIONS: Array<{ value: A2aTaskState; label: string }> = [
  { value: "TASK_STATE_SUBMITTED", label: "Submitted" },
  { value: "TASK_STATE_WORKING", label: "Working" },
  { value: "TASK_STATE_COMPLETED", label: "Completed" },
  { value: "TASK_STATE_FAILED", label: "Failed" },
  { value: "TASK_STATE_CANCELED", label: "Canceled" },
  { value: "TASK_STATE_INPUT_REQUIRED", label: "Input required" },
  { value: "TASK_STATE_REJECTED", label: "Rejected" },
  { value: "TASK_STATE_AUTH_REQUIRED", label: "Auth required" },
];

export function isA2aTaskState(value: string): value is A2aTaskState {
  return (A2A_TASK_STATES as readonly string[]).includes(value);
}

export function normalizeA2aTaskState(value: string | undefined): A2aTaskState {
  if (value && isA2aTaskState(value)) return value;
  return "TASK_STATE_COMPLETED";
}
