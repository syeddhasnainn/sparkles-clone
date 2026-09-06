import { createFileRoute } from "@tanstack/react-router";
import { getSignInUrl } from "@workos/authkit-tanstack-react-start";
import { authReturnPath } from "@/lib/auth-redirect";

export const Route = createFileRoute("/api/auth/sign-in")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const parameters = new URL(request.url).searchParams;
        const returnPathname = authReturnPath(parameters.get("returnTo"));
        const url = await getSignInUrl({ data: { returnPathname } });
        return new Response(null, {
          status: 307,
          headers: { Location: url, "Cache-Control": "no-store" },
        });
      },
    },
  },
});
