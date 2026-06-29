export function Spinner({ size = "default" }: { size?: "small" | "default" }) {
  return <span aria-hidden="true" className={`spinner ${size}`} />;
}

export function SyncIndicator({ text }: { text: string }) {
  return (
    <div className="sync-indicator" role="status">
      <Spinner size="small" />
      <span>{text}</span>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="page-skeleton" aria-label="Loading page">
      <div className="skeleton-header">
        <span />
        <strong />
        <p />
      </div>
      <div className="skeleton-metric-grid">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="skeleton-card" key={index}>
            <span />
            <strong />
          </div>
        ))}
      </div>
      <div className="skeleton-band" />
      <div className="skeleton-table">
        {Array.from({ length: 5 }, (_, index) => (
          <span key={index} />
        ))}
      </div>
    </div>
  );
}
