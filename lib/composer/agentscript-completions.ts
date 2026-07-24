import type * as Monaco from "monaco-editor";
import {
  createLanguageService,
  getNodeMemberAccessCompletions,
  getValueCompletions,
  getWithCompletions,
  SymbolKind,
  type CompletionCandidate,
  type LanguageService,
} from "@sf-agentscript/language";
import { agentfabricDialect } from "@sf-agentscript/agentfabric-dialect";
import { parseAgentFabricSource } from "@/lib/composer/agentscript-parser";

/**
 * Canned deep A2A-request interpolations the native engine can't synthesize:
 * `request` is a global scope with a flat member bag (no nested type info), so
 * it can't descend into `payload.message.parts[0].text`. Offered at the
 * namespace position (`@` / `@partial`); insertText omits the leading `@`
 * the user already typed.
 */
const CANNED_REQUEST_PATHS: ReadonlyArray<{ path: string; detail: string }> = [
  { path: "request.payload.message.parts[0].text", detail: "First text part of the inbound A2A message" },
  { path: "request.payload.message.parts[0].data", detail: "First data part of the inbound A2A message" },
];

/** Map the dialect's SymbolKind to a Monaco completion item kind. */
function toMonacoKind(monaco: typeof Monaco, kind: SymbolKind): Monaco.languages.CompletionItemKind {
  const K = monaco.languages.CompletionItemKind;
  switch (kind) {
    case SymbolKind.Namespace:
    case SymbolKind.Module:
    case SymbolKind.Package:
      return K.Module;
    case SymbolKind.Class:
    case SymbolKind.Interface:
      return K.Class;
    case SymbolKind.Method:
      return K.Method;
    case SymbolKind.Function:
    case SymbolKind.Constructor:
      return K.Function;
    case SymbolKind.Property:
    case SymbolKind.Field:
    case SymbolKind.Key:
      return K.Field;
    case SymbolKind.Enum:
      return K.Enum;
    case SymbolKind.Variable:
      return K.Variable;
    case SymbolKind.Constant:
    case SymbolKind.String:
    case SymbolKind.Number:
    case SymbolKind.Boolean:
      return K.Constant;
    case SymbolKind.Array:
    case SymbolKind.Object:
      return K.Struct;
    case SymbolKind.File:
      return K.File;
    default:
      return K.Property;
  }
}

function toSuggestion(
  monaco: typeof Monaco,
  candidate: CompletionCandidate,
  range: Monaco.IRange,
  sortIndex: number
): Monaco.languages.CompletionItem {
  const useSnippet = Boolean(candidate.snippet);
  return {
    label: candidate.name,
    kind: toMonacoKind(monaco, candidate.kind),
    detail: candidate.detail,
    documentation: candidate.documentation ? { value: candidate.documentation } : undefined,
    insertText: candidate.snippet ?? candidate.insertText ?? candidate.name,
    insertTextRules: useSnippet
      ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
      : undefined,
    range,
    sortText: String(sortIndex).padStart(5, "0"),
  };
}

let service: LanguageService | null = null;

function getService(): LanguageService {
  if (!service) {
    service = createLanguageService({ dialect: agentfabricDialect });
  }
  return service;
}

/**
 * Matches an in-progress `@`-expression ending at the cursor, e.g. `@`,
 * `@orch`, `@orchestrator.main`, `@orchestrator.main.output.`. Subscripts
 * (`[0]`) terminate the match — identifier segments only.
 */
const AT_EXPRESSION_RE = /@([A-Za-z0-9_]*(?:\.[A-Za-z0-9_]*)*)$/;

function buildAtExpressionSuggestions(
  monaco: typeof Monaco,
  svc: LanguageService,
  expr: string,
  line: number,
  character: number,
  range: Monaco.IRange
): Monaco.languages.CompletionItem[] {
  const parts = expr.split(".");

  if (parts.length === 1) {
    // Namespace position: native namespaces + canned deep request paths.
    const namespaces = svc.getNamespaceCompletions(line, character);
    const suggestions = namespaces.map((c, i) => toSuggestion(monaco, c, range, i));
    CANNED_REQUEST_PATHS.forEach((entry, i) => {
      suggestions.push({
        label: entry.path,
        kind: monaco.languages.CompletionItemKind.Snippet,
        detail: entry.detail,
        insertText: entry.path,
        range,
        sortText: `zz${String(i).padStart(3, "0")}`,
      });
    });
    return suggestions;
  }

  if (parts.length === 2) {
    // `@ns.partial` — entries within the namespace (node names, actions, …).
    const candidates = svc.getCompletions(line, character, parts[0]);
    return candidates.map((c, i) => toSuggestion(monaco, c, range, i));
  }

  // `@ns.node.member…partial` — node member access of arbitrary depth.
  const ast = svc.ast;
  if (!ast) return [];
  const candidates = getNodeMemberAccessCompletions(ast, parts, svc.schemaContext);
  return candidates.map((c, i) => toSuggestion(monaco, c, range, i));
}

function buildContextSuggestions(
  monaco: typeof Monaco,
  svc: LanguageService,
  line: number,
  character: number,
  source: string,
  range: Monaco.IRange
): Monaco.languages.CompletionItem[] {
  const ast = svc.ast;

  // Value position (`key: <cursor>`): enum members, typed-map keywords.
  if (ast) {
    const values = getValueCompletions(ast, line, character, svc.schemaContext, source);
    if (values.length > 0) return values.map((c, i) => toSuggestion(monaco, c, range, i));

    // `with <param>` inside a reasoning binding or run statement.
    const withParams = getWithCompletions(ast, line, character, svc.schemaContext, source);
    if (withParams.length > 0) return withParams.map((c, i) => toSuggestion(monaco, c, range, i));
  }

  // Otherwise offer valid field keys at this nesting level.
  const fields = svc.getFieldCompletions(line, character);
  return fields.map((c, i) => toSuggestion(monaco, c, range, i));
}

/**
 * Register a schema- and AST-aware completion provider backed by the official
 * AgentFabric LanguageService. Returns a disposable.
 */
export function registerAgentFabricCompletions(monaco: typeof Monaco): Monaco.IDisposable {
  return monaco.languages.registerCompletionItemProvider("agentscript", {
    triggerCharacters: ["@", ".", " "],
    async provideCompletionItems(model, position) {
      const empty = { suggestions: [] as Monaco.languages.CompletionItem[] };
      try {
        const source = model.getValue();
        const tree = await parseAgentFabricSource(source);
        const svc = getService();
        svc.update(tree.rootNode);

        const line = position.lineNumber - 1;
        const character = position.column - 1;
        const word = model.getWordUntilPosition(position);
        const range: Monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        const prefix = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });

        const atMatch = AT_EXPRESSION_RE.exec(prefix);
        const suggestions = atMatch
          ? buildAtExpressionSuggestions(monaco, svc, atMatch[1], line, character, range)
          : buildContextSuggestions(monaco, svc, line, character, source, range);

        return { suggestions };
      } catch {
        return empty;
      }
    },
  });
}
