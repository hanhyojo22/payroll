import { useEffect, useState } from "react";
import { formatMoney } from "../utils/currency";

export function MoneyField({
  label,
  onChange,
  placeholder,
  required,
  value,
}: {
  label?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  value: string;
}) {
  const [display, setDisplay] = useState(formatMoney(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDisplay(formatMoney(value));
  }, [focused, value]);

  const input = (
    <input
      inputMode="decimal"
      onBlur={() => {
        setFocused(false);
        setDisplay(formatMoney(value));
      }}
      onChange={(event) => onChange(event.target.value.replace(/[^0-9.]/g, ""))}
      onFocus={() => setFocused(true)}
      placeholder={placeholder ?? "0.00"}
      required={required}
      type="text"
      value={focused ? value : display}
    />
  );

  if (!label) return input;

  return (
    <label>
      {label}
      {input}
    </label>
  );
}
