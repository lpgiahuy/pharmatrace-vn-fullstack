import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(Number(amount))) return '0 ₫';
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
  }).format(Number(amount));
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return 'N/A';
  const d = new Date(date);
  if (isNaN(d.getTime())) return String(date);
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

export function cleanText(str: string | null | undefined): string {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/(\d+)\s*\?{2,}\s*([CFcf])\b/g, '$1°$2')
    .replace(/(\d+)\s*\?{2,}/g, '$1°')
    .replace(/\?{2,}([CFcf])\b/g, '°$1')
    .replace(/(\w+)\s*\?{2,}\s*(\w+)/g, '$1 - $2')
    .replace(/\s*\?{3,}\s*/g, ' - ')
    .replace(/\uFFFD/g, '°');
}
