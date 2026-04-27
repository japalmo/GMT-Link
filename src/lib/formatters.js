const currencyFormatter = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
});

const shortDateFormatter = new Intl.DateTimeFormat('es-CL', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('es-CL', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function toDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  return new Date(value);
}

export function formatCurrencyCLP(value) {
  return currencyFormatter.format(Number(value ?? 0));
}

export function formatShortDate(value) {
  const date = toDateValue(value);
  if (!date || Number.isNaN(date.getTime())) return 'Sin fecha';
  return shortDateFormatter.format(date);
}

export function formatDateTime(value) {
  const date = toDateValue(value);
  if (!date || Number.isNaN(date.getTime())) return 'Sin fecha';
  return dateTimeFormatter.format(date);
}
