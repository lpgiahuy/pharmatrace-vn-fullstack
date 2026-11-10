'use client';

import React from 'react';
import {
  ClockCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  RollbackOutlined,
  CarOutlined,
  InboxOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { ShippingStatus, CodSettlementStatus } from '@/services/logistics.service';
import { cn } from '@/utils';

export const SHIPPING_STATUS_MAP: Record<
  ShippingStatus,
  { label: string; textColor: string; icon: React.ReactNode }
> = {
  PENDING_PICKUP: {
    label: 'Pending Pickup',
    textColor: 'text-slate-600',
    icon: <ClockCircleOutlined className="text-slate-500" />,
  },
  PICKED_UP: {
    label: 'Picked Up',
    textColor: 'text-blue-600',
    icon: <InboxOutlined className="text-blue-500" />,
  },
  IN_TRANSIT: {
    label: 'In Transit',
    textColor: 'text-blue-600',
    icon: <CarOutlined className="text-blue-500" />,
  },
  DELIVERED: {
    label: 'Delivered',
    textColor: 'text-emerald-600',
    icon: <CheckCircleOutlined className="text-emerald-500" />,
  },
  DELIVERY_FAILED: {
    label: 'Delivery Failed',
    textColor: 'text-rose-600',
    icon: <CloseCircleOutlined className="text-rose-500" />,
  },
  RETURN_REQUESTED: {
    label: 'Return Requested',
    textColor: 'text-amber-600',
    icon: <RollbackOutlined className="text-amber-500" />,
  },
  RETURN_IN_TRANSIT: {
    label: 'Return In Transit',
    textColor: 'text-orange-600',
    icon: <SyncOutlined spin className="text-orange-500" />,
  },
  RETURNED_TO_WAREHOUSE: {
    label: 'Returned to Warehouse',
    textColor: 'text-purple-600',
    icon: <InboxOutlined className="text-purple-500" />,
  },
};

export const ShippingStatusBadge: React.FC<{ status?: string | null; className?: string }> = ({
  status,
  className,
}) => {
  if (!status) return <span className="text-xs text-slate-400">Unknown</span>;
  const info = SHIPPING_STATUS_MAP[status as ShippingStatus] || {
    label: status,
    textColor: 'text-slate-600',
    icon: null,
  };
  return (
    <span
      role="status"
      className={cn(
        'inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium whitespace-nowrap bg-transparent border-0 p-0',
        info.textColor,
        className
      )}
    >
      <span className="shrink-0 text-xs sm:text-sm">{info.icon}</span>
      <span>{info.label}</span>
    </span>
  );
};

export const CodStatusBadge: React.FC<{
  status?: CodSettlementStatus | string | null;
  className?: string;
}> = ({ status, className }) => {
  if (status === 'DISCREPANCY_PENDING') return <span role="status" className={cn('text-rose-600 text-xs font-semibold', className)}>Discrepancy pending</span>;
  if (status === 'SETTLED') {
    return (
      <span
        role="status"
        className={cn(
          'inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold whitespace-nowrap bg-transparent border-0 p-0 text-emerald-600',
          className
        )}
      >
        <CheckCircleOutlined className="text-emerald-500 shrink-0" />
        <span>Settled</span>
      </span>
    );
  }
  return (
    <span
      role="status"
      className={cn(
        'inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold whitespace-nowrap bg-transparent border-0 p-0 text-amber-600',
        className
      )}
    >
      <ClockCircleOutlined className="text-amber-500 shrink-0" />
      <span>Unsettled</span>
    </span>
  );
};

export const TRANSFER_STATUS_MAP: Record<
  string,
  { label: string; textColor: string; icon: React.ReactNode }
> = {
  REQUESTED: {
    label: 'Requested',
    textColor: 'text-amber-600',
    icon: <ClockCircleOutlined className="text-amber-500" />,
  },
  DISPATCHED: {
    label: 'Dispatched',
    textColor: 'text-blue-600',
    icon: <CarOutlined className="text-blue-500" />,
  },
  RECEIVED: {
    label: 'Received',
    textColor: 'text-emerald-600',
    icon: <CheckCircleOutlined className="text-emerald-500" />,
  },
  CANCELLED: {
    label: 'Cancelled',
    textColor: 'text-slate-500',
    icon: <CloseCircleOutlined className="text-slate-400" />,
  },
  REPLACED: {
    label: 'Discrepancy resolved',
    textColor: 'text-amber-600',
    icon: <SyncOutlined className="text-amber-500" />,
  },
  RECEIVED_WITH_DISCREPANCY: { label: 'Received with discrepancy', textColor: 'text-rose-600', icon: <ExclamationCircleOutlined /> },
  RETURN_REQUESTED: { label: 'Return requested', textColor: 'text-amber-600', icon: <RollbackOutlined /> },
  RETURNED_TO_SOURCE: { label: 'Returned to source', textColor: 'text-slate-600', icon: <InboxOutlined /> },
  REJECTED_UNFULFILLED: {
    label: 'Damaged - Unfulfilled',
    textColor: 'text-rose-600',
    icon: <ExclamationCircleOutlined className="text-rose-500" />,
  },
};

export const TransferStatusBadge: React.FC<{ status?: string | null; className?: string }> = ({
  status,
  className,
}) => {
  if (!status) return <span className="text-xs text-slate-400">Unknown</span>;
  const info = TRANSFER_STATUS_MAP[status] || {
    label: status,
    textColor: 'text-slate-600',
    icon: null,
  };
  return (
    <span
      role="status"
      className={cn(
        'inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium whitespace-nowrap bg-transparent border-0 p-0',
        info.textColor,
        className
      )}
    >
      <span className="shrink-0 text-xs sm:text-sm">{info.icon}</span>
      <span>{info.label}</span>
    </span>
  );
};
