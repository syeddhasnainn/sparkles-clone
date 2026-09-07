import {
  environmentVariablesSchema,
  type EnvironmentVariable,
} from "../../../bridge/project-environment";

export function parseEnvironmentFile(text: string): EnvironmentVariable[] {
  if (text.length > 131072) throw new Error("The .env file is too large to import.");
  const values = new Map<string, string>();
  const input = text.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
  let offset = 0;
  while (offset < input.length) {
    const whitespace = input.slice(offset).match(/^\s*/)?.[0] ?? "";
    offset += whitespace.length;
    if (offset === input.length) break;
    if (input[offset] === "#") {
      const end = input.indexOf("\n", offset);
      offset = end === -1 ? input.length : end + 1;
      continue;
    }
    const key = input
      .slice(offset)
      .match(/^(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*/);
    if (!key) throw new Error("Use NAME=value for each variable in the .env file.");
    offset += key[0].length;
    let value = "";
    const quote = input[offset];
    if (quote === '"' || quote === "'") {
      offset++;
      let closed = false;
      while (offset < input.length) {
        const character = input[offset++];
        if (character === quote) {
          closed = true;
          break;
        }
        if (character === "\\" && quote === '"' && offset < input.length) {
          const escaped = input[offset++];
          value +=
            escaped === "n"
              ? "\n"
              : escaped === "r"
                ? "\r"
                : escaped === '"' || escaped === "\\"
                  ? escaped
                  : `\\${escaped}`;
        } else value += character;
      }
      if (!closed) throw new Error("Close each quoted value before importing the .env file.");
      const end = input.indexOf("\n", offset);
      const suffix = input.slice(offset, end === -1 ? input.length : end).trim();
      if (suffix && !suffix.startsWith("#"))
        throw new Error("Unexpected text after a quoted value.");
      offset = end === -1 ? input.length : end + 1;
    } else {
      const end = input.indexOf("\n", offset);
      value = input
        .slice(offset, end === -1 ? input.length : end)
        .split("#")[0]
        .trim();
      offset = end === -1 ? input.length : end + 1;
    }
    values.set(key[1], value);
  }
  const parsed = environmentVariablesSchema.safeParse(
    [...values].map(([name, value]) => ({ name, value })),
  );
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  if (!parsed.data.length) throw new Error("No environment variables found.");
  return parsed.data;
}
