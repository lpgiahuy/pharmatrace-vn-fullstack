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

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return 'N/A';
  const d = new Date(date);
  if (isNaN(d.getTime())) return String(date);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${hours}:${minutes} ${day}-${month}-${year}`;
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

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  SUPERADMIN: 'Super Admin',
  ADMIN: 'Administrator',
  STORE_MANAGER: 'Store Manager',
  STOREMANAGER: 'Store Manager',
  PHARMACIST: 'Pharmacist',
  WAREHOUSE_MANAGER: 'Warehouse Manager',
  WAREHOUSEMANAGER: 'Warehouse Manager',
  WAREHOUSE_STAFF: 'Warehouse Staff',
  WAREHOUSESTAFF: 'Warehouse Staff',
  FACTORY_WAREHOUSE_STAFF: 'Factory Staff',
  FACTORYWAREHOUSESTAFF: 'Factory Staff',
  CUSTOMER: 'Customer',
};

export function formatRole(role?: string | null): string {
  if (!role) return 'Staff';
  const normalized = role.trim().toUpperCase().replace(/[\s_-]/g, '');
  return ROLE_LABELS[normalized] || ROLE_LABELS[role.trim().toUpperCase()] || role;
}

export const AVATAR_COLORS = [
  '#1a73e8',
  '#ea4335',
  '#34a853',
  '#f29900',
  '#9334e6',
  '#12b5cb',
  '#e52592',
  '#00897b',
  '#5c6bc0',
  '#8e24aa',
];

export function getAvatarColor(str?: string): string {
  if (!str) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
}

export * from './image';

