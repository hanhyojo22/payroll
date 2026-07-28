import type { AttendanceStatus } from "../types";

export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${period}`;
}

const STANDARD_WORK_HOURS = 8;

export function hoursBetween(timeIn: string, timeOut: string): number {
  if (!timeIn || !timeOut) return 0;
  const [inH, inM] = timeIn.split(":").map(Number);
  const [outH, outM] = timeOut.split(":").map(Number);
  const minutes = (outH * 60 + outM) - (inH * 60 + inM);
  return minutes > 0 ? minutes / 60 : 0;
}

export function computeDailyEarnings(dailyRate: number, status: AttendanceStatus | "", timeIn: string, timeOut: string): number {
  if (status !== "present" && status !== "half_day") return 0;
  const hoursWorked = hoursBetween(timeIn, timeOut);
  if (hoursWorked <= 0) return 0;
  return dailyRate * Math.min(hoursWorked / STANDARD_WORK_HOURS, 1);
}
