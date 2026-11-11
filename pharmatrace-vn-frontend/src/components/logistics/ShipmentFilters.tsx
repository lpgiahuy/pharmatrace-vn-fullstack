'use client';

import { useState } from 'react';
import { Button, DatePicker, Input, Modal, Select, Tag } from 'antd';
import { FilterOutlined } from '@ant-design/icons';
import { SHIPPING_STATUS_MAP } from './LogisticsBadges';
import { emptyShipmentFilters, type ShipmentFiltersValue } from '@/utils/shipment-query';
import type { ShippingStatus } from '@/services/logistics.service';

const { RangePicker } = DatePicker;

export function ShipmentFilters({ value, onChange, cod = false }: {
  value: ShipmentFiltersValue; onChange: (value: ShipmentFiltersValue, resetPage?: boolean) => void; cod?: boolean;
}) {
  const { status, courier, dateRange } = value;
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const { status: tempStatus, courier: tempCourier, dateRange: tempDateRange } = draft;
  const setStatus = (status: string) => onChange({ ...value, status });
  const setCourier = (courier: string) => onChange({ ...value, courier });
  const setDateRange = (dateRange: ShipmentFiltersValue['dateRange']) => onChange({ ...value, dateRange });
  const setTempStatus = (status: string) => setDraft(current => ({ ...current, status }));
  const setTempCourier = (courier: string) => setDraft(current => ({ ...current, courier }));
  const setTempDateRange = (dateRange: ShipmentFiltersValue['dateRange']) => setDraft(current => ({ ...current, dateRange }));
  const activeFilterCount = Number(!!status) + Number(!!courier.trim()) + Number(!!dateRange?.[0]);
  const hasFilter = activeFilterCount > 0;
  const openFilterModal = () => { setDraft(value); setFilterModalOpen(true); };
  const applyFiltersFromModal = () => { onChange(draft, true); setFilterModalOpen(false); };
  const resetFilters = () => onChange(emptyShipmentFilters, true);

  return <>
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
              Status: {cod ? status : SHIPPING_STATUS_MAP[status as ShippingStatus]?.label || status}
            </Tag>
          )}
          {courier.trim() && (
            <Tag
              closable
              onClose={() => setCourier('')}
              className="m-0 text-xs py-0.5 px-2 bg-slate-100 border-slate-200"
            >
              Courier: {courier}
            </Tag>
          )}
          {dateRange && dateRange[0] && dateRange[1] && (
            <Tag
              closable
              onClose={() => setDateRange(null)}
              className="m-0 text-xs py-0.5 px-2 bg-slate-100 border-slate-200"
            >
              Date: {dateRange[0].format('YYYY-MM-DD')} &rarr; {dateRange[1].format('YYYY-MM-DD')}
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
      <Modal
        title={cod ? 'Filter COD Shipments' : 'Filter Shipments'}
        open={filterModalOpen}
        onCancel={() => setFilterModalOpen(false)}
        footer={[
          <Button
            key="reset"
            onClick={() => setDraft(emptyShipmentFilters)}
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
              {cod ? 'Settlement Status' : 'Shipping Status'}
            </label>
            <Select
              value={tempStatus || undefined}
              onChange={(v) => setTempStatus(v || '')}
              placeholder={cod ? 'All Settlement Statuses' : 'All Statuses'}
              allowClear
              className="w-full text-sm"
              options={cod ? [
                { value: 'UNSETTLED', label: 'Unsettled' },
                { value: 'DISCREPANCY_PENDING', label: 'Discrepancy pending' },
                { value: 'SETTLED', label: 'Settled' },
              ] : Object.entries(SHIPPING_STATUS_MAP).map(([val, cfg]) => ({
                value: val,
                label: cfg.label,
              }))}
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">
              Courier Name
            </label>
            <Input
              value={tempCourier}
              onChange={(e) => setTempCourier(e.target.value)}
              placeholder="e.g. EXPRESS_LOGISTICS"
              allowClear
              className="w-full text-sm"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">
              Date Range
            </label>
            <RangePicker
              value={tempDateRange}
              onChange={(dates) => setTempDateRange(dates)}
              format="YYYY-MM-DD"
              className="w-full text-sm"
            />
          </div>
        </div>
      </Modal>
  </>;
}
