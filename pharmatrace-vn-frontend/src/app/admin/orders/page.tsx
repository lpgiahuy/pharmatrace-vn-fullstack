'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Table, Select, Tag, App } from 'antd';
import {
  orderService,
  Order,
  getOrderItemCount,
} from '@/services/order.service';
import { OrderStatusBadge } from '@/components/ui/Badge';
import { formatCurrency, formatDateTime } from '@/utils';

const ORDER_STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Pending Confirmation' },
  { value: 'PROCESSING', label: 'Order Prepared / Processing' },
  { value: 'SHIPPING', label: 'In Transit' },
  { value: 'COMPLETED', label: 'Delivered' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'RETURNED', label: 'Returned' },
];

export default function AdminOrdersPage() {
  const router = useRouter();
  const { message } = App.useApp();

  const [data, setData] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>('');
  const [page, setPage] = useState(1);

  const fetchOrders = useCallback(() => {
    setLoading(true);
    orderService
      .getAll({ page, limit: 20, status: status || undefined })
      .then((res: any) => {
        if (res?.data) {
          setData(res.data);
          setTotal(res.pagination?.total ?? res.data.length);
        } else if (Array.isArray(res)) {
          setData(res);
          setTotal(res.length);
        }
      })
      .catch((err: any) => {
        message.error(err?.message || 'Failed to load orders');
      })
      .finally(() => setLoading(false));
  }, [page, status, message]);

  useEffect(() => {
    // Cancel pending work when dependencies change or the component unmounts.
    const timer = setTimeout(() => {
      fetchOrders();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchOrders]);

  const cols = [
    {
      title: 'Order ID',
      dataIndex: 'id',
      key: 'id',
      width: '10%',
      render: (v: any) => (
        <span className="font-mono text-sm font-semibold text-slate-900">
          #{v}
        </span>
      ),
    },
    {
      title: 'Order Date',
      dataIndex: 'createdAt',
      key: 'date',
      width: '18%',
      render: (v: string, row: Order) => (
        <span className="text-sm text-slate-600">
          {formatDateTime(v || (row as any).date)}
        </span>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'orderStatus',
      key: 'status',
      width: '22%',
      render: (v: string, row: Order) => (
        <OrderStatusBadge status={v || (row as any).status} />
      ),
    },
    {
      title: 'Items',
      key: 'items',
      width: '12%',
      render: (_: any, row: Order) => {
        const count = getOrderItemCount(row);
        return <span className="text-sm text-slate-700">{count} items</span>;
      },
    },
    {
      title: 'Total Amount',
      dataIndex: 'totalAmount',
      key: 'total',
      width: '16%',
      render: (v: number, row: Order) => (
        <strong className="text-sm font-bold text-slate-900">
          {formatCurrency(v ?? (row as any).total ?? 0)}
        </strong>
      ),
    },
    {
      title: 'Payment',
      dataIndex: 'paymentMethod',
      key: 'pay',
      width: '12%',
      render: (v: string) => (
        <Tag className="rounded-md uppercase font-mono text-xs px-2.5 py-0.5 border-slate-200 text-slate-700 bg-slate-50">
          {v ? v.toUpperCase() : 'COD'}
        </Tag>
      ),
    },
    {
      title: '',
      key: 'action',
      width: '10%',
      align: 'center' as const,
      render: (_: any, row: Order) => (
        <a
          onClick={() => router.push(`/admin/orders/${row.id}`)}
          className="text-brand-600 hover:text-brand-700 hover:underline text-sm font-medium cursor-pointer whitespace-nowrap"
        >
          View →
        </a>
      ),
    },
  ];

  return (
    <div className="space-y-4 font-sans w-full">
      <div>
        <h1 className="text-xl font-bold text-fg tracking-tight">
          Order Management
        </h1>
        <p className="text-fg-muted text-xs sm:text-sm mt-0.5 tabular-nums">{total} Orders</p>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-3 sm:p-4 rounded-md border border-gray-200 shadow-card">
        <div className="flex items-center gap-3">
          <Select
            value={status || undefined}
            onChange={(v) => {
              setStatus(v || '');
              setPage(1);
            }}
            placeholder="Filter by status"
            allowClear
            className="w-48 text-xs sm:text-sm"
            options={ORDER_STATUS_OPTIONS}
          />
        </div>
      </div>

      {/* Table Container with subtle light grey border */}
      <div className="bg-white rounded-md border border-gray-200 shadow-card overflow-hidden">
        <Table
          dataSource={data}
          columns={cols}
          rowKey="id"
          loading={loading}
          pagination={{
            placement: ['bottomEnd'],
            current: page,
            total,
            pageSize: 20,
            onChange: (p) => setPage(p),
            showSizeChanger: false,
            itemRender: (_page, type, originalElement) => {
              if (type === 'prev') {
                return <span className="px-1 text-fg-secondary text-xs font-medium">&lt; Prev</span>;
              }
              if (type === 'next') {
                return <span className="px-1 text-brand-600 text-xs font-medium">Next
                  &gt;</span>;
              }
              return originalElement;
            },
          }}
          size="middle"
          className="w-full text-sm"
        />
      </div>
    </div>
  );
}
