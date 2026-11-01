'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Table,
  Button as AButton,
  Modal,
  Input,
  Select,
  Popconfirm,
  Dropdown,
  Tag,
  Card,
  Space,
  Tooltip,
  Descriptions,
  Statistic,
  Tabs,
  Badge,
  Spin,
  Empty,
  Pagination,
  message,
} from 'antd';
import {
  SearchOutlined,
  ReloadOutlined,
  UserOutlined,
  LogoutOutlined,
  DashboardOutlined,
  EyeOutlined,
  LockOutlined,
  UnlockOutlined,
  StopOutlined,
  DownOutlined,
  ShoppingOutlined,
  TeamOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  TrophyOutlined,
  EnvironmentOutlined,
  PhoneOutlined,
  MailOutlined,
  CalendarOutlined,
  DollarOutlined,
  CarOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '@/store/useAuthStore';
import {
  customerService,
  Customer,
  CustomerQuery,
  CustomerOrderDetail,
} from '@/services/customer.service';
import { cn, getAvatarColor } from '@/utils';

const TIER_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  BRONZE: { label: 'Bronze', color: '#92400e', bg: '#fef3c7', border: '#d97706' },
  SILVER: { label: 'Silver', color: '#374151', bg: '#f1f5f9', border: '#94a3b8' },
  GOLD: { label: 'Gold', color: '#713f12', bg: '#fef08a', border: '#ca8a04' },
  PLATINUM: { label: 'Platinum', color: '#0369a1', bg: '#e0f2fe', border: '#38bdf8' },
  DIAMOND: { label: 'Diamond', color: '#6b21a8', bg: '#f3e8ff', border: '#a855f7' },
};

const TIER_OPTIONS = [
  { value: 'BRONZE', label: 'Bronze' },
  { value: 'SILVER', label: 'Silver' },
  { value: 'GOLD', label: 'Gold' },
  { value: 'PLATINUM', label: 'Platinum' },
  { value: 'DIAMOND', label: 'Diamond' },
];

const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active Account' },
  { value: 'INACTIVE', label: 'Locked / Inactive' },
  { value: 'BANNED', label: 'Banned' },
];

const TierTag: React.FC<{ tier?: string }> = ({ tier }) => {
  const normalized = (tier || 'BRONZE').toUpperCase();
  const meta = TIER_META[normalized] || TIER_META.BRONZE;
  return (
    <span className="text-xs font-medium text-slate-700 bg-slate-100 px-2 py-0.5 rounded-[6px]">
      {meta.label}
    </span>
  );
};

const StatusBadge: React.FC<{ status?: string }> = ({ status }) => {
  const normalized = (status || 'ACTIVE').toUpperCase();
  if (normalized === 'ACTIVE') {
    return (
      <span className="text-xs text-slate-600 font-medium inline-flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        Active
      </span>
    );
  }
  if (normalized === 'BANNED') {
    return (
      <span className="text-xs text-rose-600 font-medium inline-flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-rose-600" />
        Banned
      </span>
    );
  }
  return (
    <span className="text-xs text-slate-500 font-medium inline-flex items-center gap-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
      Locked
    </span>
  );
};



const UserAvatar: React.FC<{ name?: string; email?: string; size?: 'sm' | 'md' | 'lg' }> = ({
  name,
  email,
  size = 'md',
}) => {
  const identifier = name || email || 'C';
  const initials = identifier
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const bg = getAvatarColor(identifier);
  const sizeClass = size === 'lg' ? 'w-12 h-12 text-base font-bold' : size === 'sm' ? 'w-8 h-8 text-xs font-bold' : 'w-9 h-9 text-xs font-bold';

  return (
    <div
      style={{ backgroundColor: bg }}
      className={`${sizeClass} rounded-full text-white flex items-center justify-center shrink-0 select-none shadow-xs`}
    >
      {initials || <UserOutlined />}
    </div>
  );
};

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
  }).format(amount || 0);
}

