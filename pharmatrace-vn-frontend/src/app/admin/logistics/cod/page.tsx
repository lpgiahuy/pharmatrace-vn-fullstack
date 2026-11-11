'use client';

import { ShipmentFilters } from '@/components/logistics/ShipmentFilters';
import { emptyShipmentFilters, shipmentQuery } from '@/utils/shipment-query';
import { useLogisticsList } from '@/hooks/useLogisticsList';
import { RecordCards } from '@/components/logistics/RecordCards';
import { useHydrated } from '@/hooks/useHydrated';
import React, { useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Table,
  Button,
  Drawer,
  Alert,
  App,
  Empty,
  Spin,
  Descriptions,
  Tooltip,
} from 'antd';
import {
  DollarOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  EyeOutlined,
  LockOutlined,
} from '@ant-design/icons';
import {
  logisticsService,
  canCollectShipmentCod,
  Shipment,
} from '@/services/logistics.service';
import {
  ShippingStatusBadge,
  CodStatusBadge,
} from '@/components/logistics/LogisticsBadges';
import { CodReconciliation } from '@/components/logistics/WorkflowActions';
import { formatCurrency, formatDateTime } from '@/utils';
import { useAuthStore } from '@/store/useAuthStore';
import { codPermissions } from '@/utils/cod-workflow';



