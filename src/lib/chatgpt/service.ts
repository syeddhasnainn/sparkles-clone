import { z } from "zod";
import { encrypt, decrypt } from "../github/crypto";
import { ChatGPTError, createChatGPTAPI, tokenIdentity, verificationUrl } from "./api";

const credentialSchema = z.object({ access: z.string(), refresh: z.string() });
const connectionSchema = z.object({
  id: z.string(),
  account_id: z.string(),
  email: z.string().nullable(),
  plan: z.string().nullable(),
  credential: z.string(),
  expires_at: z.number(),
  reconnect_required: z.number(),
  version: z.number(),
});
const authorizationSchema = z.object({
  id: z.string(),
  state: z.string(),
  expires_at: z.number(),
  interval_ms: z.number(),
  poll_after: z.number(),
  status: z.string(),
  connection_id: z.string(),
});
const stateSchema = z.object({
  deviceAuthId: z.string(),
  userCode: z.string(),
  accountId: z.string().nullable(),
});

type ChatGPTEnvironment = Pick<Env, "DB" | "CHATGPT_TOKEN_ENCRYPTION_KEY">;
export function createChatGPTService(environment: ChatGPTEnvironment, api = createChatGPTAPI()) {
  const db = environment.DB;
  const secret = environment.CHATGPT_TOKEN_ENCRYPTION_KEY;
  const configured = () => /^[a-f0-9]{64}$/i.test(secret || "");
  const context = (userId: string, id: string) => `chatgpt:${userId}:${id}`;
  const read = async (userId: string) => {
    const row = await db
      .prepare("SELECT * FROM chatgpt_connections WHERE user_id = ?")
      .bind(userId)
      .first();
    return row ? connectionSchema.parse(row) : null;
  };
  const authorization = async (userId: string, id: string) => {
    const row = await db
      .prepare("SELECT * FROM chatgpt_device_authorizations WHERE user_id = ? AND id = ?")
      .bind(userId, id)
      .first();
    if (!row) throw new ChatGPTError("This sign-in was cancelled or replaced. Start again.", 409);
    return authorizationSchema.parse(row);
  };
  const requireConfiguration = () => {
    if (!configured()) throw new ChatGPTError("ChatGPT connections have not been configured yet.");
  };
  return {
    async status(userId: string) {
      const row = await read(userId);
      return {
        configured: configured(),
        account: row
          ? {
              id: row.id,
              email: row.email,
              plan: row.plan,
              reconnectRequired: Boolean(row.reconnect_required),
            }
          : null,
      };
    },
    async requireConnection(userId: string) {
      requireConfiguration();
      const row = await read(userId);
      if (!row || row.reconnect_required)
        throw new ChatGPTError(
          "Connect ChatGPT in Settings → Integrations before starting this task.",
          401,
        );
      return row.id;
    },
    async start(userId: string) {
      requireConfiguration();
      const [current, started] = await Promise.all([read(userId), api.start()]);
      const id = crypto.randomUUID();
      const expiresAt = Date.now() + 10 * 60 * 1000;
      const connectionId = current?.id ?? crypto.randomUUID();
      const state = await encrypt(
        JSON.stringify({
          deviceAuthId: started.deviceAuthId,
          userCode: started.userCode,
          accountId: current?.account_id ?? null,
        }),
        secret,
        context(userId, id),
      );
      await db
        .prepare(
          "INSERT INTO chatgpt_device_authorizations(user_id, id, state, expires_at, interval_ms, poll_after, connection_id) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET id = excluded.id, state = excluded.state, expires_at = excluded.expires_at, interval_ms = excluded.interval_ms, poll_after = excluded.poll_after, connection_id = excluded.connection_id, status = 'pending', lease = NULL, lease_until = 0",
        )
        .bind(
          userId,
          id,
          state,
          expiresAt,
          started.interval,
          Date.now() + started.interval,
          connectionId,
        )
        .run();
      return {
        id,
        userCode: started.userCode,
        verificationUrl,
        expiresAt,
        intervalMs: started.interval,
      };
    },
    async poll(userId: string, id: string) {
      requireConfiguration();
      const current = await authorization(userId, id);
      if (current.status === "connected") return { status: "connected" as const };
      if (current.status !== "pending")
        throw new ChatGPTError("ChatGPT sign-in failed. Start again.", 409);
      if (current.expires_at <= Date.now())
        throw new ChatGPTError("This code expired. Start a new ChatGPT connection.", 409);
      const lease = crypto.randomUUID();
      const claimed = await db
        .prepare(
          "UPDATE chatgpt_device_authorizations SET lease = ?, lease_until = ?, poll_after = ? WHERE user_id = ? AND id = ? AND status = 'pending' AND expires_at > ? AND poll_after <= ? AND lease_until <= ?",
        )
        .bind(
          lease,
          Date.now() + 60000,
          Date.now() + current.interval_ms,
          userId,
          id,
          Date.now(),
          Date.now(),
          Date.now(),
        )
        .run();
      if (!claimed.meta.changes) return { status: "pending" as const };
      let stage = "decode_authorization";
      try {
        const state = stateSchema.parse(
          JSON.parse(await decrypt(current.state, secret, context(userId, id))),
        );
        stage = "exchange_tokens";
        const tokens = await api.poll(state.deviceAuthId, state.userCode);
        if (!tokens) return { status: "pending" as const };
        stage = "read_identity";
        const identity = tokenIdentity(tokens);
        if (state.accountId && state.accountId !== identity.accountId)
          throw new ChatGPTError(
            "Sign in to the same ChatGPT account to reconnect. Disconnect first to use a different account.",
            409,
          );
        stage = "save_connection";
        const credential = await encrypt(
          JSON.stringify({ access: tokens.access_token, refresh: tokens.refresh_token }),
          secret,
          context(userId, current.connection_id),
        );
        const results = await db.batch([
          db
            .prepare(
              "INSERT INTO chatgpt_connections(user_id, id, account_id, email, plan, credential, expires_at) SELECT user_id, connection_id, ?, ?, ?, ?, ? FROM chatgpt_device_authorizations WHERE user_id = ? AND id = ? AND lease = ? AND status = 'pending' AND expires_at > ? ON CONFLICT(user_id) DO UPDATE SET credential = excluded.credential, email = excluded.email, plan = excluded.plan, expires_at = excluded.expires_at, reconnect_required = 0, version = chatgpt_connections.version + 1, refresh_lease = NULL, refresh_until = 0 WHERE chatgpt_connections.id = excluded.id AND chatgpt_connections.account_id = excluded.account_id",
            )
            .bind(
              identity.accountId,
              identity.email,
              identity.plan,
              credential,
              Date.now() + tokens.expires_in * 1000,
              userId,
              id,
              lease,
              Date.now(),
            ),
          db
            .prepare(
              "UPDATE chatgpt_device_authorizations SET status = 'connected', state = '', lease = NULL, lease_until = 0 WHERE user_id = ? AND id = ? AND lease = ? AND EXISTS (SELECT 1 FROM chatgpt_connections c WHERE c.user_id = ? AND c.id = chatgpt_device_authorizations.connection_id)",
            )
            .bind(userId, id, lease, userId),
        ]);
        if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1)
          throw new ChatGPTError("The connection changed while signing in. Start again.", 409);
        return { status: "connected" as const };
      } catch (error) {
        // Never log OAuth payloads or exception messages: they can contain credentials.
        console.error("ChatGPT sign-in failed", {
          stage,
          kind: error instanceof Error ? error.name : "Unknown",
          fields:
            error instanceof z.ZodError
              ? error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code }))
              : undefined,
        });
        await db
          .prepare(
            "UPDATE chatgpt_device_authorizations SET status = 'failed', state = '' WHERE user_id = ? AND id = ? AND lease = ?",
          )
          .bind(userId, id, lease)
          .run();
        if (error instanceof ChatGPTError) throw error;
        throw new ChatGPTError("ChatGPT sign-in could not finish. Please start again.");
      } finally {
        await db
          .prepare(
            "UPDATE chatgpt_device_authorizations SET lease = NULL, lease_until = 0 WHERE user_id = ? AND id = ? AND lease = ?",
          )
          .bind(userId, id, lease)
          .run();
      }
    },
    async cancel(userId: string, id: string) {
      await db
        .prepare("DELETE FROM chatgpt_device_authorizations WHERE user_id = ? AND id = ?")
        .bind(userId, id)
        .run();
    },
    async disconnect(userId: string) {
      await db.batch([
        db.prepare("DELETE FROM chatgpt_device_authorizations WHERE user_id = ?").bind(userId),
        db.prepare("DELETE FROM chatgpt_connections WHERE user_id = ?").bind(userId),
        db
          .prepare(
            "UPDATE model_gateway_tokens SET revoked = 1 WHERE user_id = ? AND provider = 'chatgpt'",
          )
          .bind(userId),
      ]);
    },
    async access(userId: string, connectionId: string, force = false) {
      requireConfiguration();
      for (let attempt = 0; attempt < 40; attempt++) {
        const row = await read(userId);
        if (!row || row.id !== connectionId || row.reconnect_required)
          throw new ChatGPTError("Reconnect ChatGPT in Settings → Integrations to continue.", 401);
        const credentials = credentialSchema.parse(
          JSON.parse(await decrypt(row.credential, secret, context(userId, row.id))),
        );
        if (!force && row.expires_at > Date.now() + 60000)
          return { token: credentials.access, accountId: row.account_id };
        const lease = crypto.randomUUID();
        const claimed = await db
          .prepare(
            "UPDATE chatgpt_connections SET refresh_lease = ?, refresh_until = ? WHERE user_id = ? AND id = ? AND version = ? AND refresh_until <= ? AND reconnect_required = 0",
          )
          .bind(lease, Date.now() + 60000, userId, connectionId, row.version, Date.now())
          .run();
        if (!claimed.meta.changes) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          force = false;
          continue;
        }
        try {
          const tokens = await api.refresh(credentials.refresh);
          const identity = tokenIdentity(tokens);
          if (identity.accountId !== row.account_id)
            throw new ChatGPTError("The ChatGPT account changed. Reconnect to continue.", 401);
          const credential = await encrypt(
            JSON.stringify({ access: tokens.access_token, refresh: tokens.refresh_token }),
            secret,
            context(userId, row.id),
          );
          const saved = await db
            .prepare(
              "UPDATE chatgpt_connections SET credential = ?, expires_at = ?, version = version + 1, refresh_lease = NULL, refresh_until = 0 WHERE user_id = ? AND id = ? AND version = ? AND refresh_lease = ? AND reconnect_required = 0",
            )
            .bind(
              credential,
              Date.now() + tokens.expires_in * 1000,
              userId,
              connectionId,
              row.version,
              lease,
            )
            .run();
          if (saved.meta.changes !== 1)
            throw new ChatGPTError("The ChatGPT connection changed. Please retry.", 409);
          return { token: tokens.access_token, accountId: identity.accountId };
        } catch {
          await db
            .prepare(
              "UPDATE chatgpt_connections SET reconnect_required = 1, refresh_lease = NULL, refresh_until = 0 WHERE user_id = ? AND id = ? AND version = ? AND refresh_lease = ?",
            )
            .bind(userId, connectionId, row.version, lease)
            .run();
          throw new ChatGPTError("Reconnect ChatGPT in Settings → Integrations to continue.", 401);
        }
      }
      throw new ChatGPTError("ChatGPT is refreshing its connection. Please retry shortly.");
    },
  };
}
