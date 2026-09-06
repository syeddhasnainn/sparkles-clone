import { AppIcon } from "./ui/app-icon";
import { useEffect, useState } from "react";
import FileText from "@hugeicons/core-free-icons/File01Icon";
import FileCode from "@hugeicons/core-free-icons/DocumentCodeIcon";
import Sheet from "@hugeicons/core-free-icons/Table01Icon";
import Presentation from "@hugeicons/core-free-icons/Presentation01Icon";
import Film from "@hugeicons/core-free-icons/Film01Icon";
import X from "@hugeicons/core-free-icons/Cancel01Icon";

export function AttachmentTile({
  file,
  disabled,
  onRemove,
}: {
  file: File;
  disabled: boolean;
  onRemove: () => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const { icon: Icon, color } = attachmentStyle(file);

  return (
    <div className="attachment" title={file.name}>
      {preview ? (
        <img src={preview} alt={file.name} />
      ) : (
        <>
          <AppIcon icon={Icon} size={24} className={`file-icon-${color}`} />
          <span>{file.name}</span>
        </>
      )}
      <button
        type="button"
        disabled={disabled}
        aria-label={`Remove ${file.name}`}
        onClick={onRemove}
      >
        <AppIcon icon={X} size={10} />
      </button>
    </div>
  );
}

function attachmentStyle(file: File) {
  const extension = file.name.split(".").at(-1)?.toLowerCase() || "";
  if (/^(csv|xls|xlsx)$/.test(extension)) return { icon: Sheet, color: "green" };
  if (/^(ppt|pptx|key)$/.test(extension)) return { icon: Presentation, color: "orange" };
  if (/^(js|jsx|ts|tsx|py|json|html|css)$/.test(extension))
    return { icon: FileCode, color: "purple" };
  if (file.type.startsWith("video/")) return { icon: Film, color: "purple" };
  return { icon: FileText, color: "blue" };
}
