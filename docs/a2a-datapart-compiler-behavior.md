# `a2a.dataPart` — compiler sugar vs runtime signature

Why `a2a.dataPart({ firstname: ..., lastname: ... })` fails at deploy/runtime with:

```text
TypeError: _a2a_data_part() got an unexpected keyword argument 'firstname'
```

Applies to Agent Fabric / Agent Network broker agents compiled by the AgentFabric compiler (e.g. `ai_center_guest_onboard_broker`).

> **Disclaimer:** This document summarizes observed compiler and runtime behavior.
> It is not official MuleSoft product documentation and may become outdated as
> Agent Fabric evolves.

---

## Summary

| Layer | Behavior |
|---|---|
| **AgentScript docs** | Show sugar: `a2a.dataPart({ employeeId: "E123", department: "Engineering" })` — reads as “dict keys are the data payload” |
| **AgentFabric compiler** | Expands a single dict literal in `a2a.*()` calls into **keyword arguments** |
| **Python runtime** | `_a2a_data_part(data, media_type=None, metadata=None)` — only accepts `data`, not arbitrary field names as kwargs |

For `a2a.message({ parts: [...] })` and `a2a.filePart({ url: ..., name: ... })`, dict keys match real function parameters, so sugar works. For `a2a.dataPart`, payload fields (`firstname`, `lastname`, etc.) are **not** function parameters — they must be nested under `data`.

---

## Failing pattern

```agentscript
a2a.dataPart({
  firstname: @orchestrator.guestCheckIn.output.first_name,
  lastname: @orchestrator.guestCheckIn.output.last_name,
  company: @orchestrator.guestCheckIn.output.company_name,
  email: @orchestrator.guestCheckIn.output.email
})
```

### What the compiler emits

The AgentFabric compiler treats any `a2a.*()` call with a **single dict literal** argument as kwargs sugar. Illustrative behavior (reconstructed, not copied from product source):

```typescript
if (
  isA2aNamespaceCall(expr) &&
  expr.args.length === 1 &&
  expr.args[0] instanceof DictLiteral
) {
  const dict = expr.args[0];
  const kwargs = dict.entries
    .map(e => `${compileKey}=${compileValue}`)
    .join(', ');
  return `${func}(${kwargs})`;
}
```

So the expression above compiles roughly to:

```python
a2a_dataPart(
  firstname=...,
  lastname=...,
  company=...,
  email=...
)
```

The safe expression evaluator rejects plain dict positional args for these calls; keyword form is intentional in compiled broker graphs.

### What the runtime accepts

The Agent Graph Python runtime exposes `_a2a_data_part` with this shape:

```python
def _a2a_data_part(
    data: dict,
    media_type: str | None = None,
    metadata: dict | None = None,
) -> Part:
```

`firstname` is not a valid parameter → `TypeError: unexpected keyword argument 'firstname'`.

Runtime unit tests use explicit `data=`:

```python
_a2a_data_part(data={"employeeId": "E123", "department": "Engineering"})
```

---

## Why other `a2a.*()` calls work with the same sugar

| Call | Dict keys in sugar | Match runtime params? |
|---|---|---|
| `a2a.message({ messageId: uuid(), parts: [...] })` | `messageId`, `parts`, … | Yes |
| `a2a.filePart({ url: "...", name: "...", media_type: "..." })` | `url`, `name`, `media_type`, … | Yes |
| `a2a.artifact({ name: "...", parts: [...] })` | `name`, `parts`, … | Yes |
| `a2a.dataPart({ firstname: "...", lastname: "..." })` | `firstname`, `lastname`, … | **No** — payload fields, not API params |

---

## Workarounds

### Option 1 — Wrap payload under `data` (recommended)

```agentscript
a2a.dataPart({
  data: {
    firstname: @orchestrator.guestCheckIn.output.first_name,
    lastname: @orchestrator.guestCheckIn.output.last_name,
    company: @orchestrator.guestCheckIn.output.company_name,
    email: @orchestrator.guestCheckIn.output.email
  }
})
```

Compiles to `a2a_dataPart(data={ ... })`, which matches the runtime signature.

### Option 2 — Pass a dict expression directly

If the orchestrator output is already a dict with the right fields:

```agentscript
a2a.dataPart(@orchestrator.guestCheckIn.output)
```

With a non-dict sole argument, the dict→kwargs sugar is **not** applied; the expression is passed as a positional `data` argument.

### Optional — `media_type` / `metadata`

```agentscript
a2a.dataPart({
  data: { firstname: "Ada", lastname: "Lovelace" },
  media_type: "application/json",
  metadata: { schema: "guest-v1" }
})
```

---

## Root cause (platform)

Documented sugar for `a2a.dataPart` implies dict keys are **data fields**. The compiler instead maps dict keys to **function keyword names**. That is correct for `a2a.message` / `a2a.filePart` / `a2a.artifact`, but wrong for `a2a.dataPart` unless the sole key is `data`.

Possible platform fixes (not in this repo):

1. Compiler special-case: for `a2a.dataPart({ ... })`, wrap unknown keys as `data={...}` instead of spreading as kwargs.
2. Runtime wrapper: accept arbitrary kwargs and treat them as the `data` dict (backward-compatible but blurrier API).
3. Docs: clarify that `a2a.dataPart` sugar requires an explicit `data` key (or a single dict expression).

---

## Further reading

| Source | Relevance |
|---|---|
| AgentFabric compiler | Dict literal → kwargs for `a2a.*()` calls |
| Agent Graph Python runtime | `_a2a_data_part` signature and builder tests |
| `agent-fabric-specification` AgentScript dialect docs | Documents sugar syntax (can mislead for `dataPart`) |

---

## Example error (deploy/runtime)

```text
INTERNAL_ERROR: Unrecognized exception type.
Original: TypeError: _a2a_data_part() got an unexpected keyword argument 'firstname'
agent_id=ai_center_guest_onboard_broker
```

Fix: use `{ data: { ... } }` or pass `@orchestrator.<node>.output` as a single dict expression.
