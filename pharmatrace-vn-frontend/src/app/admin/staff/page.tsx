'use client';

import { useHydrated } from '@/hooks/useHydrated';
import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Table,
  Button as AButton,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Popconfirm,
  Tag,
  Card,
  Space,
  Tooltip,
  Pagination,
  message,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
  ReloadOutlined,
  TeamOutlined,
  LogoutOutlined,
  DashboardOutlined,
  EyeOutlined,
  UserOutlined,
  MailOutlined,
  SafetyCertificateOutlined,
  HomeOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '@/store/useAuthStore';
import {
  employeeService,
  Employee,
  EmployeeQuery,
} from '@/services/employee.service';
import { facilityService } from '@/services/facility.service';
import { apiClient } from '@/services/api.client';
import { cn, getAvatarColor } from '@/utils';

const ROLES_OPTIONS = [
  { value: 'SUPER_ADMIN', label: 'Super Admin', color: 'red' },
  { value: 'STORE_MANAGER', label: 'Store Manager', color: 'orange' },
  { value: 'WAREHOUSE_MANAGER', label: 'Warehouse Manager', color: 'purple' },
  { value: 'WAREHOUSE_STAFF', label: 'Warehouse Staff', color: 'blue' },
  { value: 'PHARMACIST', label: 'Pharmacist', color: 'cyan' },
  { value: 'ACCOUNTANT', label: 'Accountant', color: 'blue' },
  { value: 'FINANCE_MANAGER', label: 'Finance Manager', color: 'gold' },
];

const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active Account' },
  { value: 'INACTIVE', label: 'Disabled Account' },
];

const ROLE_MAP: Record<string, { label: string; color: string }> = {
  SUPER_ADMIN: { label: 'Super Admin', color: 'red' },
  SUPERADMIN: { label: 'Super Admin', color: 'red' },
  STORE_MANAGER: { label: 'Store Manager', color: 'orange' },
  STOREMANAGER: { label: 'Store Manager', color: 'orange' },
  WAREHOUSE_MANAGER: { label: 'Warehouse Manager', color: 'purple' },
  WAREHOUSEMANAGER: { label: 'Warehouse Manager', color: 'purple' },
  WAREHOUSE_STAFF: { label: 'Warehouse Staff', color: 'purple' },
  WAREHOUSESTAFF: { label: 'Warehouse Staff', color: 'purple' },
  FACTORY_WAREHOUSE_STAFF: { label: 'Factory Staff', color: 'purple' },
  FACTORYWAREHOUSESTAFF: { label: 'Factory Staff', color: 'purple' },
  PHARMACIST: { label: 'Pharmacist', color: 'cyan' },
  ACCOUNTANT: { label: 'Accountant', color: 'blue' },
  FINANCE_MANAGER: { label: 'Finance Manager', color: 'gold' },
  FINANCEMANAGER: { label: 'Finance Manager', color: 'gold' },
};

const getRoleBadge = (roleStr: string) => {
  const normalized = (roleStr || '').toUpperCase().replace(/[\s_-]/g, '');
  const matched = ROLE_MAP[normalized] || ROLE_MAP[roleStr?.toUpperCase()];
  return (
    <span className="text-xs font-medium text-slate-700 bg-slate-100 px-2 py-0.5 rounded-[6px] border border-slate-200/60 inline-block">
      {matched?.label || roleStr || 'Staff'}
    </span>
  );
};



const UserAvatar: React.FC<{ name?: string; email?: string; size?: 'normal' | 'large' }> = ({
  name,
  email,
  size = 'normal',
}) => {
  const identifier = name || email || 'U';
  const initials = identifier
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const bg = getAvatarColor(identifier);
  const sizeClass = size === 'large' ? 'w-12 h-12 text-base font-bold' : 'w-8 h-8 text-xs font-bold';
  return (
    <div
      style={{ backgroundColor: bg }}
      className={`${sizeClass} rounded-full text-white flex items-center justify-center shrink-0 select-none shadow-xs`}
    >
      {initials}
    </div>
  );
};

