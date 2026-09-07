import { z } from "zod";

const issuer = "https://auth.openai.com";
const clientId = "app_EMoamEEZ73f0CkXaXp7hrann";
export const verificationUrl = `${issuer}/codex/device`;

export class ChatGPTError extends Error {
  constructor(
    message: string,
    readonly status = 503,
  ) {
    super(message);
  }
}

export async function boundedJSON(response: Response, maximumBytes = 128 * 1024) {
  const reader = response.body?.getReader();
  if (!reader) throw new ChatGPTError("ChatGPT returned an empty response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new ChatGPTError("ChatGPT returned an invalid response.");
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return parsed;
  } catch {
    throw new ChatGPTError("ChatGPT returned an invalid response.");
  }
}

const tokenSchema = z.object({
  access_token: z.string().min(1).max(32000),
  refresh_token: z.string().min(1).max(32000),
  id_token: z.string().max(32000).optional(),
  // OpenAI can issue ten-day access tokens. Bound timestamp arithmetic, not token policy.
  expires_in: z.coerce.number().int().positive().max(8_000_000_000_000).default(3600),
});
export type ChatGPTTokens = z.infer<typeof tokenSchema>;

export function createChatGPTAPI(fetcher: typeof fetch = fetch) {
  const post = (path: string, body: BodyInit, type = "application/json") =>
    fetcher(`${issuer}${path}`, {
      method: "POST",
      headers: { "Content-Type": type },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
  const tokens = async (body: URLSearchParams) => {
    const response = await post("/oauth/token", body, "application/x-www-form-urlencoded");
    if (!response.ok) {
      await response.body?.cancel();
      throw new ChatGPTError(
        "Reconnect ChatGPT to continue.",
        response.status === 400 || response.status === 401 ? 401 : 503,
      );
    }
    return tokenSchema.parse(await boundedJSON(response));
  };
  return {
    async start() {
      const response = await post(
        "/api/accounts/deviceauth/usercode",
        JSON.stringify({ client_id: clientId }),
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new ChatGPTError(
          "Could not start ChatGPT sign-in. Enable device code authorization in your ChatGPT security settings and try again.",
        );
      }
      const value = z
        .object({
          device_auth_id: z.string().min(1).max(4096),
          user_code: z.string().min(1).max(128),
          interval: z.coerce.number().int().min(1).max(60),
        })
        .parse(await boundedJSON(response));
      return {
        deviceAuthId: value.device_auth_id,
        userCode: value.user_code,
        interval: value.interval * 1000,
      };
    },
    async poll(deviceAuthId: string, userCode: string) {
      const response = await post(
        "/api/accounts/deviceauth/token",
        JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
      );
      if (response.status === 403 || response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new ChatGPTError("ChatGPT sign-in failed. Start a new connection.");
      }
      const code = z
        .object({ authorization_code: z.string().min(1), code_verifier: z.string().min(1) })
        .parse(await boundedJSON(response));
      return tokens(
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          code: code.authorization_code,
          code_verifier: code.code_verifier,
          redirect_uri: `${issuer}/deviceauth/callback`,
        }),
      );
    },
    refresh: (refreshToken: string) =>
      tokens(
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: refreshToken,
        }),
      ),
  };
}

export function tokenIdentity(tokens: ChatGPTTokens) {
  for (const token of [tokens.id_token, tokens.access_token]) {
    if (!token) continue;
    try {
      const encoded = token.split(".")[1];
      const claims = z
        .object({
          email: z.string().max(320).optional(),
          "https://api.openai.com/auth": z
            .object({
              chatgpt_account_id: z.string().min(1).max(512),
              chatgpt_plan_type: z.string().max(64).optional(),
            })
            .optional(),
        })
        .parse(JSON.parse(atob(encoded.replaceAll("-", "+").replaceAll("_", "/"))));
      const auth = claims["https://api.openai.com/auth"];
      if (auth && !/[\r\n]/.test(auth.chatgpt_account_id))
        return {
          accountId: auth.chatgpt_account_id,
          email: claims.email ?? null,
          plan: auth.chatgpt_plan_type ?? null,
        };
    } catch {
      continue;
    }
  }
  throw new ChatGPTError("ChatGPT did not return an account identity. Please reconnect.", 401);
}
