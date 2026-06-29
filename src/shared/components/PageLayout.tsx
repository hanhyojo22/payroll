import type { ReactNode } from "react";
import { Search } from "lucide-react";

export function PageHeader({
  action,
  eyebrow,
  text,
  title,
}: {
  action?: ReactNode;
  eyebrow: string;
  text: string;
  title: string;
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {action}
    </header>
  );
}

export function Toolbar({
  children,
  query,
  setQuery,
}: {
  children?: ReactNode;
  query: string;
  setQuery: (query: string) => void;
}) {
  return (
    <div className="toolbar">
      <label className="search-box">
        <Search size={17} />
        <input
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search records"
          type="search"
          value={query}
        />
      </label>
      {children}
    </div>
  );
}

export function RecordTitle({ notes, title }: { notes: string; title: string }) {
  return (
    <div className="record-title">
      <strong>{title}</strong>
      {notes && <span>{notes}</span>}
    </div>
  );
}