export default function StaffManagementPage() {
  const router = useRouter();
  const getIsAuthenticated = useAuthStore((state) => state.getIsAuthenticated);
  const getUser = useAuthStore((state) => state.getUser);
  const logout = useAuthStore((state) => state.logout);

  const [messageApi, contextHolder] = message.useMessage();

  const mounted = useHydrated();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  // Add / Edit Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [saving, setSaving] = useState(false);

  // View Details Modal state
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [viewingEmployee, setViewingEmployee] = useState<Employee | null>(null);
  const viewingEmployeeRef = React.useRef<Employee | null>(null);
  useEffect(() => {
    viewingEmployeeRef.current = viewingEmployee;
  }, [viewingEmployee]);

  const [searchVal, setSearchVal] = useState('');
  const [roleFilter, setRoleFilter] = useState<string | undefined>(undefined);
  const [facilityFilter, setFacilityFilter] = useState<number | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [facilityOptions, setFacilityOptions] = useState<Array<{ value: number; label: string }>>([]);
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 10,
    total: 0,
  });

  const [form] = Form.useForm();

  const isAuthenticated = mounted ? getIsAuthenticated() : false;
  const currentUser = mounted ? getUser() : null;
  const isStoreManager = currentUser?.role === 'STORE_MANAGER';

  useEffect(() => {
    if (mounted && !isAuthenticated) {
      router.push('/admin/login');
    }
  }, [mounted, isAuthenticated, router]);

  const fetchEmployees = useCallback(
    async (page = 1, limit = 10) => {
      setLoading(true);
      try {
        const query: EmployeeQuery = {
          page,
          limit,
          search: searchVal ? searchVal.trim() : undefined,
          role: roleFilter || undefined,
          facilityId: facilityFilter !== undefined ? facilityFilter : undefined,
          status: statusFilter || undefined,
        };
        const res = await employeeService.getEmployees(query);
        setEmployees(res.data);
        setPagination({
          current: res.pagination.page,
          pageSize: res.pagination.limit,
          total: res.pagination.total,
        });
      } catch (err: any) {
        messageApi.error(err?.message || 'Failed to fetch employees');
      } finally {
        setLoading(false);
      }
    },
    [searchVal, roleFilter, facilityFilter, statusFilter, messageApi],
  );

  useEffect(() => {
    // Cancel pending work when dependencies change or the component unmounts.
    const timer = setTimeout(() => {
      if (mounted && isAuthenticated) {
        fetchEmployees(pagination.current, pagination.pageSize);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [mounted, isAuthenticated, fetchEmployees, pagination.current, pagination.pageSize]);

  useEffect(() => {
    const fetchFacilities = async () => {
      try {
        const res = await facilityService.getDropdownList();
        if (res && res.data) {
          setFacilityOptions(
            res.data.map((f) => ({
              value: f.id,
              label: `${f.name} (${f.type})`,
            }))
          );
        }
      } catch (err) {
        console.error('Failed to load facilities:', err);
      }
    };
    if (mounted && isAuthenticated) {
      fetchFacilities();
    }
  }, [mounted, isAuthenticated]);

  const handleSearchClick = () => {
    fetchEmployees(1, pagination.pageSize);
  };

  const handleResetFilters = () => {
    setSearchVal('');
    setRoleFilter(undefined);
    setFacilityFilter(undefined);
    setStatusFilter(undefined);
    setTimeout(() => {
      fetchEmployees(1, pagination.pageSize);
    }, 0);
  };

  const openModal = (emp?: Employee) => {
    setEditingEmployee(emp || null);
    if (emp) {
      form.setFieldsValue({
        fullName: emp.fullName,
        email: emp.email,
        role: emp.role,
        facilityId: emp.facilityId,
        status: emp.status === 'ACTIVE',
      });
    } else {
      form.resetFields();
      form.setFieldsValue({
        role: 'WAREHOUSE_STAFF',
        facilityId: isStoreManager ? currentUser?.facilityId : undefined,
        status: true,
      });
    }
    setModalOpen(true);
  };

  const openDetailModal = (emp: Employee) => {
    setViewingEmployee(emp);
    setDetailModalOpen(true);
  };

  const handleSave = async (values: any) => {
    setSaving(true);
    try {
      const payload = {
        fullName: values.fullName,
        email: values.email,
        role: values.role,
        facilityId: values.facilityId,
        password: values.password || undefined,
      };

      if (editingEmployee) {
        await employeeService.updateEmployee(editingEmployee.id, { ...payload, status: values.status ? 'ACTIVE' : 'INACTIVE' });
        messageApi.success('Employee updated successfully');
      } else {
        await employeeService.createEmployee(payload as any);
        messageApi.success('Employee created successfully');
      }

      setModalOpen(false);
      fetchEmployees(pagination.current, pagination.pageSize);
    } catch (err: any) {
      const detail = err?.message;
      messageApi.error(Array.isArray(detail) ? detail.join('; ') : detail || 'Failed to save employee');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await employeeService.deleteEmployee(id);
      messageApi.success('Employee deleted successfully');
      setDetailModalOpen(false);
      fetchEmployees(pagination.current, pagination.pageSize);
    } catch (err: any) {
      messageApi.error(err?.message || 'Failed to delete employee');
    }
  };

  const handleStatusToggle = async (emp: Employee) => {
    const newStatus = emp.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await employeeService.updateEmployeeStatus(emp.id, newStatus);
      messageApi.success(`Employee account set to ${newStatus}`);
      fetchEmployees(pagination.current, pagination.pageSize);
    } catch (err: any) {
      messageApi.error(err?.message || 'Failed to update employee status');
    }
  };

  const handleLogout = async () => {
    await logout();
    router.push('/admin/login');
  };

  const columns = [
    {
      title: 'Staff Member',
      key: 'name',
      width: 220,
      render: (_: any, row: Employee) => (
        <div className="flex items-center gap-3">
          <UserAvatar name={row.fullName} email={row.email} />
          <div className="min-w-0">
            <p className="font-semibold text-sm text-slate-900 m-0 truncate">{row.fullName}</p>
            <p className="text-xs text-slate-500 font-mono m-0 truncate mt-0.5">{row.email}</p>
          </div>
        </div>
      ),
    },
    {
      title: 'System Role',
      dataIndex: 'role',
      key: 'role',
      width: 160,
      render: (role: string) => getRoleBadge(role),
    },
    {
      title: 'Assigned Facility',
      key: 'facility',
      width: 200,
      render: (_: any, row: Employee) => {
        const facName = row.facility?.name || `Facility #${row.facilityId}`;
        return <span className="text-sm text-slate-800 truncate block max-w-[200px] font-medium">{facName}</span>;
      },
    },
    {
      title: 'Status',
      key: 'status',
      width: 130,
      render: (_: any, row: Employee) => {
        const isActive = row.status === 'ACTIVE';
        const isSelf = row.id === currentUser?.id;
        return (
          <div className="flex items-center gap-2">
            <Tooltip title={isSelf ? 'Cannot disable your own account' : ''}>
              <Switch
                size="small"
                checked={isActive}
                disabled={isSelf}
                onChange={() => handleStatusToggle(row)}
              />
            </Tooltip>
            <span className={cn('text-sm font-medium', isActive ? 'text-emerald-600' : 'text-slate-400')}>
              {isActive ? 'Active' : 'Disabled'}
            </span>
          </div>
        );
      },
    },
    {
      title: 'Details',
      key: 'details',
      width: 100,
      align: 'center' as const,
      render: (_: any, row: Employee) => (
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
              Staff & RBAC
            </h1>
            <p className="text-slate-500 text-sm m-0 mt-0.5">
              User directory, roles authorization, and facility assignments ({pagination.total} total)
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fetchEmployees(pagination.current, pagination.pageSize)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[6px] border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <ReloadOutlined className={cn(loading && 'animate-spin')} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => openModal()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[6px] bg-[#1e4287] hover:bg-[#163266] text-white text-sm font-medium transition-colors cursor-pointer border-none shadow-xs"
            >
              <PlusOutlined />
              Add Staff Member
            </button>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="bg-white p-3 sm:p-4 rounded-[6px] border border-slate-200/80 shadow-xs">
          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-5 gap-2 sm:gap-3">
            <div className="col-span-2 md:col-span-1">
              <Input
                placeholder="Search name or email"
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
                placeholder="System Role"
                value={roleFilter}
                onChange={(val) => setRoleFilter(val)}
                allowClear
                className="text-xs sm:text-sm h-9 sm:h-10 w-full"
                options={ROLES_OPTIONS.filter((r) => !isStoreManager || ['PHARMACIST', 'WAREHOUSE_STAFF'].includes(r.value)).map((r) => ({ value: r.value, label: r.label }))}
              />
            </div>

            <div className="col-span-1">
              <Select
                placeholder="Account Status"
                value={statusFilter}
                onChange={(val) => setStatusFilter(val)}
                allowClear
                className="text-xs sm:text-sm h-9 sm:h-10 w-full"
                options={STATUS_OPTIONS}
              />
            </div>

            <div className="col-span-2 sm:col-span-1">
              <Select
                placeholder="Assigned Facility"
                value={facilityFilter}
                onChange={(val) => setFacilityFilter(val)}
                allowClear
                showSearch
                filterOption={(input, option) =>
                  (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                }
                className="text-xs sm:text-sm h-9 sm:h-10 w-full"
                options={facilityOptions}
              />
            </div>

            <div className="col-span-2 sm:col-span-1 flex gap-2">
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
            <Card className="!rounded-[6px] text-center py-6 text-slate-500">Loading staff directory...</Card>
          ) : employees.length === 0 ? (
            <Card className="!rounded-[6px] text-center py-6 text-slate-500">No staff members found.</Card>
          ) : (
            employees.map((row) => {
              const isActive = row.status === 'ACTIVE';
              const isSelf = row.id === currentUser?.id;
              return (
                <Card
                  key={row.id}
                  className="shadow-xs !rounded-[6px] border-slate-200/80 hover:border-slate-300 transition-all cursor-pointer"
                  styles={{ body: { padding: '14px' } }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <UserAvatar name={row.fullName} email={row.email} />
                      <div className="min-w-0">
                        <p className="font-semibold text-sm text-slate-900 m-0 truncate">{row.fullName}</p>
                        <div className="mt-1 flex items-center gap-2">
                          {getRoleBadge(row.role)}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDetailModal(row);
                      }}
                      className="px-2.5 py-1 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-[6px] transition-colors border border-slate-200 bg-white cursor-pointer shrink-0"
                    >
                      Details
                    </button>
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                    <span className="truncate font-mono">{row.email}</span>
                    <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <Tooltip title={isSelf ? 'Cannot disable your own account' : ''}>
                        <Switch
                          size="small"
                          checked={isActive}
                          disabled={isSelf}
                          onChange={() => handleStatusToggle(row)}
                        />
                      </Tooltip>
                      <span className={`font-medium ${isActive ? 'text-emerald-600' : 'text-slate-400'}`}>
                        {isActive ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                  </div>
                </Card>
              );
            })
          )}

          {/* Mobile Pagination */}
          <div className="flex justify-end pt-2">
            <Pagination
              className="ml-auto"
              current={pagination.current}
              pageSize={pagination.pageSize}
              total={pagination.total}
              showSizeChanger={false}
              onChange={(page, pageSize) => fetchEmployees(page, pageSize)}
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
        <Card className="hidden sm:block shadow-xs !rounded-[6px] border-slate-200/80 overflow-hidden" styles={{ body: { padding: 0 } }}>
          <Table
            dataSource={employees}
            columns={columns}
            rowKey="id"
            loading={loading}
            pagination={{
              placement: ['bottomEnd'],
              current: pagination.current,
              pageSize: pagination.pageSize,
              total: pagination.total,
              showSizeChanger: false,
              onChange: (page, pageSize) => fetchEmployees(page, pageSize),
              itemRender: (_page, type, originalElement) => {
                if (type === 'prev') {
                  return <span className="px-1 text-slate-600 text-xs font-medium">&lt; Previous</span>;
                }
                if (type === 'next') {
                  return <span className="px-1 text-[#1e4287] text-xs font-medium">Next &gt;</span>;
                }
                return originalElement;
              },
            }}
            size="middle"
          />
        </Card>
      </div>

      {/* View Staff Member Details Modal */}
      {viewingEmployee && (
        <Modal
          title={
            <div className="font-semibold text-base text-slate-900 flex items-center gap-2">
              <UserOutlined className="text-[#1e4287]" /> Staff Member Profile
            </div>
          }
          open={detailModalOpen}
          onCancel={() => setDetailModalOpen(false)}
          footer={
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
              {viewingEmployee.id === currentUser?.id ? (
                <Tooltip title="Cannot delete your own account">
                  <span>
                    <AButton size="small" danger icon={<DeleteOutlined />} disabled className="rounded-[6px] text-xs shadow-none">
                      Delete
                    </AButton>
                  </span>
                </Tooltip>
              ) : (
                <Popconfirm
                  title="Delete staff member?"
                  description="This action cannot be undone."
                  onConfirm={() => handleDelete(viewingEmployee.id)}
                  okText="Delete"
                  cancelText="Cancel"
                  okButtonProps={{ danger: true, size: 'small' }}
                >
                  <AButton size="small" danger icon={<DeleteOutlined />} className="rounded-[6px] text-xs shadow-none">
                    Delete
                  </AButton>
                </Popconfirm>
              )}

              <AButton
                type="primary"
                size="small"
                icon={<EditOutlined />}
                onClick={() => {
                  setDetailModalOpen(false);
                  openModal(viewingEmployee);
                }}
                className="bg-[#1e4287] hover:bg-[#153166] font-medium text-xs rounded-[6px] !shadow-none border-0"
              >
                Edit Profile
              </AButton>
            </div>
          }
          centered
          width={500}
        >
          <div className="py-2 space-y-4">
            {/* Header Profile Summary */}
            <div className="flex items-center gap-3.5 bg-slate-50/70 p-3.5 rounded-[6px] border border-slate-200/70">
              <UserAvatar name={viewingEmployee.fullName} email={viewingEmployee.email} size="large" />
              <div className="min-w-0">
                <h3 className="font-semibold text-sm text-slate-900 m-0 truncate">
                  {viewingEmployee.fullName}
                </h3>
                <p className="text-xs text-slate-500 font-mono m-0 flex items-center gap-1 mt-0.5">
                  <MailOutlined className="text-slate-400" /> {viewingEmployee.email}
                </p>
              </div>
            </div>

            {/* Details Specification Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-white border border-slate-200/80 rounded-[6px] space-y-1">
                <span className="text-slate-400 text-[11px] font-medium uppercase tracking-wider block mb-1">
                  System Authorization
                </span>
                <div>{getRoleBadge(viewingEmployee.role)}</div>
              </div>

              <div className="p-3 bg-white border border-slate-200/80 rounded-[6px] space-y-1">
                <span className="text-slate-400 text-[11px] font-medium uppercase tracking-wider block mb-1">
                  Assigned Facility
                </span>
                <p className="font-semibold text-slate-800 m-0 text-xs">
                  {viewingEmployee.facility?.name || `Facility #${viewingEmployee.facilityId}`}
                </p>
              </div>

              <div className="p-3 bg-white border border-slate-200/80 rounded-[6px] space-y-1 sm:col-span-2">
                <span className="text-slate-400 text-[11px] font-medium uppercase tracking-wider block">
                  Account Active Status
                </span>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-slate-700 font-medium text-xs">
                    Status: {viewingEmployee.status === 'ACTIVE' ? 'Active' : 'Deactivated'}
                  </span>
                  <Switch
                    checked={viewingEmployee.status === 'ACTIVE'}
                    disabled={viewingEmployee.id === currentUser?.id}
                    onChange={() => handleStatusToggle(viewingEmployee)}
                  />
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Add / Edit Staff Modal */}
      <Modal
        title={
          <div className="font-semibold text-base text-slate-900">
            {editingEmployee ? 'Edit Staff Member' : 'Add New Staff Member'}
          </div>
        }
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        okText="Save"
        cancelText="Cancel"
        confirmLoading={saving}
        centered
        width={540}
        okButtonProps={{ className: 'bg-[#1e4287] font-medium rounded-[6px] text-xs !shadow-none' }}
        cancelButtonProps={{ className: 'rounded-[6px] text-xs !shadow-none' }}
        forceRender
      >
        <Form form={form} layout="vertical" onFinish={handleSave} className="mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <Form.Item
              label="Full Name"
              name="fullName"
              rules={[{ required: true, message: 'Please enter full name' }]}
            >
              <Input placeholder="e.g. John Doe" className="rounded-[6px] text-xs" />
            </Form.Item>

            <Form.Item
              label="Email Address"
              name="email"
              rules={[
                { required: true, message: 'Please enter email address' },
                { type: 'email', message: 'Please enter a valid email' },
              ]}
            >
              <Input placeholder="name@pharmatrace.vn" className="rounded-[6px] text-xs" />
            </Form.Item>
          </div>

          <Form.Item
            label={editingEmployee ? 'Password (Leave blank to keep unchanged)' : 'Temporary Password'}
            name="password"
            rules={
              editingEmployee
                ? [{ min: 6, message: 'Password must be at least 6 characters' }]
                : [
                  { required: true, message: 'Please enter temporary password' },
                  { min: 6, message: 'Password must be at least 6 characters' },
                ]
            }
          >
            <Input.Password placeholder="At least 6 characters" className="rounded-[6px] text-xs" />
          </Form.Item>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <Form.Item
              label="System Role"
              name="role"
              rules={[{ required: true, message: 'Please select system role' }]}
            >
              <Select options={ROLES_OPTIONS.filter((r) => !isStoreManager || ['PHARMACIST', 'WAREHOUSE_STAFF'].includes(r.value)).map((r) => ({ value: r.value, label: r.label }))} className="text-xs" />
            </Form.Item>

            <Form.Item
              label="Assigned Facility"
              name="facilityId"
              rules={[{ required: true, message: 'Please select assigned facility' }]}
            >
              <Select
                options={facilityOptions}
                disabled={isStoreManager}
                placeholder="Search or select facility by name..."
                showSearch
                filterOption={(input, option) =>
                  (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                }
                className="text-xs"
              />
            </Form.Item>
          </div>

          {editingEmployee ? (
            <Form.Item label="Active Account Status" name="status" valuePropName="checked">
              <Switch disabled={editingEmployee.id === currentUser?.id} />
            </Form.Item>
          ) : (
            <p className="text-xs text-slate-500">New staff accounts are created active.</p>
          )}
        </Form>
      </Modal>
    </>
  );
}
