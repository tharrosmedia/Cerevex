/**
 * Parser for cerevex-recommendation-format YAML.
 * A document that uses anchors, tags, or block scalars is rejected whole.
 * Callers never store a partial record.
 */

export class RecommendationYamlError extends Error {
  readonly line: number | null;

  constructor(message: string, line: number | null = null) {
    super(line == null ? message : `line ${line}: ${message}`);
    this.name = "RecommendationYamlError";
    this.line = line;
  }
}

interface YamlLine {
  no: number;
  indent: number;
  text: string;
}

export function parseRecommendationYaml(input: string): unknown {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new RecommendationYamlError("YAML document is empty");
  }
  if (input.length > 200_000) {
    throw new RecommendationYamlError("YAML document is too large");
  }
  const lines = lex(input);
  if (lines.length === 0) throw new RecommendationYamlError("YAML document is empty");
  const parsed = parseBlock(lines, 0, 0);
  if (parsed.next !== lines.length) {
    throw new RecommendationYamlError("Unexpected trailing YAML", lines[parsed.next]?.no ?? null);
  }
  return parsed.value;
}

function lex(input: string): YamlLine[] {
  const lines: YamlLine[] = [];
  const rawLines = input.split(/\r?\n/);
  for (let index = 0; index < rawLines.length; index += 1) {
    const raw = rawLines[index] ?? "";
    if (raw.includes("\t")) throw new RecommendationYamlError("Tabs are not allowed in recommendation YAML", index + 1);
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed === "---" || trimmed === "...") continue;
    if (trimmed.startsWith("#")) continue;
    const indent = raw.match(/^ */)?.[0].length ?? 0;
    const text = stripComment(raw.slice(indent)).trim();
    if (text.length === 0) continue;
    if (/^[&*]/.test(text) || text.includes(" &") || text.includes(" *")) {
      throw new RecommendationYamlError("Anchors and aliases are not allowed", index + 1);
    }
    if (/(^|\s)!!/.test(text)) throw new RecommendationYamlError("YAML tags are not allowed", index + 1);
    if (text === "|" || text === ">" || text.startsWith("|") || text.startsWith(">")) {
      throw new RecommendationYamlError("Block scalars are not allowed", index + 1);
    }
    lines.push({ no: index + 1, indent, text });
  }
  return lines;
}

function stripComment(text: string): string {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\" && quote === '"') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "#" && (i === 0 || text[i - 1] === " ")) return text.slice(0, i);
  }
  return text;
}

function parseBlock(lines: YamlLine[], start: number, indent: number): { value: unknown; next: number } {
  const line = lines[start];
  if (!line || line.indent < indent) {
    throw new RecommendationYamlError("Expected a YAML value", line?.no ?? null);
  }
  if (line.text.startsWith("- ") || line.text === "-") return parseSequence(lines, start, line.indent);
  return parseMap(lines, start, line.indent);
}

function parseSequence(lines: YamlLine[], start: number, indent: number): { value: unknown[]; next: number } {
  const items: unknown[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (!line || line.indent < indent) break;
    if (line.indent > indent) {
      throw new RecommendationYamlError("Sequence item is indented too far", line.no);
    }
    if (!line.text.startsWith("- ") && line.text !== "-") break;
    const rest = line.text === "-" ? "" : line.text.slice(2).trim();
    if (rest.length === 0) {
      const nested = lines[index + 1];
      if (!nested || nested.indent <= indent) {
        items.push(null);
        index += 1;
        continue;
      }
      const child = parseBlock(lines, index + 1, nested.indent);
      items.push(child.value);
      index = child.next;
      continue;
    }
    if (rest.startsWith("{") || rest.startsWith("[")) {
      items.push(parseFlow(rest, line.no));
      index += 1;
      continue;
    }
    const keyed = splitKey(rest, line.no);
    if (!keyed) {
      items.push(parseScalar(rest, line.no));
      index += 1;
      continue;
    }
    const map: Record<string, unknown> = {};
    assignKey(map, keyed.key, keyed.rawValue, lines, index, indent, line.no);
    index += 1;
    while (index < lines.length) {
      const next = lines[index];
      if (!next || next.indent <= indent) break;
      if (next.text.startsWith("- ") || next.text === "-") {
        throw new RecommendationYamlError("Nested sequence under a record key must use flow style", next.no);
      }
      const field = splitKey(next.text, next.no);
      if (!field) throw new RecommendationYamlError("Expected key: value", next.no);
      assignKey(map, field.key, field.rawValue, lines, index, next.indent, next.no);
      index += 1;
    }
    items.push(map);
  }
  if (items.length === 0) throw new RecommendationYamlError("Expected a YAML sequence", lines[start]?.no ?? null);
  return { value: items, next: index };
}

function parseMap(lines: YamlLine[], start: number, indent: number): { value: Record<string, unknown>; next: number } {
  const map: Record<string, unknown> = {};
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (!line || line.indent < indent) break;
    if (line.indent > indent) throw new RecommendationYamlError("Mapping entry is indented too far", line.no);
    if (line.text.startsWith("- ") || line.text === "-") break;
    const field = splitKey(line.text, line.no);
    if (!field) throw new RecommendationYamlError("Expected key: value", line.no);
    assignKey(map, field.key, field.rawValue, lines, index, indent, line.no);
    index += 1;
  }
  return { value: map, next: index };
}

