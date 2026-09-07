import { z } from "zod";

const reservedNames = new Set([
  "PATH",
  "HOME",
  "SHELL",
  "USER",
  "LOGNAME",
  "BASH_ENV",
  "ENV",
  "NODE_OPTIONS",
  "PYTHONPATH",
  "PYTHONHOME",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_API_BASE",
  "OPENROUTER_API_KEY",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
]);
const reservedPrefixes = ["SPARKLES_", "MODAL_", "CODEX_", "OPENCODE_", "XDG_"];
const applicationCredentials = new Set([
  "MODAL_TOKEN_ID",
  "MODAL_TOKEN_SECRET",
  "OPENROUTER_API_KEY",
]);

export const environmentNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]*$/,
    "Use letters, numbers, and underscores; start with a letter or underscore.",
  )
  .refine(
    (name) =>
      applicationCredentials.has(name) ||
      (!reservedNames.has(name.toUpperCase()) &&
        !reservedPrefixes.some((prefix) => name.toUpperCase().startsWith(prefix))),
    "This name is reserved by the workspace runtime.",
  );

export const environmentVariableSchema = z.object({
  name: environmentNameSchema,
  value: z
    .string()
    .refine(
      (value) => new TextEncoder().encode(value).length <= 8192,
      "Values must be 8 KB or less.",
    )
    .refine((value) => !value.includes("\0"), "Values cannot contain null characters."),
});

export const environmentVariablesSchema = z
  .array(environmentVariableSchema)
  .max(50, "A project can have up to 50 variables.")
  .superRefine((variables, context) => {
    const names = new Set<string>();
    for (const [index, variable] of variables.entries()) {
      if (names.has(variable.name))
        context.addIssue({
          code: "custom",
          path: [index, "name"],
          message: "Variable names must be unique.",
        });
      names.add(variable.name);
    }
    if (new TextEncoder().encode(JSON.stringify(variables)).length > 32768)
      context.addIssue({ code: "custom", message: "Project variables must total 32 KB or less." });
  });

export const projectEnvironmentSchema = z
  .record(environmentNameSchema, environmentVariableSchema.shape.value)
  .refine(
    (values) =>
      environmentVariablesSchema.safeParse(
        Object.entries(values).map(([name, value]) => ({ name, value })),
      ).success,
    "Invalid project environment.",
  );

export type EnvironmentVariable = z.infer<typeof environmentVariableSchema>;
