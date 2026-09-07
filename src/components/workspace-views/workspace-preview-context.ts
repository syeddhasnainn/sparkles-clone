import { createContext } from "react";

export const WorkspacePreviewContext = createContext<(() => void) | null>(null);
