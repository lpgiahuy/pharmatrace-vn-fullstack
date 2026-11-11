import React from 'react';
import { cn } from '@/utils';

const colorMap: Record<string, string> = {
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  red: 'bg-rose-50 text-rose-700 border-rose-200',
  orange: 'bg-amber-50 text-amber-700 border-amber-200',
  purple: 'bg-purple-50 text-purple-700 border-purple-200',
  cyan: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  gray: 'bg-slate-100 text-slate-600 border-slate-200',
  yellow: 'bg-yellow-50 text-yellow-700 border-yellow-200',
};

export const Badge: React.FC<{
  color?: string;
  children: React.ReactNode;
  className?: string;
  dot?: boolean;
}> = ({ color = 'gray', children, className, dot = false }) => (
  <span
    role="status"
    className={cn(
      'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border',
      colorMap[color] || colorMap.gray,
      className,
    )}
  >
    {dot && (
      <span
        className={cn('w-1.5 h-1.5 rounded-full', {
          'bg-blue-500': color === 'blue',
          'bg-emerald-500': color === 'green',
          'bg-rose-500': color === 'red',
          'bg-amber-500': color === 'orange',
          'bg-slate-400': color === 'gray',
        })}
        aria-hidden="true"
      />
    )}
    {children}
  </span>
);

export const OrderStatusBadge: React.FC<{
  status?: string;
  className?: string;
}> = ({ status, className }) => {
  const norm = (status || '').trim().toUpperCase();
  let textColor = 'text-slate-600';
  let icon = '•';
  let label = status || 'Unknown';

  if (['PENDING'].includes(norm)) {
    textColor = 'text-amber-600';
    icon = '◷';
    label = 'Pending Confirmation';
  } else if (['WAITING_INTERNAL_TRANSFER', 'WAITING_TRANSFER'].includes(norm)) {
    textColor = 'text-cyan-700';
    icon = '⇄';
    label = 'Consolidating from Warehouses';
  } else if (['PROCESSING'].includes(norm)) {
    textColor = 'text-purple-600';
    icon = '◷';
    label = 'Order Prepared';
  } else if (norm === 'PENDING_PICKUP') {
    textColor = 'text-amber-600';
    icon = '◷';
    label = 'Awaiting Pickup';
  } else if (norm === 'PICKED_UP') {
    textColor = 'text-blue-600';
    icon = '◷';
    label = 'Handed to Carrier';
  } else if (['SHIPPING', 'IN_TRANSIT'].includes(norm)) {
    textColor = 'text-blue-600';
    icon = '◷';
    label = 'In Transit';
  } else if (['COMPLETED', 'DELIVERED'].includes(norm)) {
    textColor = 'text-emerald-600';
    icon = '✓';
    label = 'Delivered';
  } else if (['CANCELLED', 'CANCELED'].includes(norm)) {
    textColor = 'text-[#EF4444]';
    icon = '×';
    label = 'Cancelled';
  } else if (['RETURNED', 'PARTIALLY_RETURNED'].includes(norm)) {
    textColor = 'text-slate-500';
    icon = '↩';
    label = 'Returned';
  }

  return (
    <span
      role="status"
      className={cn(
        'inline-flex items-center gap-1.5 text-sm font-medium whitespace-nowrap bg-transparent border-0 p-0',
        textColor,
        className
      )}
    >
      <span className="font-semibold text-sm leading-none flex-shrink-0" aria-hidden="true">
        {icon}
      </span>
      <span>{label}</span>
    </span>
  );
};


