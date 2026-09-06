import { useRouteContext } from "@tanstack/react-router";

export function useAccount() {
  return useRouteContext({ from: "/app" }).user;
}
