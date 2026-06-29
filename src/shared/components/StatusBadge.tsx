export function StatusBadge({ status }: { status: string }) {
  return <span className={`status ${status.replace(" ", "-")}`}>{status}</span>;
}
