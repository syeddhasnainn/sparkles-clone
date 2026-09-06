import { useState } from "react";
import { useAuth } from "@workos/authkit-tanstack-react-start/client";

export function SignOutButton() {
  const { signOut } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  return (
    <div className="sign-out-action">
      <button
        className="settings-button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(false);

          try {
            await signOut({ returnTo: new URL("/sign-in", window.location.origin).href });
          } catch {
            setError(true);
            setPending(false);
          }
        }}
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {error && <p role="alert">Couldn’t sign out. Please try again.</p>}
    </div>
  );
}