export default function CodManagementPage() {
  const { message } = App.useApp();
  const getUser = useAuthStore((state) => state.getUser);
  const mounted = useHydrated();

  const [filters, setFilters] = useState(emptyShipmentFilters);
  const [page, setPage] = useState(1);

  // Detail Drawer state
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const user = mounted ? getUser() : null;
  const { canView: canAccessCod, canSubmit, canApprove } = codPermissions(user?.role);

  const loadList = useCallback(() => logisticsService.getCodShipments(shipmentQuery(page, filters)), [page, filters]);
  const { result, loading, reload: fetchCodData } = useLogisticsList(loadList, 'Unable to load COD shipments', canAccessCod);
  const data = result?.data || [];
  const total = result?.pagination?.total || 0;
  const summary = result?.summary || [];

  const loadCodDetail = async (id: number) => {
    setDetailLoading(true);
    try {
      const res = await logisticsService.getCodShipment(id);
      setSelectedShipment(res.data);
      setDrawerOpen(true);
    } catch (err: unknown) {
      message.error((err as { message?: string })?.message || 'Unable to load COD settlement details');
    } finally {
      setDetailLoading(false);
    }
  };

  // Compute summary stats from API summary
  const unsettledStats = summary.filter(s => s.cod_settlement_status !== 'SETTLED');
  const settledStat = summary.find((s) => s.cod_settlement_status === 'SETTLED');

  const unsettledCount = unsettledStats.reduce((sum, item) => sum + item._count._all, 0);
  const unsettledAmount = unsettledStats.reduce((sum, item) => sum + (Number(item._sum.cod_amount) || 0), 0);

  const settledCount = settledStat?._count?._all || 0;
  const settledAmount = Number(settledStat?._sum?.cod_amount) || 0;

  if (mounted && !canAccessCod) {
    return (
      <div className="bg-white p-8 rounded-md border border-gray-200 text-center space-y-3">
        <LockOutlined className="text-3xl text-amber-500" />
        <h2 className="text-base font-bold text-slate-800 m-0">Access Restricted</h2>
        <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto m-0">
          COD management is available to store managers, finance staff and super administrators.
        </p>
        <Link href="/admin/logistics/shipments">
          <Button type="primary" className="bg-[#004996]!" size="small">
            Back to Shipments
          </Button>
        </Link>
      </div>
    );
  }

  const columns = [
    {
      title: 'Tracking Number',
      key: 'tracking',
      width: 170,
      render: (_: unknown, row: Shipment) => (
        <div className="space-y-0.5">
          <span className="font-mono font-semibold text-slate-900 text-xs sm:text-sm block">
            {row.tracking_number}
          </span>
          <span className="text-xs text-slate-500 block">
            {row.courier_name}
          </span>
        </div>
      ),
    },
    {
      title: 'Order',
      key: 'order',
      width: 110,
      render: (_: unknown, row: Shipment) => (
        <Link
          href={`/admin/orders/${row.order_id}`}
          className="font-mono text-xs sm:text-sm font-semibold text-[#004996] hover:underline"
        >
          #{row.orders?.order_code || row.order_id}
        </Link>
      ),
    },
    {
      title: 'COD Amount',
      key: 'amount',
      width: 140,
      render: (_: unknown, row: Shipment) => (
        <strong className="text-xs sm:text-sm font-bold text-slate-900 block tabular-nums">
          {formatCurrency(Number(row.cod_amount) || 0)}
        </strong>
      ),
    },
    {
      title: 'Shipping Progress',
      key: 'shipping_status',
      width: 140,
      render: (_: unknown, row: Shipment) => (
        <ShippingStatusBadge status={row.shipping_status} />
      ),
    },
    {
      title: 'Settlement Status',
      key: 'cod_status',
      width: 160,
      render: (_: unknown, row: Shipment) => {
        const isSettled = row.cod_settlement_status === 'SETTLED';
        const canCollect = canCollectShipmentCod(row);

        if (isSettled) {
          return (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
              <CheckCircleOutlined className="text-emerald-500 flex-shrink-0" />
              <span>Settled</span>
            </span>
          );
        }

        if (canCollect) {
          return (
            <Tooltip title="View the carrier statement and settlement details">
              <button
                type="button"
                onClick={() => loadCodDetail(row.id)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-600 hover:text-amber-700 bg-transparent border-0 p-0 cursor-pointer transition-colors"
              >
                <DollarOutlined className="text-amber-500 flex-shrink-0" />
                <span>{row.cod_settlement_status === 'DISCREPANCY_PENDING' ? 'Review discrepancy' : 'View statement'}</span>
              </button>
            </Tooltip>
          );
        }

        if (row.shipping_status === 'RETURNED_TO_WAREHOUSE' || row.shipping_status === 'DELIVERY_FAILED') {
          return (
            <span className="inline-flex items-center gap-1.5 text-xs text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded">
              Returned (Uncollected)
            </span>
          );
        }

        return (
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <ClockCircleOutlined className="text-slate-400 flex-shrink-0" />
            <span>Awaiting Delivery</span>
          </span>
        );
      },
    },
    {
      title: 'Action',
      key: 'action',
      width: 90,
      align: 'center' as const,
      fixed: 'right' as const,
      render: (_: unknown, row: Shipment) => (
        <Button
          size="small"
          icon={<EyeOutlined />}
          loading={detailLoading && selectedShipment?.id === row.id}
          onClick={() => loadCodDetail(row.id)}
          className="text-xs font-medium text-slate-700"
        >
          Details
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      {/* 3 Metric Cards for COD Reconciliation */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3">
        <div className="bg-white p-3 sm:p-3.5 rounded-md border border-gray-200">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Unsettled COD</span>
            <ClockCircleOutlined className="text-amber-500" />
          </div>
          <div className="text-lg sm:text-xl font-bold text-amber-600 mt-1 tabular-nums">
            {formatCurrency(unsettledAmount)}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            <strong>{unsettledCount}</strong> pending collection
          </div>
        </div>

        <div className="bg-white p-3 sm:p-3.5 rounded-md border border-gray-200">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Settled COD</span>
            <CheckCircleOutlined className="text-emerald-500" />
          </div>
          <div className="text-lg sm:text-xl font-bold text-emerald-600 mt-1 tabular-nums">
            {formatCurrency(settledAmount)}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            <strong>{settledCount}</strong> collected
          </div>
        </div>

        <div className="col-span-2 sm:col-span-1 bg-white p-3 sm:p-3.5 rounded-md border border-gray-200">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Total COD Volume</span>
            <DollarOutlined className="text-[#004996]" />
          </div>
          <div className="text-lg sm:text-xl font-bold text-slate-900 mt-1 tabular-nums">
            {formatCurrency(unsettledAmount + settledAmount)}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            <strong>{unsettledCount + settledCount}</strong> total shipments
          </div>
        </div>
      </div>

      {/* Compact Filter Toolbar with single Filter button */}
      <div className="bg-white p-2.5 sm:p-3 rounded-md border border-gray-200 flex flex-wrap items-center justify-between gap-2">
        <ShipmentFilters cod value={filters} onChange={(next, resetPage) => { setFilters(next); if (resetPage) setPage(1); }} />

        <Button
          icon={<ReloadOutlined />}
          onClick={fetchCodData}
          loading={loading}
          className="text-slate-600 hover:text-slate-900"
        >
          Refresh
        </Button>
      </div>

      {/* Phones: one card per COD shipment instead of a horizontally scrolling table */}
      <RecordCards
        items={data}
        loading={loading}
        emptyText="No COD shipments match current filters"
        page={page}
        total={total}
        pageSize={20}
        onPageChange={setPage}
        toCard={(row) => ({
          key: row.id,
          title: row.tracking_number,
          subtitle: row.courier_name,
          badge: <ShippingStatusBadge status={row.shipping_status} />,
          fields: [
            { label: 'Order', value: <Link href={`/admin/orders/${row.order_id}`} className="font-mono text-sm font-semibold text-[#004996] hover:underline">#{row.orders?.order_code || row.order_id}</Link> },
            { label: 'COD amount', value: <strong className="text-sm font-bold tabular-nums text-slate-900">{formatCurrency(Number(row.cod_amount) || 0)}</strong> },
            { label: 'Settlement', wide: true, value: <CodStatusBadge status={row.cod_settlement_status} /> },
          ],
          actionLoading: detailLoading && selectedShipment?.id === row.id,
          onAction: () => loadCodDetail(row.id),
        })}
      />

      {/* Table Container */}
      <div className="hidden md:block bg-white rounded-md border border-gray-200 overflow-hidden">
        <Table
          dataSource={data}
          columns={columns}
          rowKey="id"
          loading={loading}
          scroll={{ x: 850 }}
          pagination={{
            current: page,
            total,
            pageSize: 20,
            onChange: (p) => setPage(p),
            showSizeChanger: false,
            placement: ['bottomEnd'],
            itemRender: (_page, type, originalElement) => {
              if (type === 'prev') {
                return <span className="px-1 text-slate-600 text-xs font-medium cursor-pointer">&lt; Prev</span>;
              }
              if (type === 'next') {
                return <span className="px-1 text-[#004996] text-xs font-medium cursor-pointer">Next &gt;</span>;
              }
              return originalElement;
            },
          }}
          size="middle"
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No COD shipments match current filters"
              />
            ),
          }}
          className="w-full text-xs sm:text-sm"
        />
      </div>



      {/* Detail Drawer */}
      <Drawer
        title={
          <div className="flex items-center justify-between pr-4">
            <span className="font-bold text-slate-900 text-sm sm:text-base flex items-center gap-2">
              <DollarOutlined className="text-[#004996]" /> COD Settlement #{selectedShipment?.tracking_number}
            </span>
            {selectedShipment && <CodStatusBadge status={selectedShipment.cod_settlement_status} />}
          </div>
        }
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        size="large"
        styles={{ wrapper: { maxWidth: '100vw' }, body: { padding: 16 } }}
      >
        {detailLoading ? (
          <div className="flex justify-center py-20">
            <Spin size="large" />
          </div>
        ) : selectedShipment ? (
          <div className="space-y-5">
            <div className="bg-slate-50 p-3.5 rounded-md border border-slate-200">
              <Descriptions size="small" column={1} bordered={false}>
                <Descriptions.Item label="Linked Order">
                  <Link
                    href={`/admin/orders/${selectedShipment.order_id}`}
                    className="font-semibold text-[#004996] hover:underline"
                  >
                    View Order #{selectedShipment.orders?.order_code || selectedShipment.order_id} &rarr;
                  </Link>
                </Descriptions.Item>
                {selectedShipment.orders?.recipient_name && (
                  <Descriptions.Item label="Recipient">
                    <span className="font-medium text-slate-800">
                      {selectedShipment.orders.recipient_name}
                      {selectedShipment.orders.recipient_phone ? ` (${selectedShipment.orders.recipient_phone})` : ''}
                    </span>
                  </Descriptions.Item>
                )}
                {selectedShipment.orders?.shipping_address && (
                  <Descriptions.Item label="Shipping Address">
                    <span className="text-slate-700">{selectedShipment.orders.shipping_address}</span>
                  </Descriptions.Item>
                )}
                <Descriptions.Item label="Courier Name">
                  <span className="font-medium text-slate-800">{selectedShipment.courier_name}</span>
                </Descriptions.Item>
                <Descriptions.Item label="COD Amount">
                  <strong className="text-sm sm:text-base font-bold text-slate-900 tabular-nums">
                    {formatCurrency(Number(selectedShipment.cod_amount) || 0)}
                  </strong>
                </Descriptions.Item>
                <Descriptions.Item label="Shipping Progress">
                  <ShippingStatusBadge status={selectedShipment.shipping_status} />
                </Descriptions.Item>
                <Descriptions.Item label="Settlement Status">
                  <CodStatusBadge status={selectedShipment.cod_settlement_status} />
                </Descriptions.Item>
                {selectedShipment.cod_settled_at && (
                  <Descriptions.Item label="Settlement Time">
                    <span className="text-emerald-700 font-semibold">
                      {formatDateTime(selectedShipment.cod_settled_at)}
                    </span>
                  </Descriptions.Item>
                )}
              </Descriptions>
            </div>

            <CodReconciliation key={selectedShipment.id} shipment={selectedShipment} canSubmit={canSubmit} canApprove={canApprove} onSaved={async () => { await loadCodDetail(selectedShipment.id); fetchCodData(); }} />

            {selectedShipment.cod_settlement_status === 'UNSETTLED' && !canCollectShipmentCod(selectedShipment) && (
              <div className="pt-2 space-y-2">
                  <Alert
                    type="warning"
                    showIcon
                    title="Not Eligible for COD Collection"
                    description={`Current shipping status is "${selectedShipment.shipping_status}". COD can only be collected once the order has been delivered.`}
                  />
              </div>
            )}

            {/* Settlements History */}
            <div className="space-y-2">
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 m-0">Cashbook Settlement History</h3>
              {selectedShipment.settlements && selectedShipment.settlements.length > 0 ? (
                <div className="space-y-2">
                  {selectedShipment.settlements.map((st, idx) => (
                    <div
                      key={idx}
                      className="bg-white p-2.5 sm:p-3 rounded-md border border-slate-200 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-xs"
                    >
                      <div className="min-w-0 break-words">
                        <div className="font-semibold text-slate-800">
                          {st.cashbook_id ? `Cashbook Voucher #${st.cashbook_id}` : 'Pending discrepancy — no cashbook entry'}
                        </div>
                        <div className="text-slate-500 mt-0.5">Statement: {st.statement_reference || "Legacy collection"} | Fee: {formatCurrency(Number(st.courier_fee) || 0)} | Net: {formatCurrency(Number(st.net_amount ?? st.amount) || 0)}</div>
                        <div className="text-slate-400 mt-0.5">
                          Collected by: {st.collected_by} · {formatDateTime(st.collected_at)}
                        </div>
                      </div>
                      <div className="sm:text-right">
                        <strong className="text-emerald-700 font-bold text-xs sm:text-sm block tabular-nums">
                          +{formatCurrency(Number(st.amount) || 0)}
                        </strong>
                        <span className="text-[11px] text-slate-500">{st.cashbook_id ? "Credited to Cashbook" : st.discrepancy_status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 italic">
                  No cashbook settlement records found for this shipment yet.
                </p>
              )}
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
