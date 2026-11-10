'use client';

import { useLogisticsList } from '@/hooks/useLogisticsList';
import { LogisticsHistory } from '@/components/logistics/LogisticsHistory';
import { useHydrated } from '@/hooks/useHydrated';
import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { TransferDiscrepancyResolution } from '@/components/logistics/TransferDiscrepancyResolution';
import {
  Table,
  Select,
  AutoComplete,
  Input,
  InputNumber,
  Button,
  Drawer,
  Modal,
  Alert,
  App,
  Empty,
  Spin,
  Tag,
} from 'antd';
import {
  SwapOutlined,
  ReloadOutlined,
  EyeOutlined,
  SendOutlined,
  RightOutlined,
  FilterOutlined,
} from '@ant-design/icons';
import {
  logisticsService,
  InternalTransfer,
  CARRIER_OPTIONS,
} from '@/services/logistics.service';
import {
  TransferStatusBadge,
  TRANSFER_STATUS_MAP,
} from '@/components/logistics/LogisticsBadges';
import { TransferInspection } from '@/components/logistics/WorkflowActions';
import { formatDateTime } from '@/utils';
import { useAuthStore } from '@/store/useAuthStore';
import { workflowErrorMessage } from '@/utils/workflow-error';


export default function InternalTransfersPage() {
  const { message, modal } = App.useApp();
  const getUser = useAuthStore((state) => state.getUser);
  const mounted = useHydrated();


  // Filters (supported by backend: orderId, status)
  const [status, setStatus] = useState<string>('');
  const [orderIdFilter, setOrderIdFilter] = useState<string>('');
  const [filterModalOpen, setFilterModalOpen] = useState(false);

  // Temporary filter state for modal
  const [tempStatus, setTempStatus] = useState<string>('');
  const [tempOrderId, setTempOrderId] = useState<string>('');

  // Detail Drawer state
  const [selectedTransfer, setSelectedTransfer] = useState<InternalTransfer | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  // Dispatch Modal state
  const [dispatchModalOpen, setDispatchModalOpen] = useState(false);
  const [trackingCodeInput, setTrackingCodeInput] = useState('');
  const [transportMode, setTransportMode] = useState<'INTERNAL' | 'THIRD_PARTY'>('INTERNAL');
  const [transportEmployeeId, setTransportEmployeeId] = useState<number>();
  const [carrierName, setCarrierName] = useState('');
  const [transportStaff, setTransportStaff] = useState<Array<{ id: number; full_name: string }>>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [manifestLines, setManifestLines] = useState<Record<number, { quantity: number; boxUids: string }>>({});

  const user = mounted ? getUser() : null;
  const role = (user?.role || '').toUpperCase().replace(/[\s_-]/g, '');
  const canOperateTransfers = role === 'SUPERADMIN' || role === 'STOREMANAGER' || role === 'WAREHOUSESTAFF';
  const canDispatch = canOperateTransfers && !!selectedTransfer && (role === 'SUPERADMIN' || user?.facilityId === selectedTransfer.from_facility_id);
  const canReceive = canOperateTransfers && !!selectedTransfer && (role === 'SUPERADMIN' || user?.facilityId === selectedTransfer.to_facility_id);

  const openDispatch = async () => {
    if (!selectedTransfer) return;
    setTransportMode('INTERNAL');
    setTransportEmployeeId(undefined);
    setCarrierName('');
    setTrackingCodeInput('');
    setTransportStaff([]);
    setManifestLines({});
    setDispatchModalOpen(true);
    setStaffLoading(true);
    try {
      const res = await logisticsService.getTransportStaff(selectedTransfer.id);
      setTransportStaff(res.data);
    } catch (error: unknown) {
      message.error(workflowErrorMessage(error, 'Unable to load source facility staff'));
    } finally { setStaffLoading(false); }
  };

  const loadList = useCallback(() => logisticsService.getTransfers(
    orderIdFilter.trim() ? Number(orderIdFilter.trim()) : undefined, status || undefined,
  ), [status, orderIdFilter]);
  const { result, loading, reload: fetchTransfers } = useLogisticsList(loadList, 'Unable to load internal transfers');
  const data = result?.data || [];

  const openFilterModal = () => {
    setTempStatus(status);
    setTempOrderId(orderIdFilter);
    setFilterModalOpen(true);
  };

  const applyFiltersFromModal = () => {
    setStatus(tempStatus);
    setOrderIdFilter(tempOrderId);
    setFilterModalOpen(false);
  };

  const resetFilters = () => {
    setStatus('');
    setOrderIdFilter('');
    setTempStatus('');
    setTempOrderId('');
  };

  const activeFilterCount = (status ? 1 : 0) + (orderIdFilter.trim() ? 1 : 0);
  const hasFilter = activeFilterCount > 0;

  const loadTransferDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    try {
      const res = await logisticsService.getTransfer(id);
      setSelectedTransfer(res.data);
      setDrawerOpen(true);
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || 'Unable to load transfer details';
      message.error(msg);
    } finally {
      setDetailLoading(false);
    }
  }, [message]);

  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get('transferId'));
    if (!Number.isSafeInteger(id) || id <= 0) return;
    const timer = setTimeout(() => { void loadTransferDetail(id); }, 0);
    return () => clearTimeout(timer);
  }, [loadTransferDetail]);

  const handleDispatch = async () => {
    if (!selectedTransfer) return;
    setActionLoading(true);
    try {
      if (transportMode === 'INTERNAL' && !transportEmployeeId) {
        message.error('Choose the employee responsible for transport');
        return;
      }
      if (transportMode === 'THIRD_PARTY' && (!carrierName.trim() || !trackingCodeInput.trim())) {
        message.error('Enter the carrier and its actual tracking number');
        return;
      }
      const manifest = selectedTransfer.items.map(item => ({ variantId: Number(item.variantId), quantity: manifestLines[Number(item.variantId)]?.quantity || 0,
        boxUids: (manifestLines[Number(item.variantId)]?.boxUids || '').split(/[\s,]+/).filter(Boolean) }));
      if (manifest.some((line, index) => line.quantity !== Number(selectedTransfer.items[index].quantity))) {
        message.error('Enter the actual quantity for every manifest line.');
        return;
      }
      await logisticsService.dispatchTransfer(selectedTransfer.id, transportMode === 'INTERNAL'
        ? { transportMode, transportEmployeeId, manifest }
        : { transportMode, courierName: carrierName.trim(), trackingCode: trackingCodeInput.trim(), manifest });
      message.success('Stock transfer dispatched successfully!');
      setDispatchModalOpen(false);
      setTrackingCodeInput('');
      await loadTransferDetail(selectedTransfer.id);
      fetchTransfers();
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || 'Failed to dispatch stock transfer';
      message.error(msg);
      if (msg.includes('approval') || msg.includes('prescript')) {
        modal.warning({
          title: 'Pharmacist Approval Required',
          content: 'This order contains prescription items that must be approved by a Pharmacist before dispatching.',
          okText: 'Understood',
        });
      }
    } finally {
      setActionLoading(false);
    }
  };




  const columns = [
    {
      title: 'Transfer Code',
      key: 'code',
      width: 160,
      render: (_: unknown, row: InternalTransfer) => (
        <div className="space-y-0.5">
          <span className="font-mono font-semibold text-slate-900 text-xs sm:text-sm block">
            {row.transfer_code}
          </span>
          {row.tracking_code ? (
            <span className="text-xs text-slate-500 font-mono block">
              Tracking: {row.tracking_code}
            </span>
          ) : (
            <span className="text-xs text-slate-400 block">
              {formatDateTime(row.created_at)}
            </span>
          )}
        </div>
      ),
    },
    {
      title: 'Order',
      key: 'order',
      width: 110,
      render: (_: unknown, row: InternalTransfer) => (
        <Link
          href={`/admin/orders/${row.order_id}`}
          className="font-mono text-xs sm:text-sm font-semibold text-[#004996] hover:underline"
        >
          #{row.order_id}
        </Link>
      ),
    },
    {
      title: 'Transfer Route',
      key: 'route',
      width: 240,
      render: (_: unknown, row: InternalTransfer) => (
        <div className="text-xs space-y-0.5">
          <div className="flex items-center gap-1.5 text-slate-800">
            <span className="font-medium text-amber-800">{row.from_facility?.facility_name || `Facility #${row.from_facility_id}`}</span>
            <RightOutlined className="text-slate-400 text-[10px]" />
            <span className="font-medium text-emerald-800">{row.to_facility?.facility_name || `Facility #${row.to_facility_id}`}</span>
          </div>
          {(row.distance_km || row.estimated_hours) && (
            <div className="text-[11px] text-slate-500">
              {row.distance_km && <span>{row.distance_km} km</span>}
              {row.distance_km && row.estimated_hours && <span> · </span>}
              {row.estimated_hours && <span>est. ~{row.estimated_hours}h</span>}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      width: 150,
      render: (_: unknown, row: InternalTransfer) => (
        <TransferStatusBadge status={row.status} />
      ),
    },
    {
      title: 'Items',
      key: 'items',
      width: 110,
      render: (_: unknown, row: InternalTransfer) => {
        const count = Array.isArray(row.items) ? row.items.length : 0;
        return <span className="text-xs font-medium text-slate-700">{count} item(s)</span>;
      },
    },
    {
      title: 'Action',
      key: 'action',
      width: 90,
      align: 'center' as const,
      fixed: 'right' as const,
      render: (_: unknown, row: InternalTransfer) => (
        <Button
          size="small"
          type="link"
          icon={<EyeOutlined />}
          onClick={() => loadTransferDetail(row.id)}
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
        <div className="flex flex-wrap items-center gap-2">
          <Button
            icon={<FilterOutlined />}
            onClick={openFilterModal}
            type={hasFilter ? 'primary' : 'default'}
            className={hasFilter ? 'bg-[#004996]!' : ''}
          >
            Filters {hasFilter && `(${activeFilterCount})`}
          </Button>

          {/* Active Filter Badges */}
          {status && (
            <Tag
              closable
              onClose={() => setStatus('')}
              className="m-0 text-xs py-0.5 px-2 bg-slate-100 border-slate-200"
            >
              Status: {TRANSFER_STATUS_MAP[status]?.label || status}
            </Tag>
          )}
          {orderIdFilter.trim() && (
            <Tag
              closable
              onClose={() => setOrderIdFilter('')}
              className="m-0 text-xs py-0.5 px-2 bg-slate-100 border-slate-200"
            >
              Order: #{orderIdFilter.trim()}
            </Tag>
          )}

          {hasFilter && (
            <Button
              type="link"
              size="small"
              onClick={resetFilters}
              className="text-xs text-slate-500 hover:text-slate-800 p-0! ml-1"
            >
              Reset
            </Button>
          )}
        </div>

        <Button
          icon={<ReloadOutlined />}
          onClick={fetchTransfers}
          loading={loading}
          className="text-slate-600 hover:text-slate-900"
        >
          Refresh
        </Button>
      </div>

      {/* Table Container */}
      <div className="bg-white rounded-md border border-gray-200 overflow-hidden">
        <Table
          dataSource={data}
          columns={columns}
          rowKey="id"
          loading={loading}
          scroll={{ x: 850 }}
          pagination={{
            pageSize: 20,
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
                description="No internal transfers match current filters"
              />
            ),
          }}
          className="w-full text-xs sm:text-sm"
        />
      </div>

      {/* Filter Modal */}
      <Modal
        title="Filter Internal Transfers"
        open={filterModalOpen}
        onCancel={() => setFilterModalOpen(false)}
        footer={[
          <Button
            key="reset"
            onClick={() => {
              setTempStatus('');
              setTempOrderId('');
            }}
          >
            Clear
          </Button>,
          <Button
            key="apply"
            type="primary"
            className="bg-[#004996]!"
            onClick={applyFiltersFromModal}
          >
            Apply Filters
          </Button>,
        ]}
      >
        <div className="space-y-3.5 py-2">
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">
              Transfer Status
            </label>
            <Select
              value={tempStatus || undefined}
              onChange={(v) => setTempStatus(v || '')}
              placeholder="All Statuses"
              allowClear
              className="w-full text-sm"
              options={Object.entries(TRANSFER_STATUS_MAP).map(([val, cfg]) => ({
                value: val,
                label: cfg.label,
              }))}
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">
              Order ID
            </label>
            <Input
              value={tempOrderId}
              onChange={(e) => setTempOrderId(e.target.value)}
              placeholder="e.g. 129"
              allowClear
              className="w-full text-sm"
            />
          </div>
        </div>
      </Modal>

      {/* Transfer Detail Drawer */}
      <Drawer
        title={
          <div className="flex items-center justify-between pr-4">
            <span className="font-bold text-slate-900 text-sm sm:text-base flex items-center gap-2">
              <SwapOutlined className="text-[#004996]" /> Transfer #{selectedTransfer?.transfer_code}
            </span>
            {selectedTransfer && <TransferStatusBadge status={selectedTransfer.status} />}
          </div>
        }
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        size="large"
      >
        {detailLoading ? (
          <div className="flex justify-center py-20">
            <Spin size="large" />
          </div>
        ) : selectedTransfer ? (
          <div className="space-y-5">
            {!canOperateTransfers && (
              <Alert
                type="info"
                showIcon
                title="View-only Mode"
                description="Pharmacist accounts have review permissions. Dispatching and receiving stock transfers are reserved for Warehouse Staff or Store Managers."
              />
            )}

            {/* Route Map Card */}
            <div className="bg-slate-50 p-3.5 rounded-md border border-slate-200 space-y-2.5">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Inter-facility Route</span>
                {/* The order belongs to the destination facility; other staff cannot open it. */}
                {canReceive ? (
                  <Link
                    href={`/admin/orders/${selectedTransfer.order_id}`}
                    className="font-semibold text-[#004996] hover:underline"
                  >
                    View Order #{selectedTransfer.order_id} &rarr;
                  </Link>
                ) : (
                  <span className="font-semibold text-slate-600" title="The order is managed by the destination facility">
                    Order #{selectedTransfer.order_id}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 pt-0.5">
                <div className="bg-white p-2.5 rounded border border-slate-200">
                  <div className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider">
                    Origin Facility (Source)
                  </div>
                  <strong className="text-xs sm:text-sm text-slate-900 block mt-0.5">
                    {selectedTransfer.from_facility?.facility_name || `Facility #${selectedTransfer.from_facility_id}`}
                  </strong>
                  {selectedTransfer.from_facility?.address && (
                    <span className="text-xs text-slate-500 block mt-0.5">
                      {selectedTransfer.from_facility.address}
                    </span>
                  )}
                </div>

                <div className="bg-white p-2.5 rounded border border-slate-200">
                  <div className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">
                    Destination Hub
                  </div>
                  <strong className="text-xs sm:text-sm text-slate-900 block mt-0.5">
                    {selectedTransfer.to_facility?.facility_name || `Facility #${selectedTransfer.to_facility_id}`}
                  </strong>
                  {selectedTransfer.to_facility?.address && (
                    <span className="text-xs text-slate-500 block mt-0.5">
                      {selectedTransfer.to_facility.address}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 pt-0.5">
                {selectedTransfer.distance_km && <span>Distance: <strong>{selectedTransfer.distance_km} km</strong></span>}
                {selectedTransfer.estimated_hours && <span>Est. Transit: <strong>~{selectedTransfer.estimated_hours}h</strong></span>}
                <div className="text-xs text-slate-600">
                  {selectedTransfer.transport_mode === 'INTERNAL'
                    ? `Internal transport: ${selectedTransfer.transport_employee_name || 'Employee not recorded'}`
                    : selectedTransfer.transport_mode === 'THIRD_PARTY'
                      ? `Third-party carrier: ${selectedTransfer.courier_name}`
                      : 'Transport method was not recorded for this historical transfer.'}
                </div>
                {selectedTransfer.tracking_code && (
                  <span>Tracking Code: <strong className="font-mono text-slate-800">{selectedTransfer.tracking_code}</strong></span>
                )}
              </div>
            </div>

            {/* Transferred Items Manifest */}
            <div className="space-y-2">
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 m-0">
                Transferred Medicines Manifest ({selectedTransfer.items?.length || 0})
              </h3>
              <div className="bg-white rounded-md border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                {selectedTransfer.items?.map((it, idx) => (
                  <div key={idx} className="p-2.5 sm:p-3 flex items-center justify-between text-xs sm:text-sm">
                    <div>
                      <strong className="text-slate-800 block">{it.medicineName}</strong>
                      <span className="text-slate-400 text-xs">Variant #{it.variantId}</span>
                    </div>
                    <span className="font-semibold text-slate-900 tabular-nums">
                      {it.quantity} {it.unitName}
                    </span>
                  </div>
                ))}
              </div>
              {selectedTransfer.manifest ? <div className="text-xs text-slate-600 space-y-1"><p>Scanned by staff #{selectedTransfer.manifest.prepared_by} at {new Date(selectedTransfer.manifest.prepared_at).toLocaleString()}.</p>{selectedTransfer.manifest.lines.map(line => <p className="break-all" key={line.variantId}>Variant #{line.variantId}: {line.quantity} units{line.boxUids.length ? ` — ${line.boxUids.join(', ')}` : ' — untracked units'}</p>)}</div> : selectedTransfer.status !== 'REQUESTED' && <p className="text-xs text-slate-600">No source manifest was recorded for this transfer.</p>}
            </div>

            {/* Action Buttons for allowed roles */}
            {canOperateTransfers && (
              <div className="bg-white p-3.5 rounded-md border border-slate-200 space-y-2.5">
                <h3 className="text-xs sm:text-sm font-bold text-slate-900 m-0">Transfer Operations</h3>
                <p className="text-xs text-slate-600 m-0">
                  {canDispatch && 'Source facility staff can dispatch. To cancel or change the delivery plan, cancel the entire order. '}
                  {canReceive ? 'Inspect quantities and scan good/damaged UIDs before confirming receipt.' : 'Only destination facility staff can confirm receipt or report damage.'}
                </p>

                <div className="flex flex-wrap gap-2">
                  <TransferInspection key={selectedTransfer.id} transfer={selectedTransfer} atSource={canDispatch} atDestination={canReceive} onSaved={async () => { await loadTransferDetail(selectedTransfer.id); fetchTransfers(); }} />
                  {canReceive && <Link href={`/admin/orders/${selectedTransfer.order_id}`}>View order and cancellation</Link>}
                  {selectedTransfer.status === 'REQUESTED' && canDispatch && (
                    <>
                      <Button
                        type="primary"
                        icon={<SendOutlined />}
                        className="bg-[#004996]! hover:bg-[#003875]!"
                        size="small"
                        onClick={openDispatch}
                        loading={actionLoading}
                      >
                        Dispatch Stock
                      </Button>

                    </>
                  )}

                  {['RECEIVED', 'CANCELLED', 'REPLACED', 'REJECTED_UNFULFILLED'].includes(selectedTransfer.status) && (
                    <span className="text-xs text-slate-500 italic">
                      Transfer has reached terminal status ({TRANSFER_STATUS_MAP[selectedTransfer.status]?.label || selectedTransfer.status}).
                    </span>
                  )}
                </div>
                {selectedTransfer.status === 'RECEIVED_WITH_DISCREPANCY' && (
                  <div className="space-y-2"><Alert type="warning" showIcon title="Transfer discrepancy requires a decision" description="The order remains waiting until affected lines are reallocated or the customer accepts reduced quantities." />
                    {canReceive && ['SUPERADMIN', 'STOREMANAGER'].includes(role) && <TransferDiscrepancyResolution transfer={selectedTransfer} onUpdated={async () => { await loadTransferDetail(selectedTransfer.id); await fetchTransfers(); }} />}
                  </div>
                )}
              </div>
            )}

            {selectedTransfer.custody?.length ? <div className="space-y-1 text-sm"><h3 className="font-semibold">Transport custody</h3>
              {selectedTransfer.custody.map(line => <p key={line.variant_id}>Variant #{line.variant_id}: {line.outstanding} of {line.quantity} units in transit. Handed over {new Date(line.handed_over_at).toLocaleString()}.</p>)}
            </div> : ['DISPATCHED', 'RETURN_REQUESTED'].includes(selectedTransfer.status) ? <Alert type="warning" showIcon title="Legacy transfer requires custody reconciliation before receipt" description="This transfer predates custody tracking. An administrator must reconcile its physical handoff and source reservation before upgrading this active transfer." /> : null}
            {selectedTransfer.resolution && <Alert showIcon type="info" title={`Resolution: ${selectedTransfer.resolution.action}`} description={<div><p>{selectedTransfer.resolution.reason} — staff #{selectedTransfer.resolution.resolved_by}</p>{selectedTransfer.resolution.customer_agreement && <p>Customer agreement: {selectedTransfer.resolution.customer_agreement}</p>}{selectedTransfer.resolution.replacement_transfer_id && <p>Replacement transfer #{selectedTransfer.resolution.replacement_transfer_id}</p>}</div>} />}
            <LogisticsHistory events={selectedTransfer.history} transfer />
          </div>
        ) : null}
      </Drawer>



      {/* Dispatch Modal with Tracking Code */}
      <Modal
        title="Dispatch Stock Transfer"
        open={dispatchModalOpen}
        onOk={handleDispatch}
        onCancel={() => {
          setDispatchModalOpen(false);
          setTrackingCodeInput('');
        }}
        confirmLoading={actionLoading}
        okText="Confirm Dispatch"
        cancelText="Cancel"
        okButtonProps={{ className: 'bg-[#004996]!' }}
      >
        <div className="space-y-2.5 py-2">
          <p className="text-sm">Count each line and scan every reserved package before handing goods to the responsible carrier.</p>
          {selectedTransfer?.items.map(item => {
            const variantId = Number(item.variantId);
            const line = manifestLines[variantId] || { quantity: 0, boxUids: '' };
            return <div key={variantId} className="border border-slate-200 rounded p-2 space-y-2">
              <div>{item.medicineName || `Variant #${variantId}`} — expected {item.quantity}</div>
              <InputNumber aria-label={`Count for variant ${variantId}`} min={0} max={Number(item.quantity)} precision={0} value={line.quantity}
                onChange={value => setManifestLines(current => ({ ...current, [variantId]: { ...line, quantity: value || 0 } }))} />
              <Input.TextArea aria-label={`Scanned UIDs for variant ${variantId}`} value={line.boxUids} placeholder="Scan package UIDs, separated by lines or commas"
                onChange={event => setManifestLines(current => ({ ...current, [variantId]: { ...line, boxUids: event.target.value } }))} />
            </div>;
          })}
          <label className="block text-sm" htmlFor="transfer-transport-mode">Transport method</label>
          <Select id="transfer-transport-mode" className="w-full" value={transportMode} onChange={setTransportMode}
            options={[{ value: 'INTERNAL', label: 'Internal employee' }, { value: 'THIRD_PARTY', label: 'Third-party carrier' }]} />
          {transportMode === 'INTERNAL' ? <>
            <label className="block text-sm" htmlFor="transfer-employee">Responsible employee at source facility</label>
            <Select id="transfer-employee" className="w-full" value={transportEmployeeId} onChange={setTransportEmployeeId}
              loading={staffLoading} showSearch optionFilterProp="label" placeholder="Choose an employee"
              options={transportStaff.map(employee => ({ value: employee.id, label: employee.full_name }))} />
          </> : <>
            <label className="block text-sm" htmlFor="transfer-carrier">Carrier</label>
            <AutoComplete id="transfer-carrier" className="w-full" value={carrierName} onChange={setCarrierName}
              options={CARRIER_OPTIONS} placeholder="Choose or enter the carrier" maxLength={100} />
            <label className="block text-sm" htmlFor="transfer-tracking">Carrier tracking number</label>
            <Input id="transfer-tracking" maxLength={100} value={trackingCodeInput} onChange={e => setTrackingCodeInput(e.target.value)}
              placeholder="Actual tracking number supplied by the carrier" />
          </>}
          <p className="text-xs text-slate-600">The destination facility must check and confirm receipt for either transport method.</p>
        </div>
      </Modal>
    </div>
  );
}
