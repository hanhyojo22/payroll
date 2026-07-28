// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";
import { useDialog } from "./useDialog";

afterEach(cleanup);

function Dialog({ onClose, label = "Edit expense" }: { onClose: () => void; label?: string }) {
  const { backdropProps, dialogProps } = useDialog({ onClose, label });
  return (
    <div className="modal-backdrop" {...backdropProps} data-testid="backdrop">
      <div className="modal billing-form-modal" {...dialogProps} data-testid="dialog">
        <button type="button">First</button>
        <input aria-label="Amount" />
        <button type="button">Last</button>
      </div>
    </div>
  );
}

describe("useDialog", () => {
  it("exposes the dialog to assistive tech with an accessible name", () => {
    render(<Dialog onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Edit expense" });
    expect(dialog).toHaveProperty("ariaModal", "true");
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the backdrop is clicked but not when the dialog itself is", () => {
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} />);

    fireEvent.click(screen.getByTestId("dialog"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves focus into the dialog on open", () => {
    render(<Dialog onClose={() => {}} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" }));
  });

  it("returns focus to the element that opened it", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { unmount } = render(<Dialog onClose={() => {}} />);
    expect(document.activeElement).not.toBe(opener);
    unmount();

    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  // Many modals are written inline as {open && <div className="modal-backdrop">...}, so the
  // hook has to sit above that conditional and stay inert until the modal is actually shown.
  it("stays inert while closed", () => {
    const onClose = vi.fn();
    function ClosedDialog() {
      const { dialogProps } = useDialog({ onClose, label: "Edit expense", open: false });
      return <div {...dialogProps} data-testid="dialog" />;
    }
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    render(<ClosedDialog />);
    expect(document.activeElement).toBe(opener);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    opener.remove();
  });

  it("still works when open is passed explicitly", () => {
    const onClose = vi.fn();
    function OpenDialog() {
      const { dialogProps } = useDialog({ onClose, label: "Edit expense", open: true });
      return <div {...dialogProps}><button type="button">First</button></div>;
    }
    render(<OpenDialog />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Without a trap, Tab walks into the page behind the dialog, which for a screen reader or
  // keyboard user silently loses the modal.
  it("keeps Tab inside the dialog", () => {
    render(<Dialog onClose={() => {}} />);
    const first = screen.getByRole("button", { name: "First" });
    const last = screen.getByRole("button", { name: "Last" });

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
