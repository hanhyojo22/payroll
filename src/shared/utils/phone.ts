export function normalizePhoneDigits(raw: string): string {
  const stripped = raw.replace(/^\+63\s*/, "");
  let digits = stripped.replace(/\D/g, "");
  if (digits.startsWith("63") && digits.length > 10) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length > 10) digits = digits.slice(1);
  return digits.slice(0, 10);
}

export function formatPhoneNumber(raw: string): string {
  const digits = normalizePhoneDigits(raw);
  if (digits.length === 0) return "";
  if (digits.length <= 4) return `+63 ${digits}`;
  if (digits.length <= 7) return `+63 ${digits.slice(0, 4)} ${digits.slice(4)}`;
  return `+63 ${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
}