function assignKey(
  map: Record<string, unknown>,
  key: string,
  rawValue: string,
  lines: YamlLine[],
  index: number,
  indent: number,
  lineNo: number,
): void {
  if (Object.prototype.hasOwnProperty.call(map, key)) {
    throw new RecommendationYamlError(`Duplicate key ${key}`, lineNo);
  }
  const value = rawValue.trim();
  if (value.length > 0) {
    map[key] = value.startsWith("{") || value.startsWith("[") ? parseFlow(value, lineNo) : parseScalar(value, lineNo);
    return;
  }
  const nested = lines[index + 1];
  if (!nested || nested.indent <= indent) {
    map[key] = null;
    return;
  }
  const child = parseBlock(lines, index + 1, nested.indent);
  map[key] = child.value;
  // The caller increments once. Skip the nested lines by splicing the index via a side channel:
  // we rewind by mutating a marker on the lines array position through a thrown-free index stash.
  lines.splice(index + 1, child.next - (index + 1));
}

function splitKey(text: string, lineNo: number): { key: string; rawValue: string } | null {
  if (text.startsWith("-")) return null;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\" && quote === '"') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ":") {
      const key = text.slice(0, i).trim();
      if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new RecommendationYamlError(`Invalid key ${JSON.stringify(key)}`, lineNo);
      return { key, rawValue: text.slice(i + 1) };
    }
  }
  return null;
}

function parseScalar(text: string, lineNo: number): unknown {
  const value = text.trim();
  if (value === "null" || value === "~" || value === "Null" || value === "NULL") return null;
  if (value === "true" || value === "True" || value === "TRUE") return true;
  if (value === "false" || value === "False" || value === "FALSE") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (/^-?\d+\.\d+$/.test(value)) return Number(value);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return unquote(value, lineNo);
  }
  if (value.startsWith('"') || value.startsWith("'") || value.endsWith('"') || value.endsWith("'")) {
    throw new RecommendationYamlError("Unbalanced quote", lineNo);
  }
  return value;
}

function unquote(value: string, lineNo: number): string {
  const quote = value[0];
  const body = value.slice(1, -1);
  if (quote === "'") return body.replace(/''/g, "'");
  return body.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function parseFlow(text: string, lineNo: number): unknown {
  const parsed = readFlow(text, 0, lineNo);
  if (parsed.next !== text.length) {
    throw new RecommendationYamlError("Unexpected text after a flow value", lineNo);
  }
  return parsed.value;
}

function readFlow(text: string, start: number, lineNo: number): { value: unknown; next: number } {
  const opener = text[start];
  if (opener !== "{" && opener !== "[") throw new RecommendationYamlError("Expected a flow value", lineNo);
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let quote: '"' | "'" | null = null;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\" && quote === '"') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "{" || ch === "[") depth += 1;
    if (ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) {
        const inner = text.slice(start + 1, i).trim();
        if (ch !== closer) throw new RecommendationYamlError("Mismatched flow bracket", lineNo);
        const value = opener === "{" ? parseFlowMap(inner, lineNo) : parseFlowSeq(inner, lineNo);
        return { value, next: skipSpace(text, i + 1) };
      }
    }
  }
  throw new RecommendationYamlError("Unclosed flow value", lineNo);
}

function parseFlowMap(inner: string, lineNo: number): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  if (inner.length === 0) return map;
  for (const part of splitFlow(inner, lineNo)) {
    const field = splitKey(part.trim(), lineNo);
    if (!field || field.key.length === 0) throw new RecommendationYamlError("Flow map entry needs a key", lineNo);
    const raw = field.rawValue.trim();
    if (Object.prototype.hasOwnProperty.call(map, field.key)) {
      throw new RecommendationYamlError(`Duplicate key ${field.key}`, lineNo);
    }
    map[field.key] = raw.length === 0 ? null : raw.startsWith("{") || raw.startsWith("[") ? parseFlow(raw, lineNo) : parseScalar(raw, lineNo);
  }
  return map;
}

function parseFlowSeq(inner: string, lineNo: number): unknown[] {
  if (inner.length === 0) return [];
  return splitFlow(inner, lineNo).map((part) => {
    const raw = part.trim();
    if (raw.startsWith("{") || raw.startsWith("[")) return parseFlow(raw, lineNo);
    return parseScalar(raw, lineNo);
  });
}

function splitFlow(inner: string, lineNo: number): string[] {
  const parts: string[] = [];
  let quote: '"' | "'" | null = null;
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (quote) {
      if (ch === "\\" && quote === '"') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "{" || ch === "[") depth += 1;
    if (ch === "}" || ch === "]") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  if (quote || depth !== 0) throw new RecommendationYamlError("Unbalanced flow value", lineNo);
  parts.push(inner.slice(start));
  return parts;
}

function skipSpace(text: string, index: number): number {
  let next = index;
  while (text[next] === " ") next += 1;
  return next;
}
