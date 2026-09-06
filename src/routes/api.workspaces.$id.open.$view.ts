import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireGitHubUser } from "../lib/github/service.server";

export const Route = createFileRoute("/api/workspaces/$id/open/$view")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { userId } = await requireGitHubUser();
        const { id, view } = z
          .object({ id: z.uuid(), view: z.enum(["preview", "desktop"]) })
          .parse(params);
        const url = new URL(request.url);
        const result = await env.WORKSPACES.getByName(userId).view(
          id,
          { kind: "connect", service: view, path: url.searchParams.get("path") || "/" },
          url.origin,
        );
        if (result.kind !== "connect")
          return new Response("This view is not ready. Open the task to start it.", {
            status: 409,
          });
        return new Response(null, {
          status: 303,
          headers: {
            Location: result.url,
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
          },
        });
      },
    },
  },
});
