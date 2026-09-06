import { createFileRoute, redirect } from "@tanstack/react-router";
import { Dashboard } from "@/components/dashboard/dashboard";
import { getCurrentUser } from "@/lib/auth";

export const Route = createFileRoute("/app")({
  beforeLoad: async ({ location }) => {
    const user = await getCurrentUser();

    if (!user) {
      throw redirect({ to: "/sign-in", search: { returnTo: location.href } });
    }

    return { user };
  },
  component: Dashboard,
});
