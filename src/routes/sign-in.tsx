import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { getCurrentUser } from "@/lib/auth";
import { authReturnPath, signInSearchSchema } from "@/lib/auth-redirect";

export const Route = createFileRoute("/sign-in")({
  validateSearch: signInSearchSchema,
  beforeLoad: async ({ search }) => {
    if (await getCurrentUser()) {
      throw redirect({ href: authReturnPath(search.returnTo) });
    }

    if (!search.error) {
      throw redirect({
        href: `/api/auth/sign-in?returnTo=${encodeURIComponent(authReturnPath(search.returnTo))}`,
        reloadDocument: true,
      });
    }
  },
  head: () => ({ meta: [{ title: "Sign in — Sparkles" }] }),
  component: SignIn,
});

function SignIn() {
  const { returnTo } = Route.useSearch();

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="sign-in-heading">
        <img className="auth-logo" src="/brand/sparkles.svg" alt="Sparkles" />
        <h1 id="sign-in-heading">Sign-in unsuccessful</h1>
        <p role="alert">We couldn’t complete your sign-in. Please try again.</p>
        <Link
          className="settings-button primary auth-sign-in"
          to="/api/auth/sign-in"
          search={{ returnTo: authReturnPath(returnTo) }}
          reloadDocument
          preload={false}
        >
          Try signing in again
        </Link>
      </section>
    </main>
  );
}
