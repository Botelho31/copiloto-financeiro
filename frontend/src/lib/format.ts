export function formatMoney(amount: number, currencyCode = "BRL"): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currencyCode }).format(
    amount
  );
}

export function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(dateStr));
}

export function formatMonthLabel(label: string): string {
  const [year, month] = label.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(
    new Date(year, month - 1, 1)
  );
}
