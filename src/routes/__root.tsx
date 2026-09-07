import { AuthKitProvider } from "@workos/authkit-tanstack-react-start/client";
import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";

import { themeScript } from "@/components/settings/theme-script";
import { PreferencesProvider } from "@/components/settings/preferences";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "New chat — Sparkles",
      },
    ],
    links: [
      { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
      { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  notFoundComponent: () => (
    <main className="container mx-auto p-4 pt-16">
      <h1>404</h1>
      <p>The requested page could not be found.</p>
    </main>
  ),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <AuthKitProvider>
          <PreferencesProvider>{children}</PreferencesProvider>
        </AuthKitProvider>
        <Scripts />
      </body>
    </html>
  );
}