function formatDate(dateStr?: string | null) {
  if (!dateStr) return 'N/A';
  try {
    return new Date(dateStr).toLocaleDateString('vi-VN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

export default function CustomersManagementPage() {
  const router = useRouter();
  const getIsAuthenticated = useAuthStore((state) => state.getIsAuthenticated);
  const getUser = useAuthStore((state) => state.getUser);
  const logout = useAuthStore((state) => state.logout);

  const [messageApi, contextHolder] = message.useMessage();
  const [mounted, setMounted] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter & Search states
  const [searchVal, setSearchVal] = useState('');
  const [tierFilter, setTierFilter] = useState<string | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 10,
    total: 0,
  });

  // Action states
  const [togglingId, setTogglingId] = useState<number | null>(null);

  // Detail Modal states
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [customerDetail, setCustomerDetail] = useState<Customer | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Customer Orders state
  const [customerOrders, setCustomerOrders] = useState<CustomerOrderDetail[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [orderPagination, setOrderPagination] = useState({
    current: 1,
    pageSize: 5,
    total: 0,
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  const isAuthenticated = mounted ? getIsAuthenticated() : false;
  const currentUser = mounted ? getUser() : null;
  const canManageCustomerStatus = ['SUPER_ADMIN', 'STORE_MANAGER'].includes(currentUser?.role);

  useEffect(() => {
    if (mounted && !isAuthenticated) {
      router.push('/admin/login');
    }
  }, [mounted, isAuthenticated, router]);

  const fetchCustomers = useCallback(
    async (page = 1, limit = 10) => {
      setLoading(true);
      try {
        const query: CustomerQuery = {
          page,
          limit,
          search: searchVal ? searchVal.trim() : undefined,
          membershipTier: tierFilter,
          status: statusFilter,
        };
        const res = await customerService.getCustomers(query);
        if (res && res.data) {
          setCustomers(res.data);
          setPagination({
            current: res.pagination.page,
            pageSize: res.pagination.limit,
            total: res.pagination.total,
          });
        }
      } catch (err: any) {
        messageApi.error(err?.message || 'Failed to fetch customers');
      } finally {
        setLoading(false);
      }
    },
    [searchVal, tierFilter, statusFilter, messageApi]
  );

  useEffect(() => {
    if (mounted && isAuthenticated) {
      fetchCustomers(1, 10);
    }
  }, [mounted, isAuthenticated, fetchCustomers]);

  const handleSearchClick = () => {
    fetchCustomers(1, pagination.pageSize);
  };

  const handleResetFilters = () => {
    setSearchVal('');
    setTierFilter(undefined);
    setStatusFilter(undefined);
    fetchCustomers(1, pagination.pageSize);
  };

  const handleToggleStatus = async (row: Customer) => {
    const isCurrentlyActive = (row.status || 'ACTIVE').toUpperCase() === 'ACTIVE';
    const nextStatus = isCurrentlyActive ? 'INACTIVE' : 'ACTIVE';
    setTogglingId(row.id);
    try {
      await customerService.updateCustomerStatus(row.id, { status: nextStatus });
      messageApi.success(
        isCurrentlyActive
          ? `Customer account for ${row.fullName} locked successfully`
          : `Customer account for ${row.fullName} unlocked successfully`
      );

      // Update local state
      setCustomers((prev) =>
        prev.map((c) => (c.id === row.id ? { ...c, status: nextStatus } : c))
      );

      if (customerDetail && customerDetail.id === row.id) {
        setCustomerDetail((prev) => (prev ? { ...prev, status: nextStatus } : null));
      }
    } catch (err: any) {
      messageApi.error(err?.message || 'Failed to update customer status');
    } finally {
      setTogglingId(null);
    }
  };

  const handleSetStatus = async (row: Customer, newStatus: string) => {
    setTogglingId(row.id);
    try {
      await customerService.updateCustomerStatus(row.id, { status: newStatus });
      messageApi.success(
        `Customer account status for ${row.fullName || 'user'} set to ${newStatus} successfully`
      );
      setCustomers((prev) =>
        prev.map((c) => (c.id === row.id ? { ...c, status: newStatus } : c))
      );
      if (customerDetail && customerDetail.id === row.id) {
        setCustomerDetail((prev) => (prev ? { ...prev, status: newStatus } : null));
      }
    } catch (err: any) {
      messageApi.error(err?.message || 'Failed to update customer status');
    } finally {
      setTogglingId(null);
    }
  };

  const fetchCustomerOrders = useCallback(
    async (customerId: number, page = 1, limit = 5) => {
      setOrdersLoading(true);
      try {
        const res = await customerService.getCustomerOrders(customerId, { page, limit });
        if (res && res.data) {
          setCustomerOrders(res.data);
          setOrderPagination({
            current: res.pagination.page,
            pageSize: res.pagination.limit,
            total: res.pagination.total,
          });
        }
      } catch (err: any) {
        messageApi.error(err?.message || 'Failed to load customer orders');
      } finally {
        setOrdersLoading(false);
      }
    },
    [messageApi]
  );

  const openDetailModal = async (cust: Customer) => {
    setSelectedCustomerId(cust.id);
    setDetailModalOpen(true);
    setDetailLoading(true);
    try {
      const [detailRes] = await Promise.all([
        customerService.getCustomerById(cust.id),
        fetchCustomerOrders(cust.id, 1, 5),
      ]);
      if (detailRes && detailRes.data) {
        setCustomerDetail(detailRes.data);
      } else {
        setCustomerDetail(cust);
      }
    } catch {
      setCustomerDetail(cust);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    router.push('/admin/login');
  };

  // KPI Statistics calculations
  const totalCount = pagination.total || customers.length;
  const activeCount = customers.filter((c) => (c.status || 'ACTIVE').toUpperCase() === 'ACTIVE').length;
  const lockedCount = customers.filter((c) => (c.status || 'ACTIVE').toUpperCase() !== 'ACTIVE').length;
  const vipCount = customers.filter((c) =>
    ['GOLD', 'PLATINUM', 'DIAMOND'].includes((c.membershipTier || '').toUpperCase())
  ).length;
  const columns = [
    {
      title: 'Customer',
      key: 'customer',
      width: 240,
      render: (_: any, row: Customer) => (
        <div className="flex items-center gap-3">
          <UserAvatar name={row.fullName} email={row.email} size="md" />
          <div className="min-w-0">
            <p className="font-semibold text-sm text-slate-900 m-0 truncate">{row.fullName || 'Unnamed'}</p>
            <p className="text-xs text-slate-500 font-mono m-0 truncate mt-0.5">{row.email || 'No email'}</p>
          </div>
        </div>
      ),
    },
    {
      title: 'Phone Number',
      dataIndex: 'phoneNumber',
      key: 'phoneNumber',
      width: 150,
      render: (phone: string) => (
        <span className="font-mono text-sm text-slate-800">{phone || 'N/A'}</span>
      ),
    },
    {
      title: 'Tier',
      dataIndex: 'membershipTier',
      key: 'membershipTier',
      width: 120,
      render: (tier: string) => <TierTag tier={tier} />,
    },
    {
      title: 'Reward Points',
      dataIndex: 'rewardPoints',
      key: 'rewardPoints',
      width: 140,
      align: 'right' as const,
      render: (points: number) => (
        <span className="text-sm text-slate-900 font-semibold">
          {(points || 0).toLocaleString()} pts
        </span>
      ),
    },
    {
      title: 'Total Orders',
      key: 'totalOrders',
      width: 120,
      align: 'center' as const,
      render: (_: any, row: Customer) => (
        <span className="text-sm text-slate-800 font-medium">
          {row.totalOrders ?? 0}
        </span>
      ),
    },
    {
      title: 'Joined Date',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 140,
      render: (dateStr: string) => (
        <span className="text-sm text-slate-600">{formatDate(dateStr)}</span>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (status: string) => <StatusBadge status={status} />,
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      align: 'center' as const,
      render: (_: any, row: Customer) => (
        <button
          type="button"
          onClick={() => openDetailModal(row)}
          className="px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-[6px] transition-colors border border-slate-200 bg-white cursor-pointer"
        >
          Details
        </button>
      ),
    },
  ];

  const orderColumns = [
    {
      title: 'Order Code',
      dataIndex: 'orderCode',
      key: 'orderCode',
      width: 150,
      render: (code: string) => <span className="font-mono font-bold text-sm text-[#1e4287]">{code}</span>,
    },
    {
      title: 'Date',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 150,
      render: (dateStr: string) => <span className="text-sm text-slate-600">{formatDate(dateStr)}</span>,
    },
    {
      title: 'Total Amount',
      dataIndex: 'totalAmount',
      key: 'totalAmount',
      width: 140,
      align: 'right' as const,
      render: (amt: number) => (
        <span className="font-bold text-sm text-slate-900">{formatCurrency(amt)}</span>
      ),
    },
    {
      title: 'Payment',
      key: 'payment',
      width: 140,
      render: (_: any, item: CustomerOrderDetail) => {
        const isPaid = (item.paymentStatus || '').toUpperCase() === 'PAID';
        return (
          <div className="space-y-0.5">
            <span className="text-sm font-mono text-slate-700 block">{item.paymentMethod}</span>
            <span className={cn(
              'text-xs font-medium px-1.5 py-0.5 rounded-[6px] inline-block',
              isPaid ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
            )}>
              {item.paymentStatus}
            </span>
          </div>
        );
      },
    },
    {
      title: 'Order Status',
      dataIndex: 'orderStatus',
      key: 'orderStatus',
      width: 140,
      render: (status: string) => {
        return (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-[6px] bg-slate-100 text-slate-700 border border-slate-200">
            {status}
          </span>
        );
      },
    },
  ];

  if (!mounted || !isAuthenticated || !currentUser) {
    return null;
  }

  return (
    <>
      {contextHolder}

      <div className="space-y-5 animate-fade-in font-sans w-full">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 m-0 tracking-tight">
              Customer Management
            </h1>
            <p className="text-slate-500 text-sm m-0 mt-0.5">
              Customer directory, loyalty tiers, points, and order history
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fetchCustomers(pagination.current, pagination.pageSize)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[6px] border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <ReloadOutlined className={cn(loading && 'animate-spin')} />
              Refresh
            </button>
          </div>
        </div>

        {/* Stat Strip */}
        <div className="bg-white p-3 sm:px-6 sm:py-4 rounded-[6px] border border-slate-200/80 shadow-xs">
          <div className="grid grid-cols-2 sm:flex sm:items-center sm:gap-10 gap-2.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] sm:text-xs text-slate-400 font-semibold uppercase tracking-wider">Total</span>
              <span className="text-sm sm:text-lg font-bold text-slate-900">{totalCount.toLocaleString()}</span>
            </div>
            <div className="hidden sm:block h-4 w-px bg-slate-200" />
            <div className="flex items-center gap-2">
              <span className="text-[10px] sm:text-xs text-slate-400 font-semibold uppercase tracking-wider">Active</span>
              <span className="text-sm sm:text-lg font-bold text-emerald-600">{activeCount}</span>
            </div>
            <div className="hidden sm:block h-4 w-px bg-slate-200" />
            <div className="flex items-center gap-2">
              <span className="text-[10px] sm:text-xs text-slate-400 font-semibold uppercase tracking-wider">Locked</span>
              <span className="text-sm sm:text-lg font-bold text-slate-500">{lockedCount}</span>
            </div>
            <div className="hidden sm:block h-4 w-px bg-slate-200" />
            <div className="flex items-center gap-2">
              <span className="text-[10px] sm:text-xs text-slate-400 font-semibold uppercase tracking-wider">VIP Tier</span>
              <span className="text-sm sm:text-lg font-bold text-amber-600">{vipCount}</span>
            </div>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="bg-white p-3 sm:p-4 rounded-[6px] border border-slate-200/80 shadow-xs">
          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
            <div className="col-span-2 md:col-span-1">
              <Input
                placeholder="Search name, email, phone"
                prefix={<SearchOutlined className="text-slate-400 text-xs sm:text-sm" />}
                value={searchVal}
                onChange={(e) => setSearchVal(e.target.value)}
                onPressEnter={handleSearchClick}
                allowClear
                className="rounded-[6px] text-xs sm:text-sm h-9 sm:h-10 w-full"
              />
            </div>

            <div className="col-span-1">
              <Select
                placeholder="Membership Tier"
                value={tierFilter}
                onChange={(v) => setTierFilter(v)}
                options={TIER_OPTIONS}
                allowClear
                className="text-xs sm:text-sm h-9 sm:h-10 w-full"
              />
            </div>

            <div className="col-span-1">
              <Select
                placeholder="Account Status"
                value={statusFilter}
                onChange={(v) => setStatusFilter(v)}
                options={STATUS_OPTIONS}
                allowClear
                className="text-xs sm:text-sm h-9 sm:h-10 w-full"
              />
            </div>

            <div className="col-span-2 sm:col-span-2 md:col-span-1 flex gap-2">
              <button
                type="button"
                onClick={handleSearchClick}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-[6px] bg-[#1e4287] hover:bg-[#163266] text-white text-xs sm:text-sm font-medium transition-colors cursor-pointer border-none shadow-xs h-9 sm:h-10"
              >
                <SearchOutlined />
                Search
              </button>
              <button
                type="button"
                onClick={handleResetFilters}
                className="px-3 py-1.5 border border-slate-200 rounded-[6px] text-slate-500 hover:bg-slate-50 text-xs sm:text-sm transition-colors bg-white cursor-pointer h-9 sm:h-10"
                title="Reset Filters"
              >
                <ReloadOutlined />
              </button>
            </div>
          </div>
        </div>

        {/* Mobile View: Compact Card List (< 640px) */}
        <div className="block sm:hidden !space-y-3">
          {loading ? (
            <Card className="!rounded-[6px] text-center py-6 text-slate-500 shadow-xs border-slate-100">
              Loading customer directory...
            </Card>
          ) : customers.length === 0 ? (
            <Card className="!rounded-[6px] text-center py-6 text-slate-500 shadow-xs border-slate-100">
              <TeamOutlined className="text-3xl text-slate-400 mb-2 block" />
              No customers found.
            </Card>
          ) : (
            customers.map((row) => {
              return (
                <Card
                  key={row.id}
                  className="shadow-xs !rounded-[6px] border-slate-200/80 transition-all"
                  styles={{ body: { padding: '14px' } }}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <UserAvatar name={row.fullName} email={row.email} size="sm" />
                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-slate-900 m-0 truncate">
                            {row.fullName || 'Unnamed'}
                          </p>
                          <p className="text-xs text-slate-500 font-mono m-0 truncate mt-0.5">
                            {row.email || 'No email'}
                          </p>
                        </div>
                      </div>
                      <StatusBadge status={row.status} />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs">
                      <div className="flex items-center gap-2">
                        <TierTag tier={row.membershipTier} />
                        <span className="text-xs text-slate-700 font-semibold">
                          {(row.rewardPoints || 0).toLocaleString()} pts
                        </span>
                      </div>
                      <span className="text-xs text-slate-600 font-medium">
                        {row.totalOrders ?? 0} orders
                      </span>
                    </div>

                    <div className="flex items-center justify-between pt-1 gap-2">
                      <span className="text-xs font-mono text-slate-600">
                        Phone: {row.phoneNumber || 'N/A'}
                      </span>
                      <button
                        type="button"
                        onClick={() => openDetailModal(row)}
                        className="px-3 py-1 text-xs text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-[6px] transition-colors border border-slate-200 bg-white cursor-pointer shrink-0 font-medium"
                      >
                        Details
                      </button>
                    </div>
                  </div>
                </Card>
              );
            })
          )}

          {/* Mobile Pagination */}
          <div className="p-3 bg-white rounded-[6px] flex items-center justify-end text-xs">
            <Pagination
              className="ml-auto"
              current={pagination.current}
              pageSize={pagination.pageSize}
              total={pagination.total}
              onChange={(page: number, pageSize: number) => fetchCustomers(page, pageSize)}
              showSizeChanger={false}
              size="small"
              itemRender={(_page, type, originalElement) => {
                if (type === 'prev') {
                  return <span className="px-1 text-slate-600 text-xs font-medium">&lt; Prev</span>;
                }
                if (type === 'next') {
                  return <span className="px-1 text-[#1e4287] text-xs font-medium">Next &gt;</span>;
                }
                return originalElement;
              }}
            />
          </div>
        </div>

        {/* Desktop & Tablet View: Full Table (>= 640px) */}
        <Card className="hidden sm:block shadow-xs !rounded-[6px] border-slate-200/80 overflow-hidden" styles={{ body: { padding: '0px' } }}>
          <div className="overflow-x-auto">
            <Table
              dataSource={customers}
              columns={columns}
              rowKey="id"
              loading={loading}
              pagination={false}
              size="middle"
              scroll={{ x: 800 }}
              locale={{
                emptyText: (
                  <div className="py-12 text-center text-slate-400">
                    <TeamOutlined className="text-4xl mb-2" />
                    <p className="m-0 text-sm">No customers found</p>
                  </div>
                ),
              }}
            />
          </div>

          {/* Pagination Footer */}
          <div className="p-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
            <span className="text-sm text-slate-500">
              Showing {pagination.total > 0 ? (pagination.current - 1) * pagination.pageSize + 1 : 0} -{' '}
              {Math.min(pagination.current * pagination.pageSize, pagination.total)} of {pagination.total} customers
            </span>
            <Pagination
              className="ml-auto"
              current={pagination.current}
              pageSize={pagination.pageSize}
              total={pagination.total}
              onChange={(page: number, pageSize: number) => fetchCustomers(page, pageSize)}
              showSizeChanger={false}
              pageSizeOptions={['10', '20', '50']}
              size="small"
              itemRender={(_page, type, originalElement) => {
                if (type === 'prev') {
                  return <span className="px-1 text-slate-600 text-xs font-medium">&lt; Previous</span>;
                }
                if (type === 'next') {
                  return <span className="px-1 text-[#1e4287] text-xs font-medium">Next &gt;</span>;
                }
                return originalElement;
              }}
            />
          </div>
        </Card>
      </div>

      {/* Customer Profile & History Modal */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-base font-semibold text-slate-900 pb-2 border-b border-slate-100">
            <UserOutlined className="text-[#1e4287]" /> Customer Profile & History
          </div>
        }
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        footer={[
          <AButton key="close" onClick={() => setDetailModalOpen(false)} className="rounded-[6px] text-sm font-medium px-4">
            Close
          </AButton>,
        ]}
        width={720}
        centered
      >
        {detailLoading && !customerDetail ? (
          <div className="py-16 text-center">
            <Spin size="large" />
            <p className="mt-3 text-slate-500 text-sm">Loading customer information...</p>
          </div>
        ) : customerDetail ? (
          <div className="space-y-4 py-2">
            {/* Top Customer Info Row */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-2 border-b border-slate-100">
              <div className="flex items-center gap-3.5">
                <UserAvatar name={customerDetail.fullName} email={customerDetail.email} size="lg" />
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-bold text-slate-900 m-0">{customerDetail.fullName || 'Unnamed Customer'}</h3>
                    <TierTag tier={customerDetail.membershipTier} />
                  </div>
                  <p className="text-sm text-slate-500 font-mono m-0 mt-0.5">{customerDetail.email}</p>
                  <p className="text-sm text-slate-600 font-mono m-0 mt-0.5">{customerDetail.phoneNumber || 'No phone number'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2.5 self-end sm:self-center flex-wrap">
                <StatusBadge status={customerDetail.status} />

                {canManageCustomerStatus && (customerDetail.status || 'ACTIVE').toUpperCase() !== 'BANNED' && (
                  <Popconfirm
                    title={(customerDetail.status || 'ACTIVE').toUpperCase() === 'ACTIVE' ? 'Lock this account?' : 'Unlock this account?'}
                    description="Status change takes effect immediately."
                    onConfirm={() => handleToggleStatus(customerDetail)}
                    okText="Confirm"
                    cancelText="Cancel"
                  >
                    <button
                      type="button"
                      disabled={togglingId === customerDetail.id}
                      className={cn(
                        'px-3 py-1.5 rounded-[6px] text-xs font-medium transition-colors border cursor-pointer inline-flex items-center gap-1.5',
                        (customerDetail.status || 'ACTIVE').toUpperCase() === 'ACTIVE'
                          ? 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
                          : 'border-emerald-600 bg-emerald-600 hover:bg-emerald-700 text-white'
                      )}
                    >
                      {(customerDetail.status || 'ACTIVE').toUpperCase() === 'ACTIVE' ? <LockOutlined /> : <UnlockOutlined />}
                      {(customerDetail.status || 'ACTIVE').toUpperCase() === 'ACTIVE' ? 'Lock' : 'Unlock'}
                    </button>
                  </Popconfirm>
                )}

                {canManageCustomerStatus && ((customerDetail.status || 'ACTIVE').toUpperCase() === 'BANNED' ? (
                  <Popconfirm
                    title="Unban this customer account?"
                    description="Account will be restored to ACTIVE status."
                    onConfirm={() => handleSetStatus(customerDetail, 'ACTIVE')}
                    okText="Unban"
                    cancelText="Cancel"
                  >
                    <button
                      type="button"
                      disabled={togglingId === customerDetail.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-xs font-medium border border-emerald-600 bg-emerald-600 hover:bg-emerald-700 text-white transition-colors cursor-pointer"
                    >
                      <CheckCircleOutlined className="text-xs" />
                      Unban                   </button>
                  </Popconfirm>
                ) : (
                  <Popconfirm
                    title="Ban this customer account permanently?"
                    description="This customer will be barred from placing new orders or logging in."
                    onConfirm={() => handleSetStatus(customerDetail, 'BANNED')}
                    okText="Ban"
                    cancelText="Cancel"
                    okButtonProps={{ danger: true }}
                  >
                    <button
                      type="button"
                      disabled={togglingId === customerDetail.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-xs font-medium border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 transition-colors cursor-pointer"
                    >
                      <StopOutlined className="text-xs" />
                      Ban
                    </button>
                  </Popconfirm>
                ))}
              </div>
            </div>

            {/* Tabs: Profile & Stats vs Order History */}
            <Tabs
              defaultActiveKey="profile"
              items={[
                {
                  key: 'profile',
                  label: (
                    <span className="flex items-center gap-1.5 text-sm font-semibold">
                      <UserOutlined /> Profile & Statistics
                    </span>
                  ),
                  children: (
                    <div className="space-y-4 pt-1">
                      {/* 4-Metric Strip */}
                      <div className="bg-slate-50/70 p-4 rounded-[6px] border border-slate-200/80 flex flex-wrap items-center justify-between gap-4">
                        <div className="flex items-center gap-6 sm:gap-8 flex-wrap">
                          <div>
                            <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block">Total Orders</span>
                            <span className="text-lg font-bold text-slate-900 mt-0.5 block">
                              {customerDetail.orderStats?.totalOrders ?? customerDetail.totalOrders ?? 0}
                            </span>
                          </div>
                          <div className="h-6 w-px bg-slate-200" />
                          <div>
                            <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block">Total Spend</span>
                            <span className="text-lg font-bold text-slate-900 mt-0.5 block truncate">
                              {formatCurrency(customerDetail.orderStats?.totalSpent ?? 0)}
                            </span>
                          </div>
                          <div className="h-6 w-px bg-slate-200" />
                          <div>
                            <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block">Completed</span>
                            <span className="text-lg font-bold text-emerald-600 mt-0.5 block">
                              {customerDetail.orderStats?.completedOrders ?? 0}
                            </span>
                          </div>
                          <div className="h-6 w-px bg-slate-200" />
                          <div>
                            <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block">Cancelled</span>
                            <span className="text-lg font-bold text-rose-600 mt-0.5 block">
                              {customerDetail.orderStats?.cancelledOrders ?? 0}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Clean 2-Column Key-Value Details */}
                      <div className="bg-white rounded-[6px] border border-slate-200/80 p-4 divide-y divide-slate-100 space-y-3 text-sm">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-1">
                          <div>
                            <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">Full Name</span>
                            <span className="text-sm font-semibold text-slate-900">{customerDetail.fullName || 'N/A'}</span>
                          </div>
                          <div>
                            <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">Email Address</span>
                            <span className="text-sm font-mono text-slate-700">{customerDetail.email || 'N/A'}</span>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 pb-1">
                          <div>
                            <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">Phone Number</span>
                            <span className="text-sm font-mono text-slate-700">{customerDetail.phoneNumber || 'N/A'}</span>
                          </div>
                          <div>
                            <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">Loyalty Points</span>
                            <span className="text-sm font-bold text-amber-600">
                              {(customerDetail.rewardPoints || 0).toLocaleString()} pts
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 pb-1">
                          <div>
                            <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">Membership Tier</span>
                            <TierTag tier={customerDetail.membershipTier} />
                          </div>
                          <div>
                            <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">Registered Date</span>
                            <span className="text-sm text-slate-700">{formatDate(customerDetail.createdAt)}</span>
                          </div>
                        </div>

                        <div className="pt-3">
                          <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">Default Shipping Address</span>
                          <span className="text-sm text-slate-700 flex items-start gap-1.5">
                            <EnvironmentOutlined className="text-slate-400 mt-0.5 shrink-0" />
                            {customerDetail.defaultAddress || 'No default address specified'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'orders',
                  label: (
                    <span className="flex items-center gap-1.5 text-sm font-semibold">
                      <ShoppingOutlined /> Purchase Orders ({orderPagination.total})
                    </span>
                  ),
                  children: (
                    <div className="space-y-3 pt-1">
                      <Table
                        dataSource={customerOrders}
                        columns={orderColumns}
                        rowKey="id"
                        loading={ordersLoading}
                        pagination={false}
                        size="small"
                        expandable={{
                          expandedRowRender: (record) => (
                            <div className="p-3 bg-slate-50/70 rounded-[6px] space-y-2 border border-slate-200/70 text-sm">
                              <div className="flex flex-wrap items-center justify-between text-xs text-slate-600 gap-2">
                                <div>
                                  <span className="font-semibold text-slate-700">Recipient:</span>{' '}
                                  {record.recipientName || 'N/A'} ({record.recipientPhone || 'N/A'})
                                </div>
                                <div>
                                  <span className="font-semibold text-slate-700">Shipping Address:</span>{' '}
                                  {record.shippingAddress || 'N/A'}
                                </div>
                                {record.shipment && (
                                  <div>
                                    <span className="font-semibold text-slate-700">Tracking:</span>{' '}
                                    <Tag color="cyan">{record.shipment.trackingNumber}</Tag> ({record.shipment.courierName})
                                  </div>
                                )}
                              </div>

                              <div className="mt-2 border-t border-slate-200 pt-2">
                                <p className="text-xs font-bold text-slate-800 m-0 mb-1.5">Purchased Medicines & Items:</p>
                                <div className="space-y-1">
                                  {record.orderItems && record.orderItems.length > 0 ? (
                                    record.orderItems.map((item) => (
                                      <div
                                        key={item.id}
                                        className="flex items-center justify-between text-xs text-slate-700 py-1.5 border-b border-slate-100 last:border-0"
                                      >
                                        <div className="min-w-0">
                                          <p className="font-semibold text-slate-800 m-0 truncate">
                                            {item.medicine?.medicineName || 'Medicine Item'}
                                          </p>
                                          {item.medicine?.activeIngredients && (
                                            <p className="text-[11px] text-slate-400 m-0 truncate">
                                              {item.medicine.activeIngredients}
                                            </p>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-3 text-slate-600 font-mono text-xs shrink-0">
                                          <span>
                                            x{item.quantity} {item.packaging?.unitName || 'unit'}
                                          </span>
                                          <span className="font-bold text-slate-900">
                                            {formatCurrency(item.totalPrice)}
                                          </span>
                                        </div>
                                      </div>
                                    ))
                                  ) : (
                                    <span className="text-xs text-slate-400">No items listed for this order</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          ),
                        }}
                        locale={{
                          emptyText: (
                            <div className="py-8 text-center text-slate-400">
                              <ShoppingOutlined className="text-3xl mb-1" />
                              <p className="m-0 text-xs">No orders recorded for this customer</p>
                            </div>
                          ),
                        }}
                      />

                      {orderPagination.total > orderPagination.pageSize && (
                        <div className="flex justify-end pt-2">
                          <Pagination
                            current={orderPagination.current}
                            pageSize={orderPagination.pageSize}
                            total={orderPagination.total}
                            onChange={(page: number, pageSize: number) => {
                              if (selectedCustomerId) {
                                fetchCustomerOrders(selectedCustomerId, page, pageSize);
                              }
                            }}
                            size="small"
                          />
                        </div>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          </div>
        ) : null}
      </Modal>
    </>
  );
}
