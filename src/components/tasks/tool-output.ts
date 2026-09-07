import { z } from "zod";
import type { ToolCall } from "./tool-activity";

interface ToolOutput {
  text: string;
  images: string[];
}

const imageSchema = z.object({
  type: z.literal("image"),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  data: z
    .string()
    .max(12 * 1024 * 1024)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/),
});
const resultSchema = z.object({ result: z.object({ content: z.unknown() }) });
const wrapperSchema = z.object({ content: z.unknown() });
const textSchema = z.object({ type: z.literal("text"), text: z.string() });

export function toolOutput({ output: value }: Pick<ToolCall, "output">): ToolOutput {
  const string = z.string().safeParse(value);
  if (string.success) return { text: string.data, images: [] };
  const array = z.array(z.unknown()).safeParse(value);
  if (array.success) {
    const parts = array.data.map((output) => toolOutput({ output }));
    return {
      text: parts
        .map((part) => part.text)
        .filter(Boolean)
        .join("\n"),
      images: parts.flatMap((part) => part.images),
    };
  }
  const image = imageSchema.safeParse(value);
  if (image.success)
    return { text: "", images: [`data:${image.data.mimeType};base64,${image.data.data}`] };
  const text = textSchema.safeParse(value);
  if (text.success) return { text: text.data.text, images: [] };
  const result = resultSchema.safeParse(value);
  if (result.success) return toolOutput({ output: result.data.result.content });
  const wrapper = wrapperSchema.safeParse(value);
  if (wrapper.success && wrapper.data.content !== undefined)
    return toolOutput({ output: wrapper.data.content });
  return {
    text:
      JSON.stringify(
        value,
        (key, item) =>
          key === "data" && z.string().min(10001).safeParse(item).success
            ? "[binary content omitted]"
            : item,
        2,
      ) ?? "",
    images: [],
  };
}
