import type { ReactNode } from "react";

export function DataTable({
  empty,
  headers,
  onRowClick,
  rows,
}: {
  empty: string;
  headers: string[];
  onRowClick?: (rowIndex: number) => void;
  rows: ReactNode[][];
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="empty-table" colSpan={headers.length}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr
                className={onRowClick ? "clickable-row" : undefined}
                key={index}
                onClick={onRowClick ? () => onRowClick(index) : undefined}
                onKeyDown={onRowClick ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onRowClick(index);
                  }
                } : undefined}
                tabIndex={onRowClick ? 0 : undefined}
              >
                {row.map((cell, cellIndex) => (
                  <td data-label={headers[cellIndex]} key={cellIndex}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
