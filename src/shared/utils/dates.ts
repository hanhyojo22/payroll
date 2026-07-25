export const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const todayKey = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
export const currentMonth = (): string => String(new Date().getMonth() + 1);
export const currentYear = (): string => String(new Date().getFullYear());
export const isBeforeToday = (date: string): boolean => date < todayKey();
export const isToday = (date: string): boolean => date === todayKey();
export const addDays = (date: string, days: number): string => {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  const result = new Date(Date.UTC(year, month - 1, day + days));
  const resultMonth = String(result.getUTCMonth() + 1).padStart(2, "0");
  const resultDay = String(result.getUTCDate()).padStart(2, "0");
  return `${result.getUTCFullYear()}-${resultMonth}-${resultDay}`;
};
