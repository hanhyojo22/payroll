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

export const todayKey = (): string => new Date().toISOString().slice(0, 10);
export const currentMonth = (): string => String(new Date().getMonth() + 1);
export const currentYear = (): string => String(new Date().getFullYear());
export const isBeforeToday = (date: string): boolean => date < todayKey();
export const isToday = (date: string): boolean => date === todayKey();
export const addDays = (date: string, days: number): string => {
  const result = new Date(`${date}T00:00:00`);
  result.setDate(result.getDate() + days);
  return result.toISOString().slice(0, 10);
};
