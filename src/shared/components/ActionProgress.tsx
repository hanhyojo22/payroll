import { Spinner } from "./Spinner";

export function ActionProgress({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="action-progress-overlay" role="status" aria-live="polite">
      <div className="action-progress-card">
        <Spinner />
        <div className="action-progress-copy">
          <strong>{title}</strong>
          <span>{description}</span>
        </div>
        <div className="action-progress-bar" aria-hidden="true">
          <div className="action-progress-bar-fill" />
        </div>
      </div>
    </div>
  );
}
