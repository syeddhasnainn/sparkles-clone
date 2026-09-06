import { useState } from "react";
import { File, MultiFileDiff } from "@pierre/diffs/react";
import type { WorkspaceFile } from "../../../bridge/workspace-view-contracts";
import { usePreferences } from "../settings/preferences";

export default function WorkspaceFileViewer({ file }: { file: WorkspaceFile }) {
  const [mode, setMode] = useState<"diff" | "code">("diff");
  const [split, setSplit] = useState(false);
  return (
    <>
      <div className="workspace-file-heading">
        <span title={file.path}>{file.path}</span>
        {!file.binary && !file.tooLarge && (
          <div className="workspace-segments">
            <button aria-pressed={mode === "diff"} onClick={() => setMode("diff")}>
              Diff
            </button>
            <button aria-pressed={mode === "code"} onClick={() => setMode("code")}>
              Code
            </button>
            {mode === "diff" && (
              <button aria-pressed={split} onClick={() => setSplit((value) => !value)}>
                Split
              </button>
            )}
          </div>
        )}
      </div>
      <div className="workspace-code-view">
        <FileContent file={file} mode={mode} split={split} />
      </div>
    </>
  );
}

function FileContent({
  file,
  mode,
  split,
}: {
  file: WorkspaceFile;
  mode: "diff" | "code";
  split: boolean;
}) {
  const { preferences } = usePreferences();
  if (file.image)
    return <img className="workspace-image-preview" src={file.image} alt={file.path} />;
  if (file.tooLarge)
    return (
      <p className="workspace-file-placeholder">This file exceeds the 512 KB preview limit.</p>
    );
  if (file.binary)
    return <p className="workspace-file-placeholder">Binary file. A text diff is not available.</p>;
  const options = {
    theme: { light: "github-light", dark: "github-dark" },
    themeType: preferences.theme,
    disableFileHeader: true,
  };
  if (mode === "code")
    return (
      <File
        file={{ name: file.path, contents: file.after ?? file.before ?? "" }}
        options={options}
      />
    );
  return (
    <MultiFileDiff
      oldFile={{ name: file.path, contents: file.before ?? "" }}
      newFile={{ name: file.path, contents: file.after ?? "" }}
      options={{ ...options, diffStyle: split ? "split" : "unified", overflow: "scroll" }}
    />
  );
}
