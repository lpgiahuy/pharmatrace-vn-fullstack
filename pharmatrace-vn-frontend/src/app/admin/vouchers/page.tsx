
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  DatePicker,
  Popconfirm,
  Descriptions,
  App,
  Card,
  Pagination,
  Spin,
  Empty,
} from 'antd';
import {
  SearchOutlined,
  ReloadOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { voucherService, VoucherItem } from '@/services/voucher.service';
import { formatCurrency } from '@/utils';

const getErrorMessage = (err: any): string => {
  if (typeof err === 'string') return err;
  if (err?.response?.data?.message) {
    const msg = err.response.data.message;
    return Array.isArray(msg) ? msg.join(', ') : msg;
  }
  if (err?.message) {
    return Array.isArray(err.message) ? err.message.join(', ') : err.message;
  }
  if (err?.error) return err.error;
  return 'Operation failed';
};

const StatusBadge: React.FC<{ status?: string; endDate?: string | null }> = ({ status, endDate }) => {
  let normalized = (status || 'ACTIVE').toUpperCase();
  if (normalized === 'ACTIVE' && endDate && new Date() > new Date(endDate)) {
    normalized = 'EXPIRED';
  }
  if (normalized === 'ACTIVE') {
    return (
      <span className="text-xs text-slate-600 font-medium inline-flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        Active
      </span>
    );
  }
  if (normalized === 'EXPIRED') {
    return (
      <span className="text-xs text-amber-600 font-medium inline-flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        Expired
      </span>
    );
  }
  return (
    <span className="text-xs text-slate-500 font-medium inline-flex items-center gap-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
      Inactive
    </span>
  );
};

export default function AdminVouchersPage() {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [vouchers, setVouchers] = useState<VoucherItem[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
  });

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [discountTypeFilter, setDiscountTypeFilter] = useState<string | undefined>(undefined);
  const [sort, setSort] = useState<string>('newest');

  // Detail Modal State
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [viewingVoucher, setViewingVoucher] = useState<VoucherItem | null>(null);

  // Create / Edit Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingVoucher, setEditingVoucher] = useState<VoucherItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
  const discountType = Form.useWatch('discountType', form);

  const fetchVouchers = useCallback(
    async (page = 1) => {
      setLoading(true);
      try {
        const res = await voucherService.adminGetVouchers({
          page,
          limit: pagination.limit,
          search: search || undefined,
          status: statusFilter || undefined,
          discountType: discountTypeFilter || undefined,
          sort: sort || undefined,
        });
        if (res?.data) {
          setVouchers(res.data);
          if (res.pagination) {
            setPagination({
              page: res.pagination.page,
              limit: res.pagination.limit,
              total: res.pagination.total,
            });
          }
        }
      } catch (err: any) {
        message.error(getErrorMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [pagination.limit, search, statusFilter, discountTypeFilter, sort, message],
  );

  useEffect(() => {
    fetchVouchers(1);
  }, [fetchVouchers]);

  const handleOpenDetail = (record: VoucherItem) => {
    setViewingVoucher(record);
    setDetailModalOpen(true);
  };

  const handleOpenCreate = () => {
    setEditingVoucher(null);
    form.resetFields();
    form.setFieldsValue({
      discountType: 'PERCENT',
      discountValue: 10,
      minOrderValue: 100000,
      totalQuantity: 100,
      status: 'ACTIVE',
      startDate: undefined,
      endDate: undefined,
    });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (record: VoucherItem) => {
    setEditingVoucher(record);
    form.resetFields();
    form.setFieldsValue({
      voucherCode: record.voucherCode,
      discountType: record.discountType,
      discountValue: record.discountValue,
      minOrderValue: record.minOrderValue,
      maxDiscountAmount: record.maxDiscountAmount,
      totalQuantity: record.totalQuantity,
      status: record.status,
      startDate: record.startDate ? dayjs(record.startDate) : undefined,
      endDate: record.endDate ? dayjs(record.endDate) : undefined,
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await voucherService.adminDeleteVoucher(id);
      message.success('Voucher deleted successfully');
      if (detailModalOpen) {
        setDetailModalOpen(false);
      }
      fetchVouchers(pagination.page);
    } catch (err: any) {
      message.error(getErrorMessage(err));
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);

      const isPercent = values.discountType === 'PERCENT';
      const payload: any = {
        voucherCode: values.voucherCode.trim().toUpperCase(),
        discountType: values.discountType,
        discountValue: Number(values.discountValue),
        minOrderValue: Number(values.minOrderValue ?? 0),
        totalQuantity: Number(values.totalQuantity ?? 100),
        status: values.status || 'ACTIVE',
        maxDiscountAmount:
          isPercent && values.maxDiscountAmount !== undefined && values.maxDiscountAmount !== null && values.maxDiscountAmount !== ''
            ? Number(values.maxDiscountAmount)
            : null,
        startDate: values.startDate ? values.startDate.toISOString() : null,
        endDate: values.endDate ? values.endDate.toISOString() : null,
      };

      if (editingVoucher) {
        await voucherService.adminUpdateVoucher(editingVoucher.id, payload);
        message.success('Voucher updated successfully');
      } else {
        await voucherService.adminCreateVoucher(payload);
        message.success('Voucher created successfully');
      }

      setIsModalOpen(false);
      fetchVouchers(editingVoucher ? pagination.page : 1);
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    {
      title: 'Voucher Code',
      dataIndex: 'voucherCode',
      key: 'voucherCode',
      width: 160,
      render: (code: string) => (
        <span className="font-mono text-sm font-semibold text-slate-900 tracking-wide select-all">
          {code}
        </span>
      ),
    },
    {
      title: 'Discount Type',
      dataIndex: 'discountType',
      key: 'discountType',
      width: 150,
      render: (type: string) => (
        <span className="text-sm text-slate-600 font-normal">
          {type === 'PERCENT' ? 'Percentage (%)' : 'Cash (VND)'}
        </span>
      ),
    },
    {
      title: 'Value',
      key: 'discountValue',
      width: 130,
      render: (_: any, record: VoucherItem) => (
        <span className="text-sm font-semibold text-slate-900">
          {record.discountType === 'PERCENT'
            ? `${record.discountValue}%`
            : formatCurrency(record.discountValue)}
        </span>
      ),
    },
    {
      title: 'Min Order',
      dataIndex: 'minOrderValue',
      key: 'minOrderValue',
      width: 130,
      render: (val: number) => (
        <span className="text-sm text-slate-600 font-normal">
          {val > 0 ? formatCurrency(val) : '—'}
        </span>
      ),
    },
    {
      title: 'Max Cap',
      dataIndex: 'maxDiscountAmount',
      key: 'maxDiscountAmount',
      width: 130,
      render: (val: number | null, record: VoucherItem) => {
        if (record.discountType === 'FIXED') {
          return <span className="text-sm text-slate-400 font-normal">N/A</span>;
        }
        return (
          <span className="text-sm text-slate-600 font-normal">
            {val ? formatCurrency(val) : 'Unlimited'}
          </span>
        );
      },
    },
    {
      title: 'Usage',
      key: 'usage',
      width: 120,
      render: (_: any, record: VoucherItem) => (
        <span className="text-sm text-slate-700 font-normal">
          <span className="font-semibold text-slate-900">{record.usedQuantity}</span> /{' '}
          {record.totalQuantity}
        </span>
      ),
    },
    {
      title: 'Validity Period',
      key: 'validity',
      width: 190,
      render: (_: any, record: VoucherItem) => {
        if (!record.startDate && !record.endDate) {
          return <span className="text-sm text-slate-400 font-normal">Continuous</span>;
        }
        return (
          <span className="text-sm text-slate-600 font-mono">
            {record.startDate ? dayjs(record.startDate).format('DD/MM/YYYY') : 'Open'} –{' '}
            {record.endDate ? dayjs(record.endDate).format('DD/MM/YYYY') : 'Open'}
          </span>
        );
      },
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (status: string, record: VoucherItem) => (
        <StatusBadge status={status} endDate={record.endDate} />
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      align: 'center' as const,
      render: (_: any, record: VoucherItem) => (
        <button
          type="button"
          onClick={() => handleOpenDetail(record)}
          className="px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-[6px] transition-colors border border-slate-200 bg-white cursor-pointer"
        >
          Details
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-4 font-sans w-full">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 m-0 tracking-tight">
            Vouchers & Promotions
          </h1>
          <p className="text-slate-500 text-xs sm:text-sm m-0 mt-0.5">
            Manage customer discount coupons and promotional campaigns ({pagination.total} total)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleOpenCreate}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[6px] bg-[#004996] hover:bg-[#003875] text-white text-xs sm:text-sm font-medium transition-colors cursor-pointer border-none shadow-xs"
          >
            <PlusOutlined />
            <span>Create Voucher</span>
          </button>
        </div>
      </div>

      {/* Filter Controls Bar */}
      <div className="bg-white p-3 sm:p-4 rounded-[6px] border border-slate-200/80 shadow-xs">
        <div className="grid grid-cols-2 sm:flex sm:flex-row sm:items-center gap-2 sm:gap-3">
          <div className="col-span-2 sm:flex-1 sm:w-auto flex items-center gap-2">
            <Input
              placeholder="Search by code"
              prefix={<SearchOutlined className="text-slate-400 text-xs sm:text-sm" />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onPressEnter={() => fetchVouchers(1)}
              allowClear
              className="rounded-[6px] text-xs sm:text-sm h-9 sm:h-10 flex-1"
            />
            <button
              type="button"
              onClick={() => fetchVouchers(1)}
              disabled={loading}
              title="Refresh"
              className="h-9 sm:h-10 px-3 rounded-[6px] border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors cursor-pointer shrink-0 inline-flex items-center justify-center sm:hidden"
            >
              <ReloadOutlined className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="col-span-1 sm:w-44 shrink-0">
            <Select
              placeholder="Discount Type"
              value={discountTypeFilter}
              onChange={(val) => setDiscountTypeFilter(val)}
              allowClear
              className="text-xs sm:text-sm h-9 sm:h-10 w-full"
              options={[
                { label: 'All Types', value: '' },
                { label: 'Percentage (%)', value: 'PERCENT' },
                { label: 'Cash (VND)', value: 'FIXED' },
              ]}
            />
          </div>

          <div className="col-span-1 sm:w-36 shrink-0">
            <Select
              placeholder="Status"
              value={statusFilter}
              onChange={(val) => setStatusFilter(val)}
              allowClear
              className="text-xs sm:text-sm h-9 sm:h-10 w-full"
              options={[
                { label: 'All Statuses', value: '' },
                { label: 'Active', value: 'ACTIVE' },
                { label: 'Inactive', value: 'INACTIVE' },
                { label: 'Expired', value: 'EXPIRED' },
              ]}
            />
          </div>

          <div className="col-span-2 sm:w-44 shrink-0">
            <Select
              placeholder="Sort by"
              value={sort}
              onChange={(val) => setSort(val)}
              className="text-xs sm:text-sm h-9 sm:h-10 w-full"
              options={[
                { label: 'Newest First', value: 'newest' },
                { label: 'Oldest First', value: 'oldest' },
                { label: 'Most Used', value: 'usage_desc' },
                { label: 'Least Used', value: 'usage_asc' },
                { label: 'Min Order: Low to High', value: 'min_order_asc' },
                { label: 'Min Order: High to Low', value: 'min_order_desc' },
              ]}
            />
          </div>

          <button
            type="button"
            onClick={() => fetchVouchers(1)}
            disabled={loading}
            title="Refresh"
            className="hidden sm:inline-flex h-10 px-3.5 rounded-[6px] border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors cursor-pointer shrink-0 items-center justify-center"
          >
            <ReloadOutlined className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Mobile Card List (< 640px) */}
      <div className="block sm:hidden !space-y-3">
        {loading ? (
          <div className="p-10 text-center bg-white rounded-[6px] border border-slate-200/80">
            <Spin />
          </div>
        ) : vouchers.length === 0 ? (
          <div className="p-10 text-center bg-white rounded-[6px] border border-slate-200/80">
            <Empty description="No vouchers found" />
          </div>
        ) : (
          vouchers.map((row) => (
            <Card
              key={row.id}
              className="shadow-xs !rounded-[6px] border-slate-200/80 hover:border-slate-300 transition-all cursor-pointer"
              styles={{ body: { padding: '14px' } }}
              onClick={() => handleOpenDetail(row)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-bold text-slate-900 tracking-wide select-all">
                      {row.voucherCode}
                    </span>
                    <StatusBadge status={row.status} endDate={row.endDate} />
                  </div>
                  <div className="mt-1.5 flex items-baseline gap-2">
                    <span className="text-base font-bold text-red-600">
                      {row.discountType === 'PERCENT'
                        ? `${row.discountValue}% OFF`
                        : `${formatCurrency(row.discountValue)} OFF`}
                    </span>
                    <span className="text-xs text-slate-500">
                      {row.discountType === 'PERCENT' ? 'Percentage' : 'Cash'}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenDetail(row);
                  }}
                  className="px-2.5 py-1 text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-[6px] transition-colors border border-slate-200 bg-white cursor-pointer shrink-0"
                >
                  Details
                </button>
              </div>

              {/* Compact Details Box */}
              <div className="mt-3 pt-2.5 border-t border-slate-100 bg-slate-50/60 -mx-3.5 -mb-3.5 p-3 rounded-b-[6px] grid grid-cols-2 gap-2 text-xs text-slate-600">
                <div>
                  <span className="text-slate-400">Min Order: </span>
                  <span className="font-medium text-slate-800">
                    {row.minOrderValue > 0 ? formatCurrency(row.minOrderValue) : 'No Min'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400">Usage: </span>
                  <span className="font-medium text-slate-800">
                    {row.usedQuantity} / {row.totalQuantity}
                  </span>
                </div>
                {row.discountType === 'PERCENT' && row.maxDiscountAmount && (
                  <div>
                    <span className="text-slate-400">Max Cap: </span>
                    <span className="font-medium text-slate-800">
                      {formatCurrency(row.maxDiscountAmount)}
                    </span>
                  </div>
                )}
                <div className={row.discountType === 'PERCENT' && row.maxDiscountAmount ? '' : 'col-span-2'}>
                  <span className="text-slate-400">Validity: </span>
                  <span className="font-mono text-slate-700">
                    {!row.startDate && !row.endDate
                      ? 'Continuous'
                      : `${row.startDate ? dayjs(row.startDate).format('DD/MM/YY') : 'Open'} – ${row.endDate ? dayjs(row.endDate).format('DD/MM/YY') : 'Open'}`}
                  </span>
                </div>
              </div>
            </Card>
          ))
        )}

        {/* Mobile Pagination */}
        <div className="p-3 bg-white rounded-[6px] flex items-center justify-center text-xs">
          {/* <span className="text-slate-500">Total {pagination.total} vouchers</span> */}
          <Pagination
            current={pagination.page}
            pageSize={pagination.limit}
            total={pagination.total}
            onChange={(page) => fetchVouchers(page)}
            showSizeChanger={false}
            size="small"
            itemRender={(_page, type, originalElement) => {
              if (type === 'prev') {
                return <span className="px-1 text-slate-600 text-xs font-medium">&lt; Prev</span>;
              }
              if (type === 'next') {
                return <span className="px-1 text-[#004996] text-xs font-medium">Next &gt;</span>;
              }
              return originalElement;
            }}
          />
        </div>
      </div>

      {/* Desktop & Tablet View: Full Table (>= 640px) */}
      <div className="hidden sm:block bg-white rounded-md border border-gray-200 shadow-card overflow-hidden">
        <Table
          columns={columns}
          dataSource={vouchers}
          rowKey="id"
          loading={loading}
          size="middle"
          pagination={{
            current: pagination.page,
            pageSize: pagination.limit,
            total: pagination.total,
            showSizeChanger: false,
            onChange: (p) => fetchVouchers(p),
            itemRender: (_page, type, originalElement) => {
              if (type === 'prev') {
                return <span className="px-1 text-slate-600 text-xs font-medium">&lt; Previous</span>;
              }
              if (type === 'next') {
                return <span className="px-1 text-[#004996] text-xs font-medium">Next &gt;</span>;
              }
              return originalElement;
            },
          }}
          className="overflow-x-auto"
        />
      </div>

      {/* View Voucher Details Modal */}
      {viewingVoucher && (
        <Modal
          title={
            <span className="font-semibold text-base text-slate-900">
              Voucher Details
            </span>
          }
          open={detailModalOpen}
          onCancel={() => setDetailModalOpen(false)}
          footer={
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <Popconfirm
                title="Delete Voucher"
                description="Are you sure you want to delete this voucher?"
                onConfirm={() => handleDelete(viewingVoucher.id)}
                okText="Delete"
                cancelText="Cancel"
                okButtonProps={{ danger: true, size: 'small' }}
              >
                <Button size="small" danger icon={<DeleteOutlined />} className="rounded-[6px] text-xs">
                  Delete
                </Button>
              </Popconfirm>

              <div className="flex items-center gap-2">
                <Button
                  type="primary"
                  size="small"
                  icon={<EditOutlined />}
                  style={{ backgroundColor: '#004996' }}
                  onClick={() => {
                    setDetailModalOpen(false);
                    handleOpenEdit(viewingVoucher);
                  }}
                  className="rounded-[6px] text-xs font-medium"
                >
                  Edit
                </Button>
                <Button
                  size="small"
                  onClick={() => setDetailModalOpen(false)}
                  className="rounded-[6px] text-xs"
                >
                  Close
                </Button>
              </div>
            </div>
          }
          width={560}
        >
          <div className="py-2 space-y-4">
            <Descriptions
              bordered
              size="small"
              column={{ xs: 1, sm: 2 }}
              className="bg-white rounded-[6px] overflow-hidden"
              styles={{
                label: { width: '130px', fontWeight: 500, color: '#475569' },
                content: { color: '#0f172a' },
              }}
            >
              <Descriptions.Item label="Code" span={{ xs: 1, sm: 2 }}>
                <span className="font-mono font-bold text-slate-900 select-all">
                  {viewingVoucher.voucherCode}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label="Discount Type">
                {viewingVoucher.discountType === 'PERCENT' ? 'Percentage (%)' : 'Cash (VND)'}
              </Descriptions.Item>
              <Descriptions.Item label="Discount Value">
                <span className="font-bold text-red-600">
                  {viewingVoucher.discountType === 'PERCENT'
                    ? `${viewingVoucher.discountValue}%`
                    : formatCurrency(viewingVoucher.discountValue)}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label="Min Order Value">
                {viewingVoucher.minOrderValue > 0 ? formatCurrency(viewingVoucher.minOrderValue) : 'No Minimum'}
              </Descriptions.Item>
              <Descriptions.Item label="Max Discount Cap">
                {viewingVoucher.discountType === 'FIXED' ? (
                  <span className="text-slate-400">Not Applicable (Cash)</span>
                ) : viewingVoucher.maxDiscountAmount ? (
                  formatCurrency(viewingVoucher.maxDiscountAmount)
                ) : (
                  'Unlimited'
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Used Count">
                <span className="font-semibold text-slate-900">{viewingVoucher.usedQuantity}</span>
              </Descriptions.Item>
              <Descriptions.Item label="Total Available">
                {viewingVoucher.totalQuantity}
              </Descriptions.Item>
              <Descriptions.Item label="Validity" span={{ xs: 1, sm: 2 }}>
                {!viewingVoucher.startDate && !viewingVoucher.endDate ? (
                  <span className="text-slate-500">Continuous availability (No expiration)</span>
                ) : (
                  <span className="font-mono text-slate-700 text-xs">
                    {viewingVoucher.startDate ? dayjs(viewingVoucher.startDate).format('DD/MM/YYYY HH:mm') : 'Open'}{' '}
                    – {viewingVoucher.endDate ? dayjs(viewingVoucher.endDate).format('DD/MM/YYYY HH:mm') : 'Open'}
                  </span>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Status" span={{ xs: 1, sm: 2 }}>
                <StatusBadge status={viewingVoucher.status} endDate={viewingVoucher.endDate} />
              </Descriptions.Item>
            </Descriptions>
          </div>
        </Modal>
      )}

      {/* Create / Edit Modal */}
      <Modal
        title={
          <span className="text-base font-semibold text-slate-900">
            {editingVoucher ? 'Edit Voucher' : 'Create Voucher'}
          </span>
        }
        open={isModalOpen}
        onOk={handleSubmit}
        onCancel={() => setIsModalOpen(false)}
        confirmLoading={submitting}
        okText={editingVoucher ? 'Save Changes' : 'Create Voucher'}
        okButtonProps={{ style: { backgroundColor: '#004996' } }}
        destroyOnHidden
        width={540}
      >
        <Form form={form} layout="vertical" className="mt-4">
          <Form.Item
            name="voucherCode"
            label={<span className="text-xs font-medium text-slate-700">Voucher Code</span>}
            rules={[
              { required: true, message: 'Please enter voucher code' },
              { min: 3, message: 'Code must be at least 3 characters' },
            ]}
          >
            <Input
              placeholder="e.g. SUMMER2026"
              className="font-mono uppercase"
              onChange={(e) =>
                form.setFieldValue('voucherCode', e.target.value.toUpperCase())
              }
            />
          </Form.Item>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Form.Item
              name="discountType"
              label={<span className="text-xs font-medium text-slate-700">Discount Type</span>}
              rules={[{ required: true }]}
            >
              <Select
                options={[
                  { label: 'Percentage (%)', value: 'PERCENT' },
                  { label: 'Cash (VND)', value: 'FIXED' },
                ]}
                onChange={(val) => {
                  if (val === 'FIXED') {
                    form.setFieldValue('maxDiscountAmount', undefined);
                  }
                }}
              />
            </Form.Item>

            <Form.Item
              name="discountValue"
              label={
                <span className="text-xs font-medium text-slate-700">
                  Discount Value {discountType === 'PERCENT' ? '(%)' : '(VND)'}
                </span>
              }
              rules={[
                { required: true, message: 'Please enter value' },
                {
                  validator: (_, val) => {
                    if (discountType === 'PERCENT' && val > 100) {
                      return Promise.reject(new Error('Percentage cannot exceed 100%'));
                    }
                    if (val !== undefined && val <= 0) {
                      return Promise.reject(new Error('Value must be greater than 0'));
                    }
                    return Promise.resolve();
                  },
                },
              ]}
            >
              <InputNumber
                min={0.01}
                max={discountType === 'PERCENT' ? 100 : undefined}
                step={discountType === 'PERCENT' ? 1 : 10000}
                style={{ width: '100%' }}
                placeholder={discountType === 'PERCENT' ? 'e.g. 10' : 'e.g. 50000'}
              />
            </Form.Item>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Form.Item
              name="minOrderValue"
              label={<span className="text-xs font-medium text-slate-700">Minimum Order (VND)</span>}
            >
              <InputNumber min={0} step={10000} style={{ width: '100%' }} placeholder="0" />
            </Form.Item>

            <Form.Item
              name="maxDiscountAmount"
              label={<span className="text-xs font-medium text-slate-700">Max Discount Cap (For %)</span>}
              tooltip="Only applicable for Percentage (%) discount. Caps the maximum discount in VND."
            >
              <InputNumber
                min={0}
                step={10000}
                style={{ width: '100%' }}
                disabled={discountType === 'FIXED'}
                placeholder={discountType === 'FIXED' ? 'Disabled for Cash' : 'Unlimited if empty'}
              />
            </Form.Item>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Form.Item
              name="totalQuantity"
              label={<span className="text-xs font-medium text-slate-700">Total Uses</span>}
              rules={[{ required: true }]}
            >
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>

            <Form.Item
              name="status"
              label={<span className="text-xs font-medium text-slate-700">Status</span>}
              rules={[{ required: true }]}
            >
              <Select
                options={[
                  { label: 'Active', value: 'ACTIVE' },
                  { label: 'Inactive', value: 'INACTIVE' },
                  { label: 'Expired', value: 'EXPIRED' },
                ]}
              />
            </Form.Item>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Form.Item
              name="startDate"
              label={<span className="text-xs font-medium text-slate-700">Start Date (Optional)</span>}
            >
              <DatePicker
                placeholder="Select start date"
                format="DD/MM/YYYY"
                style={{ width: '100%' }}
                className="rounded-[6px]"
              />
            </Form.Item>

            <Form.Item
              name="endDate"
              label={<span className="text-xs font-medium text-slate-700">End Date (Optional)</span>}
            >
              <DatePicker
                placeholder="Select end date"
                format="DD/MM/YYYY"
                style={{ width: '100%' }}
                className="rounded-[6px]"
              />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
