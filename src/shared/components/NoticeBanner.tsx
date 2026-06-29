import { useEffect } from "react";
import { X } from "lucide-react";
import type { Notice } from "../types";

export function NoticeBanner({
  notice,
  onDismiss,
}: {
  notice: Notice;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (notice?.type !== "success") return;

    const timeout = window.setTimeout(onDismiss, 3000);
    return () => window.clearTimeout(timeout);
  }, [notice, onDismiss]);

  if (!notice) return null;

  return (
    <div className={`notice ${notice.type}`} role={notice.type === "error" ? "alert" : "status"}>
      <div>
        <strong>{notice.type === "error" ? "Action needed" : "Done"}</strong>
        <p>{notice.text}</p>
      </div>
      <button aria-label="Dismiss message" onClick={onDismiss} type="button">
        <X size={16} />
      </button>
    </div>
  );
}
