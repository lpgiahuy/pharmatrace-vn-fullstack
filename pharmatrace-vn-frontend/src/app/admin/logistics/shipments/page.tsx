'use client';

import { ShipmentFilters } from '@/components/logistics/ShipmentFilters';
import { emptyShipmentFilters, shipmentQuery } from '@/utils/shipment-query';
import { useLogisticsList } from '@/hooks/useLogisticsList';
import { LogisticsHistory } from '@/components/logistics/LogisticsHistory';
import { RecordCards } from '@/components/logistics/RecordCards';
import { useHydrated } from '@/hooks/useHydrated';
import React, { useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Table,
  Select,
  Input,
  DatePicker,
  Button,
  Drawer,
  Modal,
  Alert,
  App,
  Empty,
  Spin,
  Descriptions,
} from 'antd';
import {
  ReloadOutlined,
  EyeOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  RollbackOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  logisticsService,
  CARRIER_OPTIONS,
  Shipment,
  ShippingStatus,
} from '@/services/logistics.service';
import {
  ShippingStatusBadge,
  CodStatusBadge,
  SHIPPING_STATUS_MAP,
} from '@/components/logistics/LogisticsBadges';
import { ShipmentWorkflowActions } from '@/components/logistics/WorkflowActions';
import { formatCurrency, formatDateTime } from '@/utils';
import { useAuthStore } from '@/store/useAuthStore';
import { workflowErrorMessage } from '@/utils/workflow-error';

const { TextArea } = Input;

const TRANSITION_CONFIG: Record<
  string,
  { nextStatuses: ShippingStatus[]; labels?: Record<string, string> }
> = {
  PENDING_PICKUP: {
    nextStatuses: ['PICKED_UP'],
    labels: { PICKED_UP: 'Confirm Picked Up' },
  },
  PICKED_UP: {
    nextStatuses: ['IN_TRANSIT', 'DELIVERY_FAILED'],
    labels: {
      IN_TRANSIT: 'Dispatch for Delivery',
      DELIVERY_FAILED: 'Report Delivery Failed',
    },
  },
  IN_TRANSIT: {
    nextStatuses: ['DELIVERY_FAILED'],
    labels: {
      DELIVERED: 'Confirm Delivered',
      DELIVERY_FAILED: 'Report Delivery Failed',
    },
  },
  DELIVERY_FAILED: {
    nextStatuses: ['IN_TRANSIT'],
    labels: { IN_TRANSIT: 'Re-attempt Delivery' },
  },
  RETURN_REQUESTED: {
    nextStatuses: ['RETURN_IN_TRANSIT'],
    labels: { RETURN_IN_TRANSIT: 'Start Return In Transit' },
  },
  RETURN_IN_TRANSIT: {
    nextStatuses: [],
    labels: { RETURNED_TO_WAREHOUSE: 'Confirm Returned to Warehouse' },
  },
};


