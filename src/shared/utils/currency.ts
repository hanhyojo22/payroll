export const currency = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});

export const formatMoney = (value: string | number | null | undefined): string => {
  const num = typeof value === "string" ? parseFloat(value.replace(/,/g, "")) : Number(value ?? 0);
  if (isNaN(num) || num === 0) return "";
  return num.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

export const toNumber = (value: string | number | null | undefined): number => Number(value ?? 0);
