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
import { AdminLayout } from '@/components/layout/AdminLayout';
import {
  customerService,
  Customer,
  CustomerQuery,
  CustomerOrderDetail,
} from '@/services/customer.service';

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
    <span
      style={{
        color: meta.color,
        background: meta.bg,
        border: `1px solid ${meta.border}`,
      }}
      className="text-xs font-semibold px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 shadow-xs"
    >
      <TrophyOutlined className="text-[10px]" />
      {meta.label}
    </span>
  );
};

const StatusBadge: React.FC<{ status?: string }> = ({ status }) => {
  const normalized = (status || 'ACTIVE').toUpperCase();
  if (normalized === 'ACTIVE') {
    return (
      <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 inline-flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        Active
      </span>
    );
  }
  if (normalized === 'BANNED') {
    return (
      <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 inline-flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-rose-600" />
        Banned
      </span>
    );
  }
  return (
    <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 inline-flex items-center gap-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
      Locked
    </span>
  );
};

const UserAvatar: React.FC<{ name?: string; email?: string; size?: 'sm' | 'md' | 'lg' }> = ({
  name,
  email,
  size = 'md',
}) => {
  const initials = (name || email || 'C')
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const sizeClass =
    size === 'lg'
      ? 'w-14 h-14 text-lg'
      : size === 'sm'
        ? 'w-8 h-8 text-xs'
        : 'w-10 h-10 text-sm';

  return (
    <div
      className={`${sizeClass} rounded-full bg-gradient-to-tr from-[#1e4287] to-[#3a6bc4] text-white font-bold flex items-center justify-center shadow-xs shrink-0 select-none`}
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
      width: 220,
      render: (_: any, row: Customer) => (
        <div className="flex items-center gap-3">
          <UserAvatar name={row.fullName} email={row.email} size="sm" />
          <div className="min-w-0">
            <p className="font-semibold text-sm text-slate-800 m-0 truncate">{row.fullName || 'Unnamed'}</p>
            <p className="text-xs text-slate-500 font-mono m-0 truncate">{row.email || 'No email'}</p>
          </div>
        </div>
      ),
    },
    {
      title: 'Phone Number',
      dataIndex: 'phoneNumber',
      key: 'phoneNumber',
      width: 140,
      render: (phone: string) => (
        <span className="font-mono text-xs text-slate-700">{phone || 'N/A'}</span>
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
      width: 130,
      align: 'right' as const,
      render: (points: number) => (
        <span className="font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded text-xs">
          {(points || 0).toLocaleString()} pts
        </span>
      ),
    },
    {
      title: 'Total Orders',
      key: 'totalOrders',
      width: 110,
      align: 'center' as const,
      render: (_: any, row: Customer) => (
        <Tag color="blue" className="rounded-full px-2.5 font-semibold">
          {row.totalOrders ?? 0} orders
        </Tag>
      ),
    },
    {
      title: 'Joined Date',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 140,
      render: (dateStr: string) => (
        <span className="text-xs text-slate-500">{formatDate(dateStr)}</span>
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
      width: 110,
      align: 'center' as const,
      render: (_: any, row: Customer) => (
        <Tooltip title="View Profile & Order History">
          <AButton
            size="small"
            icon={<EyeOutlined />}
            onClick={() => openDetailModal(row)}
            className="!shadow-none hover:!border-[#1e4287] hover:!text-[#1e4287] font-medium text-xs"
          >
            Details
          </AButton>
        </Tooltip>
      ),
    },
  ];

  const orderColumns = [
    {
      title: 'Order Code',
      dataIndex: 'orderCode',
      key: 'orderCode',
      width: 140,
      render: (code: string) => <span className="font-mono font-bold text-xs text-[#1e4287]">{code}</span>,
    },
    {
      title: 'Date',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 140,
      render: (dateStr: string) => <span className="text-xs text-slate-500">{formatDate(dateStr)}</span>,
    },
    {
      title: 'Total Amount',
      dataIndex: 'totalAmount',
      key: 'totalAmount',
      width: 130,
      align: 'right' as const,
      render: (amt: number) => (
        <span className="font-bold text-xs text-slate-800">{formatCurrency(amt)}</span>
      ),
    },
    {
      title: 'Payment',
      key: 'payment',
      width: 130,
      render: (_: any, item: CustomerOrderDetail) => {
        const isPaid = (item.paymentStatus || '').toUpperCase() === 'PAID';
        return (
          <div className="space-y-0.5">
            <span className="text-xs font-mono text-slate-600 block">{item.paymentMethod}</span>
            <Tag color={isPaid ? 'green' : 'orange'} className="text-[10px] px-1.5 py-0">
              {item.paymentStatus}
            </Tag>
          </div>
        );
      },
    },
    {
      title: 'Order Status',
      dataIndex: 'orderStatus',
      key: 'orderStatus',
      width: 130,
      render: (status: string) => {
        const s = (status || '').toUpperCase();
        let color = 'default';
        if (['DELIVERED', 'COMPLETED', 'HOANTHANH'].includes(s)) color = 'success';
        else if (['SHIPPING', 'DANGGIAO'].includes(s)) color = 'processing';
        else if (['PENDING', 'CHODUYET'].includes(s)) color = 'warning';
        else if (['CANCELLED', 'DAHUY'].includes(s)) color = 'error';
        return (
          <Tag color={color} className="font-semibold text-xs px-2 py-0.5">
            {status}
          </Tag>
        );
      },
    },
  ];

  if (!mounted || !isAuthenticated || !currentUser) {
    return null;
  }

  return (
    <AdminLayout>
      {contextHolder}

      <div className="space-y-4 sm:space-y-6">
        {/* Header Action Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 sm:p-6 !rounded-md shadow-xs border border-slate-100">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 m-0 flex items-center gap-2">
              <TeamOutlined className="text-[#1e4287]" /> Customer Directory & Accounts
            </h2>
            <p className="text-slate-500 text-xs sm:text-sm m-0 mt-1">
              Manage registered customers, loyalty tiers, reward points, and purchase history
            </p>
          </div>
          <div className="flex items-center gap-2">
            <AButton
              icon={<ReloadOutlined />}
              onClick={() => fetchCustomers(pagination.current, pagination.pageSize)}
              loading={loading}
              className="!shadow-none"
            >
              Refresh
            </AButton>
          </div>
        </div>

        {/* KPI Statistics Overview Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="shadow-xs !rounded-md border-slate-100" styles={{ body: { padding: '16px' } }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider m-0">Total Customers</p>
                <h3 className="text-2xl font-bold text-slate-900 m-0 mt-1">{totalCount.toLocaleString()}</h3>
              </div>
              <div className="w-10 h-10 rounded-lg bg-blue-50 text-[#1e4287] flex items-center justify-center text-lg">
                <TeamOutlined />
              </div>
            </div>
          </Card>

          <Card className="shadow-xs !rounded-md border-slate-100" styles={{ body: { padding: '16px' } }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider m-0">Active Accounts</p>
                <h3 className="text-2xl font-bold text-emerald-600 m-0 mt-1">{activeCount}</h3>
              </div>
              <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center text-lg">
                <CheckCircleOutlined />
              </div>
            </div>
          </Card>

          <Card className="shadow-xs !rounded-md border-slate-100" styles={{ body: { padding: '16px' } }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider m-0">Locked Accounts</p>
                <h3 className="text-2xl font-bold text-rose-600 m-0 mt-1">{lockedCount}</h3>
              </div>
              <div className="w-10 h-10 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center text-lg">
                <LockOutlined />
              </div>
            </div>
          </Card>

          <Card className="shadow-xs !rounded-md border-slate-100" styles={{ body: { padding: '16px' } }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider m-0">VIP / Gold+ Tier</p>
                <h3 className="text-2xl font-bold text-amber-600 m-0 mt-1">{vipCount}</h3>
              </div>
              <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center text-lg">
                <TrophyOutlined />
              </div>
            </div>
          </Card>
        </div>

        {/* Filter Controls Bar */}
        <Card className="shadow-xs !rounded-md border-slate-100" styles={{ body: { padding: '16px' } }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            <Input
              placeholder="Search name, email, or phone number"
              prefix={<SearchOutlined className="text-slate-400" />}
              value={searchVal}
              onChange={(e) => setSearchVal(e.target.value)}
              onPressEnter={handleSearchClick}
              allowClear
            />

            <Select
              placeholder="Filter by Membership Tier"
              value={tierFilter}
              onChange={(v) => setTierFilter(v)}
              options={TIER_OPTIONS}
              allowClear
            />

            <Select
              placeholder="Filter by Status"
              value={statusFilter}
              onChange={(v) => setStatusFilter(v)}
              options={STATUS_OPTIONS}
              allowClear
            />

            <div className="flex gap-2">
              <AButton
                type="primary"
                icon={<SearchOutlined />}
                onClick={handleSearchClick}
                className="bg-[#1e4287] hover:bg-[#153166] flex-1 !shadow-none font-semibold"
              >
                Search
              </AButton>
              <AButton icon={<ReloadOutlined />} onClick={handleResetFilters} className="!shadow-none">
                Reset
              </AButton>
            </div>
          </div>
        </Card>

        {/* Mobile View: Compact Card List (< 640px) */}
        <div className="block sm:hidden space-y-3">
          {loading ? (
            <Card className="!rounded-md text-center py-6 text-slate-500 shadow-xs border-slate-100">
              Loading customer directory...
            </Card>
          ) : customers.length === 0 ? (
            <Card className="!rounded-md text-center py-6 text-slate-500 shadow-xs border-slate-100">
              <TeamOutlined className="text-3xl text-slate-400 mb-2 block" />
              No customers found.
            </Card>
          ) : (
            customers.map((row) => {
              const isActive = (row.status || 'ACTIVE').toUpperCase() === 'ACTIVE';
              return (
                <Card
                  key={row.id}
                  className="shadow-xs !rounded-md border-slate-100 transition-all"
                  styles={{ body: { padding: '14px' } }}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <UserAvatar name={row.fullName} email={row.email} size="sm" />
                        <div className="min-w-0">
                          <p className="font-bold text-sm text-slate-900 m-0 truncate">
                            {row.fullName || 'Unnamed'}
                          </p>
                          <p className="text-xs text-slate-500 font-mono m-0 truncate">
                            {row.email || 'No email'}
                          </p>
                        </div>
                      </div>
                      <StatusBadge status={row.status} />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs">
                      <div className="flex items-center gap-2">
                        <TierTag tier={row.membershipTier} />
                        <span className="font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded text-[11px]">
                          {(row.rewardPoints || 0).toLocaleString()} pts
                        </span>
                      </div>
                      <Tag color="blue" className="rounded-full px-2 text-[11px] font-semibold m-0">
                        {row.totalOrders ?? 0} orders
                      </Tag>
                    </div>

                    <div className="flex items-center justify-between pt-1 gap-2">
                      <span className="text-[11px] font-mono text-slate-600">
                        SĐT: {row.phoneNumber || 'N/A'}
                      </span>
                      <AButton
                        size="small"
                        icon={<EyeOutlined />}
                        onClick={() => openDetailModal(row)}
                        className="!shadow-none font-medium text-xs"
                      >
                        Details
                      </AButton>
                    </div>
                  </div>
                </Card>
              );
            })
          )}

          {/* Mobile Pagination */}
          <div className="p-3 bg-white rounded-md border border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-500">{pagination.total} customers</span>
            <Pagination
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
        <Card className="hidden sm:block shadow-xs !rounded-md border-slate-100 overflow-hidden" styles={{ body: { padding: '0px' } }}>
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
            <span className="text-xs text-slate-500">
              Showing {(pagination.current - 1) * pagination.pageSize + 1} -{' '}
              {Math.min(pagination.current * pagination.pageSize, pagination.total)} of {pagination.total} customers
            </span>
            <Pagination
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

      {/* Customer Details & Orders Modal */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-base font-bold text-slate-900">
            <UserOutlined className="text-[#1e4287]" /> Customer Profile & History
          </div>
        }
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        footer={[
          <AButton key="close" onClick={() => setDetailModalOpen(false)}>
            Close
          </AButton>,
        ]}
        width={780}
        centered
      >
        {detailLoading && !customerDetail ? (
          <div className="py-16 text-center">
            <Spin size="large" />
            <p className="mt-3 text-slate-500 text-sm">Loading customer information...</p>
          </div>
        ) : customerDetail ? (
          <div className="space-y-4 mt-2">
            {/* Top Customer Header Card */}
            <div className="p-4 bg-slate-50 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border border-slate-100">
              <div className="flex items-center gap-3.5">
                <UserAvatar name={customerDetail.fullName} email={customerDetail.email} size="lg" />
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900 m-0">{customerDetail.fullName || 'Unnamed Customer'}</h3>
                    <TierTag tier={customerDetail.membershipTier} />
                  </div>
                  <p className="text-xs text-slate-500 font-mono m-0 mt-0.5">{customerDetail.email}</p>
                  <p className="text-xs text-slate-600 font-mono m-0 mt-0.5">{customerDetail.phoneNumber || 'No phone number'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 self-end sm:self-center">
                <StatusBadge status={customerDetail.status} />

                {(customerDetail.status || 'ACTIVE').toUpperCase() !== 'BANNED' && (
                  <Popconfirm
                    title={(customerDetail.status || 'ACTIVE').toUpperCase() === 'ACTIVE' ? 'Lock this account?' : 'Unlock this account?'}
                    description="Status change takes effect immediately."
                    onConfirm={() => handleToggleStatus(customerDetail)}
                    okText="Confirm"
                    cancelText="Cancel"
                  >
                    <AButton
                      size="small"
                      icon={(customerDetail.status || 'ACTIVE').toUpperCase() === 'ACTIVE' ? <LockOutlined /> : <UnlockOutlined />}
                      loading={togglingId === customerDetail.id}
                      className={`!shadow-none font-semibold text-xs ${(customerDetail.status || 'ACTIVE').toUpperCase() === 'ACTIVE'
                        ? '!bg-amber-50 hover:!bg-amber-100 !text-amber-700 !border-amber-200'
                        : '!bg-emerald-600 hover:!bg-emerald-700 !text-white !border-none'
                        }`}
                    >
                      {(customerDetail.status || 'ACTIVE').toUpperCase() === 'ACTIVE' ? 'Lock' : 'Unlock'}
                    </AButton>
                  </Popconfirm>
                )}

                {(customerDetail.status || 'ACTIVE').toUpperCase() === 'BANNED' ? (
                  <Popconfirm
                    title="Unban this customer account?"
                    description="Account will be restored to ACTIVE status."
                    onConfirm={() => handleSetStatus(customerDetail, 'ACTIVE')}
                    okText="Unban"
                    cancelText="Cancel"
                  >
                    <AButton
                      size="small"
                      type="primary"
                      icon={<UnlockOutlined />}
                      loading={togglingId === customerDetail.id}
                      className="!shadow-none !bg-emerald-600 hover:!bg-emerald-700 !text-white !border-none font-semibold text-xs"
                    >
                      Unban Account
                    </AButton>
                  </Popconfirm>
                ) : (
                  <Popconfirm
                    title="Ban this customer account permanently?"
                    description="This customer will be barred from placing new orders or logging in."
                    onConfirm={() => handleSetStatus(customerDetail, 'BANNED')}
                    okText="Ban Account"
                    cancelText="Cancel"
                    okButtonProps={{ danger: true }}
                  >
                    <AButton
                      size="small"
                      icon={<StopOutlined />}
                      loading={togglingId === customerDetail.id}
                      className="!shadow-none font-semibold text-xs !bg-rose-50 hover:!bg-rose-100 !text-rose-700 !border-rose-200"
                    >
                      Ban
                    </AButton>
                  </Popconfirm>
                )}
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
                    <div className="space-y-4">
                      {/* 4-Card Order Statistics Grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="p-3 bg-blue-50/60 rounded-lg border border-blue-100 text-center">
                          <p className="text-slate-500 text-[11px] font-semibold uppercase m-0">Total Orders</p>
                          <p className="text-lg font-bold text-slate-800 m-0 mt-1">
                            {customerDetail.orderStats?.totalOrders ?? customerDetail.totalOrders ?? 0}
                          </p>
                        </div>
                        <div className="p-3 bg-emerald-50/60 rounded-lg border border-emerald-100 text-center">
                          <p className="text-slate-500 text-[11px] font-semibold uppercase m-0">Total Spend</p>
                          <p className="text-lg font-bold text-emerald-700 m-0 mt-1 truncate">
                            {formatCurrency(customerDetail.orderStats?.totalSpent ?? 0)}
                          </p>
                        </div>
                        <div className="p-3 bg-teal-50/60 rounded-lg border border-teal-100 text-center">
                          <p className="text-slate-500 text-[11px] font-semibold uppercase m-0">Completed</p>
                          <p className="text-lg font-bold text-teal-700 m-0 mt-1">
                            {customerDetail.orderStats?.completedOrders ?? 0}
                          </p>
                        </div>
                        <div className="p-3 bg-rose-50/60 rounded-lg border border-rose-100 text-center">
                          <p className="text-slate-500 text-[11px] font-semibold uppercase m-0">Cancelled</p>
                          <p className="text-lg font-bold text-rose-600 m-0 mt-1">
                            {customerDetail.orderStats?.cancelledOrders ?? 0}
                          </p>
                        </div>
                      </div>

                      {/* Detailed Descriptions */}
                      <Descriptions bordered column={{ xs: 1, sm: 2 }} size="small">
                        <Descriptions.Item label="Full Name">
                          <span className="font-semibold text-slate-800">{customerDetail.fullName || 'N/A'}</span>
                        </Descriptions.Item>
                        <Descriptions.Item label="Email Address">
                          <span className="font-mono text-xs text-slate-700">{customerDetail.email || 'N/A'}</span>
                        </Descriptions.Item>
                        <Descriptions.Item label="Phone Number">
                          <span className="font-mono text-xs text-slate-700">{customerDetail.phoneNumber || 'N/A'}</span>
                        </Descriptions.Item>
                        <Descriptions.Item label="Loyalty Points">
                          <span className="font-bold text-amber-600">
                            {(customerDetail.rewardPoints || 0).toLocaleString()} pts
                          </span>
                        </Descriptions.Item>
                        <Descriptions.Item label="Membership Tier">
                          <TierTag tier={customerDetail.membershipTier} />
                        </Descriptions.Item>
                        <Descriptions.Item label="Registered Date">
                          <span className="text-xs text-slate-600">{formatDate(customerDetail.createdAt)}</span>
                        </Descriptions.Item>
                        <Descriptions.Item label="Default Shipping Address" span={{ xs: 1, sm: 2 }}>
                          <span className="text-xs text-slate-700 flex items-start gap-1">
                            <EnvironmentOutlined className="text-slate-400 mt-0.5" />
                            {customerDetail.defaultAddress || 'No default address specified'}
                          </span>
                        </Descriptions.Item>
                      </Descriptions>
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
                    <div className="space-y-3">
                      <Table
                        dataSource={customerOrders}
                        columns={orderColumns}
                        rowKey="id"
                        loading={ordersLoading}
                        pagination={false}
                        size="small"
                        expandable={{
                          expandedRowRender: (record) => (
                            <div className="p-3 bg-slate-50 rounded-lg space-y-2 border border-slate-200">
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
                                        className="flex items-center justify-between text-xs bg-white p-2 rounded border border-slate-100"
                                      >
                                        <div className="min-w-0">
                                          <p className="font-semibold text-slate-800 m-0 truncate">
                                            {item.medicine?.medicineName || 'Medicine Item'}
                                          </p>
                                          {item.medicine?.activeIngredients && (
                                            <p className="text-[10px] text-slate-400 m-0 truncate">
                                              {item.medicine.activeIngredients}
                                            </p>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-3 text-slate-600 font-mono text-xs shrink-0">
                                          <span>
                                            x{item.quantity} {item.packaging?.unitName || 'unit'}
                                          </span>
                                          <span className="font-bold text-slate-800">
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
    </AdminLayout>
  );
}