export default function ShipmentsManagementPage() {
  const { message, modal } = App.useApp();
  const getUser = useAuthStore((state) => state.getUser);
  const mounted = useHydrated();

  const [filters, setFilters] = useState(emptyShipmentFilters);
  const [page, setPage] = useState(1);

  // Detail Drawer state
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  // Modals for actions
  const [actionLoading, setActionLoading] = useState(false);
  const [failModalOpen, setFailModalOpen] = useState(false);
  const [failReason, setFailReason] = useState('');
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [carrierModalOpen, setCarrierModalOpen] = useState(false);
  const [carrierName, setCarrierName] = useState('');
  const [otherCarrierName, setOtherCarrierName] = useState('');
  const [carrierTracking, setCarrierTracking] = useState('');
  const [eventTime, setEventTime] = useState<dayjs.Dayjs | null>(null);

  const saveCarrier = async () => {
    const chosenCarrier = carrierName === '__OTHER__' ? otherCarrierName.trim() : carrierName;
    if (!selectedShipment || !chosenCarrier.trim() || !carrierTracking.trim()) {
      message.error('Choose a carrier and enter its tracking number');
      return;
    }
    setActionLoading(true);
    try {
      const res = await logisticsService.updateCarrier(selectedShipment.id, chosenCarrier.trim(), carrierTracking.trim());
      setSelectedShipment(res.data);
      setCarrierModalOpen(false);
      fetchShipments();
      message.success('Carrier tracking confirmed');
    } catch (error: unknown) {
      message.error(workflowErrorMessage(error, 'Unable to save carrier tracking'));
    } finally { setActionLoading(false); }
  };

  const user = mounted ? getUser() : null;
  const role = (user?.role || '').toUpperCase().replace(/[\s_-]/g, '');
  const canUpdateStatus = role === 'SUPERADMIN' || role === 'STOREMANAGER' || role === 'PHARMACIST';

  const loadList = useCallback(() => logisticsService.getShipments(shipmentQuery(page, filters)), [page, filters]);
  const { result, loading, reload: fetchShipments } = useLogisticsList(loadList, 'Unable to load shipments');
  const data = result?.data || [];
  const total = result?.pagination?.total || 0;

  const loadShipmentDetail = async (id: number) => {
    setDetailLoading(true);
    try {
      const res = await logisticsService.getShipment(id);
      setSelectedShipment(res.data);
      setDrawerOpen(true);
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || 'Unable to load shipment details';
      message.error(msg);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleStatusChange = async (targetStatus: ShippingStatus, reason?: string) => {
    if (!selectedShipment) return;
    setActionLoading(true);
    try {
      await logisticsService.updateShipmentStatus(selectedShipment.id, targetStatus, reason, eventTime?.toISOString());
      message.success(`Shipment updated successfully: ${SHIPPING_STATUS_MAP[targetStatus]?.label || targetStatus}`);
      setFailModalOpen(false);
      setFailReason('');
      setEventTime(null);
      await loadShipmentDetail(selectedShipment.id);
      fetchShipments();
    } catch (err: unknown) {
      const errMsg = (err as { message?: string })?.message || 'Failed to update status';
      message.error(errMsg);
      if (errMsg.includes('changed') || errMsg.includes('retry')) {
        await loadShipmentDetail(selectedShipment.id);
        fetchShipments();
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleRequestReturn = async () => {
    if (!selectedShipment) return;
    if (!returnReason.trim()) {
      message.error('Please enter a return reason');
      return;
    }
    setActionLoading(true);
    try {
      await logisticsService.requestReturnShipment(selectedShipment.id, returnReason);
      message.success('Return request submitted successfully');
      setReturnModalOpen(false);
      setReturnReason('');
      await loadShipmentDetail(selectedShipment.id);
      fetchShipments();
    } catch (err: unknown) {
      const errMsg = (err as { message?: string })?.message || 'Failed to submit return request';
      message.error(errMsg);
      if (errMsg.includes('changed')) {
        await loadShipmentDetail(selectedShipment.id);
        fetchShipments();
      }
    } finally {
      setActionLoading(false);
    }
  };

  const currentTransitions = selectedShipment
    ? TRANSITION_CONFIG[selectedShipment.shipping_status]?.nextStatuses || []
    : [];
  const transitionLabels = selectedShipment
    ? TRANSITION_CONFIG[selectedShipment.shipping_status]?.labels || {}
    : {};
  const canRequestReturn =
    selectedShipment &&
    canUpdateStatus &&
    selectedShipment.shipping_status === 'DELIVERY_FAILED';

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
          {!row.carrier_confirmed_at && row.shipping_status === 'PENDING_PICKUP' && (
            <span className="text-xs text-slate-500 block">Internal reference</span>
          )}
          <span className="text-xs text-slate-500 block">
            {row.carrier_confirmed_at ? row.courier_name : row.shipping_status === 'PENDING_PICKUP'
              ? 'Carrier not confirmed'
              : `${row.courier_name} (historical, unverified)`}
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
      title: 'Shipping Status',
      key: 'status',
      width: 200,
      render: (_: unknown, row: Shipment) => (
        <ShippingStatusBadge status={row.shipping_status} />
      ),
    },
    {
      title: 'COD Amount',
      key: 'cod',
      width: 140,
      render: (_: unknown, row: Shipment) => {
        const codNum = Number(row.cod_amount) || 0;
        return (
          <div className="space-y-0.5">
            <div className="font-semibold text-slate-900 text-xs sm:text-sm tabular-nums">
              {codNum > 0 ? formatCurrency(codNum) : <span className="text-slate-400 font-normal">No COD</span>}
            </div>
            {codNum > 0 && <CodStatusBadge status={row.cod_settlement_status} />}
          </div>
        );
      },
    },
    {
      title: 'Created At',
      key: 'dates',
      width: 160,
      render: (_: unknown, row: Shipment) => (
        <div className="text-xs text-slate-600 space-y-0.5">
          <div>{formatDateTime(row.created_at)}</div>
          {row.actual_delivery_at && (
            <div className="text-emerald-700 font-medium">Delivered: {formatDateTime(row.actual_delivery_at)}</div>
          )}
        </div>
      ),
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
          type="link"
          icon={<EyeOutlined />}
          onClick={() => loadShipmentDetail(row.id)}
          className="text-[#004996]! font-medium! text-xs sm:text-sm"
        >
          Details
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      {/* Compact Filter Toolbar with single Filter button */}
      <div className="bg-white p-2.5 sm:p-3 rounded-md border border-gray-200 flex flex-wrap items-center justify-between gap-2">
        <ShipmentFilters value={filters} onChange={(next, resetPage) => { setFilters(next); if (resetPage) setPage(1); }} />

        <Button
          icon={<ReloadOutlined />}
          onClick={fetchShipments}
          loading={loading}
          className="text-slate-600 hover:text-slate-900"
        >
          Refresh
        </Button>
      </div>

      {/* Phones: one card per shipment instead of a horizontally scrolling table */}
      <RecordCards
        items={data}
        loading={loading}
        emptyText="No shipments match current filters"
        page={page}
        total={total}
        pageSize={20}
        onPageChange={setPage}
        toCard={(row) => {
          const codNum = Number(row.cod_amount) || 0;
          return {
            key: row.id,
            title: row.tracking_number,
            subtitle: row.carrier_confirmed_at ? row.courier_name : row.shipping_status === 'PENDING_PICKUP'
              ? 'Carrier not confirmed'
              : `${row.courier_name} (historical, unverified)`,
            badge: <ShippingStatusBadge status={row.shipping_status} />,
            fields: [
              { label: 'Order', value: <Link href={`/admin/orders/${row.order_id}`} className="font-mono text-sm font-semibold text-[#004996] hover:underline">#{row.orders?.order_code || row.order_id}</Link> },
              { label: 'COD', value: <div className="space-y-0.5">
                <div className="text-sm font-semibold tabular-nums text-slate-900">{codNum > 0 ? formatCurrency(codNum) : <span className="font-normal text-slate-400">No COD</span>}</div>
                {codNum > 0 && <CodStatusBadge status={row.cod_settlement_status} />}
              </div> },
              { label: 'Created', wide: true, value: <>{formatDateTime(row.created_at)}{row.actual_delivery_at && <span className="ml-2 font-medium text-emerald-700">Delivered {formatDateTime(row.actual_delivery_at)}</span>}</> },
            ],
            onAction: () => loadShipmentDetail(row.id),
          };
        }}
      />

      {/* Table Container */}
      <div className="hidden md:block bg-white rounded-md border border-gray-200 overflow-hidden">
        <Table
          dataSource={data}
          columns={columns}
          rowKey="id"
          loading={loading}
          scroll={{ x: 870 }}
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
                description="No shipments match current filters"
              />
            ),
          }}
          className="w-full text-xs sm:text-sm"
        />
      </div>



      {/* Shipment Detail Drawer */}
      <Drawer
        title={
          <div className="flex items-center justify-between pr-4">
            <span className="font-bold text-slate-900 text-sm sm:text-base">
              Shipment #{selectedShipment?.tracking_number}
            </span>
            {selectedShipment && <ShippingStatusBadge status={selectedShipment.shipping_status} />}
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
            {!canUpdateStatus && (
              <Alert
                type="info"
                showIcon
                title="Warehouse operations"
                description="Warehouse staff can receive physical returns into quarantine. Delivery updates and QA require Store Manager or Pharmacist roles."
              />
            )}

            {selectedShipment.shipping_status === 'DELIVERED' && <Alert type="info" showIcon
              title="Customer returns are managed through RMA"
              description={<>The delivery history is preserved. A customer return must be approved before arranging its transport. <Link href="/admin/returns" className="font-semibold">Open Returns &amp; Exchanges</Link></>} />}
            {canUpdateStatus && selectedShipment.shipping_status === 'PENDING_PICKUP' && <div className="space-y-2">
              {!selectedShipment.carrier_confirmed_at && <Alert type="warning" showIcon title="Confirm the carrier tracking before pickup"
                description="The reference created during packing is not a confirmed carrier booking." />}
              <Button onClick={() => {
                const current = selectedShipment.carrier_confirmed_at ? selectedShipment.courier_name : '';
                const known = CARRIER_OPTIONS.some(option => option.value === current);
                setCarrierName(current && !known ? '__OTHER__' : current);
                setOtherCarrierName(current && !known ? current : '');
                setCarrierTracking(selectedShipment.carrier_confirmed_at ? selectedShipment.tracking_number : '');
                setCarrierModalOpen(true);
              }}>Set carrier and tracking number</Button>
            </div>}
            {/* General Info */}
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
                  <span className="font-medium text-slate-800">
                    {selectedShipment.carrier_confirmed_at ? selectedShipment.courier_name : selectedShipment.shipping_status === 'PENDING_PICKUP'
                      ? 'Carrier not confirmed'
                      : `${selectedShipment.courier_name} (historical, unverified)`}
                  </span>
                </Descriptions.Item>
                <Descriptions.Item label="COD Amount">
                  <div className="flex items-center gap-2">
                    <strong className="text-slate-900 font-bold tabular-nums">
                      {formatCurrency(Number(selectedShipment.cod_amount) || 0)}
                    </strong>
                    {Number(selectedShipment.cod_amount) > 0 && (
                      <CodStatusBadge status={selectedShipment.cod_settlement_status} />
                    )}
                  </div>
                </Descriptions.Item>
                <Descriptions.Item label="Created At">
                  {formatDateTime(selectedShipment.created_at)}
                </Descriptions.Item>
                {selectedShipment.picked_up_at && (
                  <Descriptions.Item label="Picked Up At">
                    {formatDateTime(selectedShipment.picked_up_at)}
                  </Descriptions.Item>
                )}
                {selectedShipment.actual_delivery_at && (
                  <Descriptions.Item label="Delivered At">
                    <span className="text-emerald-700 font-semibold">
                      {formatDateTime(selectedShipment.actual_delivery_at)}
                    </span>
                  </Descriptions.Item>
                )}
                {selectedShipment.note && (
                  <Descriptions.Item label="Note">
                    <span className="text-slate-700 italic">{selectedShipment.note}</span>
                  </Descriptions.Item>
                )}
              </Descriptions>
            </div>

            <ShipmentWorkflowActions key={selectedShipment.id} shipment={selectedShipment} canManage={canUpdateStatus} canIntake={['SUPERADMIN', 'STOREMANAGER', 'WAREHOUSESTAFF'].includes(role)} canRefund={['SUPERADMIN', 'STOREMANAGER'].includes(role)} onSaved={async () => { await loadShipmentDetail(selectedShipment.id); fetchShipments(); }} />

            {/* Status Change Operations */}
            {canUpdateStatus && (
              <div className="bg-white p-3.5 rounded-md border border-slate-200 space-y-2.5">
                <h3 className="text-xs sm:text-sm font-bold text-slate-900 m-0">Available Status Actions</h3>
                {selectedShipment.shipping_status === 'IN_TRANSIT' && <p className="text-xs text-slate-600">Waiting for the customer to confirm receipt in their order history.</p>}
                <label className="block text-xs text-slate-600" htmlFor="shipment-event-time">Actual event time (leave empty to use now)</label>
                <DatePicker id="shipment-event-time" showTime className="w-full" value={eventTime} onChange={setEventTime}
                  disabledDate={date => date.isAfter(dayjs(), 'day')} />

                <div className="flex flex-wrap gap-2 pt-3">
                  {/* Standard Next FSM Transitions */}
                  {currentTransitions.map((nextSt) => {
                    const cfg = SHIPPING_STATUS_MAP[nextSt];
                    const actionLabel = transitionLabels[nextSt] || cfg?.label || nextSt;
                    if (nextSt === 'DELIVERY_FAILED') {
                      return (
                        <Button
                          key={nextSt}
                          danger
                          icon={<CloseCircleOutlined />}
                          onClick={() => setFailModalOpen(true)}
                          loading={actionLoading}
                          size="small"
                        >
                          Report Delivery Failed...
                        </Button>
                      );
                    }
                    return (
                      <Button
                        key={nextSt}
                        type="primary"
                        icon={<CheckCircleOutlined />}
                        className="shipment-confirm-btn"
                        size="small"
                        onClick={() => {
                          modal.confirm({
                            title: `Change status to "${actionLabel}"?`,
                            content: 'The system will update shipping progress and log the event history.',
                            okText: 'Confirm',
                            okButtonProps: { style: { background: '#059669', borderColor: '#059669' } },
                            cancelText: 'Cancel',
                            onOk: () => handleStatusChange(nextSt),
                          });
                        }}
                        loading={actionLoading}
                        disabled={nextSt === 'PICKED_UP' && !selectedShipment.carrier_confirmed_at}
                      >
                        {actionLabel}
                      </Button>
                    );
                  })}

                  {/* Failed-delivery return; customer returns are owned by RMA. */}
                  {canRequestReturn && (
                    <Button
                      danger
                      icon={<RollbackOutlined />}
                      onClick={() => setReturnModalOpen(true)}
                      loading={actionLoading}
                      size="small"
                    >
                      Request Return
                    </Button>
                  )}

                  {currentTransitions.length === 0 && !canRequestReturn && (
                    <span className="text-xs text-slate-500 italic">
                      Shipment has reached terminal state ({SHIPPING_STATUS_MAP[selectedShipment.shipping_status]?.label || selectedShipment.shipping_status}).
                    </span>
                  )}
                </div>
              </div>
            )}

            <LogisticsHistory events={selectedShipment.history} />
          </div>
        ) : null}
      </Drawer>

      {/* Modal Delivery Failed */}
      <Modal
        title="Record Delivery Failure"
        open={failModalOpen}
        onOk={() => {
          if (!failReason.trim()) {
            message.error('Please enter a delivery failure reason!');
            return;
          }
          handleStatusChange('DELIVERY_FAILED', failReason);
        }}
        onCancel={() => {
          setFailModalOpen(false);
          setFailReason('');
          setEventTime(null);
        }}
        confirmLoading={actionLoading}
        okText="Confirm Failure"
        okButtonProps={{ danger: true }}
        cancelText="Cancel"
      >
        <div className="space-y-2.5 py-2">
          <p className="text-xs sm:text-sm text-slate-600 m-0">
            A failure reason is strictly required (e.g. recipient unreachable, rescheduled delivery, incorrect address):
          </p>
          <TextArea
            rows={3}
            placeholder="Enter reason for failed delivery..."
            value={failReason}
            onChange={(e) => setFailReason(e.target.value)}
            maxLength={500}
            showCount
          />
        </div>
      </Modal>

      {/* Modal Request Return */}
      <Modal
        title="Request Shipment Return to Warehouse"
        open={returnModalOpen}
        onOk={handleRequestReturn}
        onCancel={() => {
          setReturnModalOpen(false);
          setReturnReason('');
        }}
        confirmLoading={actionLoading}
        okText="Submit Return"
        okButtonProps={{ danger: true }}
        cancelText="Cancel"
      >
        <div className="space-y-2.5 py-2">
          <p className="text-xs sm:text-sm text-slate-600 m-0">
            Arrange a return after a failed delivery. Enter the reason and carrier reference if available:
          </p>
          <TextArea
            rows={3}
            placeholder="Enter return reason..."
            value={returnReason}
            onChange={(e) => setReturnReason(e.target.value)}
            maxLength={500}
            showCount
          />
        </div>
      </Modal>
      <Modal title="Carrier tracking" open={carrierModalOpen} onCancel={() => setCarrierModalOpen(false)}
        onOk={saveCarrier} confirmLoading={actionLoading} okText="Confirm carrier tracking">
        <div className="space-y-3 py-2">
          <label className="block text-sm" htmlFor="shipment-carrier">Carrier (required)</label>
          <Select id="shipment-carrier" className="w-full" options={[...CARRIER_OPTIONS, { value: '__OTHER__', label: 'Other carrier' }]}
            value={carrierName || undefined} onChange={setCarrierName} placeholder="Select a carrier" showSearch optionFilterProp="label" />
          {carrierName === '__OTHER__' && <>
            <label className="block text-sm" htmlFor="shipment-other-carrier">Other carrier name (required)</label>
            <Input id="shipment-other-carrier" value={otherCarrierName} onChange={e => setOtherCarrierName(e.target.value)} maxLength={100} />
          </>}
          <label className="block text-sm" htmlFor="shipment-tracking">Carrier tracking number (required)</label>
          <Input id="shipment-tracking" value={carrierTracking} onChange={e => setCarrierTracking(e.target.value)} maxLength={50} placeholder="Tracking number issued by the carrier" />
          <p className="text-xs text-slate-600">Enter the tracking number issued by the selected carrier. For local testing, select Other carrier and use a test name and code.</p>
        </div>
      </Modal>
    </div>
  );
}
