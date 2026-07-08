import { Spinner } from "./Spinner";

export type ActionProgressState = {
  completed: number;
  description: string;
  title: string;
  total: number;
};

export function ActionProgress({
  title,
  description,
  progress,
  progressLabel,
}: {
  title: string;
  description: string;
  progress?: number;
  progressLabel?: string;
}) {
  const clampedProgress = typeof progress === "number" ? Math.min(100, Math.max(0, progress)) : null;

  return (
    <div className="action-progress-overlay" role="status" aria-live="polite">
      <div className="action-progress-card">
        <Spinner />
        <div className="action-progress-copy">
          <strong>{title}</strong>
          <span>{description}</span>
          {progressLabel ? <small>{progressLabel}</small> : null}
        </div>
        <div className="action-progress-bar" aria-hidden="true">
          <div
            className={`action-progress-bar-fill${clampedProgress !== null ? " determinate" : ""}`}
            style={clampedProgress !== null ? { left: 0, width: `${clampedProgress}%` } : undefined}
          />
        </div>
      </div>
    </div>
  );
}
