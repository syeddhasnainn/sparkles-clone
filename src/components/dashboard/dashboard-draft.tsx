import { createContext, useContext } from "react";

export const DashboardDraftContext = createContext(0);

export function useDashboardDraft() {
  return useContext(DashboardDraftContext);
}
