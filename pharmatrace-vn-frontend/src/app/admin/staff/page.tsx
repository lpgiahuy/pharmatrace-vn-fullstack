'use client';

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
import { AdminLayout } from '@/components/layout/AdminLayout';
import {
  employeeService,
  Employee,
  EmployeeQuery,
} from '@/services/employee.service';
import { facilityService } from '@/services/facility.service';

const ROLES_OPTIONS = [
  { value: 'SUPER_ADMIN', label: 'Super Admin', color: 'red' },
  { value: 'STORE_MANAGER', label: 'Store Manager', color: 'orange' },
  { value: 'WAREHOUSE_MANAGER', label: 'Warehouse Manager', color: 'purple' },
  { value: 'SALES_STAFF', label: 'Sales Staff', color: 'blue' },
  { value: 'PHARMACIST', label: 'Pharmacist', color: 'cyan' },
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
  SALES_STAFF: { label: 'Sales Staff', color: 'blue' },
  SALESSTAFF: { label: 'Sales Staff', color: 'blue' },
  PHARMACIST: { label: 'Pharmacist', color: 'cyan' },
};

const getRoleBadge = (roleStr: string) => {
  const normalized = (roleStr || '').toUpperCase().replace(/[\s_-]/g, '');
  const matched = ROLE_MAP[normalized] || ROLE_MAP[roleStr?.toUpperCase()];
  if (matched) {
    return <Tag color={matched.color} className="rounded-full px-3">{matched.label}</Tag>;
  }
  return <Tag color="default" className="rounded-full px-3">{roleStr || 'Staff'}</Tag>;
};

const UserAvatar: React.FC<{ name?: string; email?: string; size?: 'normal' | 'large' }> = ({
  name,
  email,
  size = 'normal',
}) => {
  const initials = (name || email || 'U')
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const dimensionClass = size === 'large' ? 'w-14 h-14 text-base' : 'w-9 h-9 text-xs';
  return (
    <div
      className={`${dimensionClass} rounded-full bg-[#1e4287] text-white font-bold flex items-center justify-center shadow-sm shrink-0`}
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

  const [mounted, setMounted] = useState(false);
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
  viewingEmployeeRef.current = viewingEmployee;

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

  const fetchEmployees = useCallback(
    async (page = 1, limit = 10) => {
      setLoading(true);
      try {
        const query: EmployeeQuery = {
          page,
          limit,
          search: searchVal ? searchVal.trim() : undefined,
          role: roleFilter,
          facilityId: facilityFilter,
          status: statusFilter,
        };
        const res = await employeeService.getEmployees(query);
        if (res && res.data) {
          setEmployees(res.data);
          setPagination({
            current: res.pagination.page,
            pageSize: res.pagination.limit,
            total: res.pagination.total,
          });

          const collectedFacs: Array<{ value: number; label: string }> = [];
          const seenIds = new Set<number>();
          res.data.forEach((e) => {
            if (e.facilityId && !seenIds.has(e.facilityId)) {
              seenIds.add(e.facilityId);
              const facName = e.facility?.name || `Facility #${e.facilityId}`;
              collectedFacs.push({
                value: e.facilityId,
                label: facName,
              });
            }
          });
          if (collectedFacs.length > 0) {
            setFacilityOptions(collectedFacs);
          }

          // Update viewing employee if open
          if (viewingEmployeeRef.current) {
            const updatedView = res.data.find((e) => e.id === viewingEmployeeRef.current?.id);
            if (updatedView) setViewingEmployee(updatedView);
          }
        }
      } catch (err: any) {
        messageApi.error(err?.message || 'Failed to fetch employees');
      } finally {
        setLoading(false);
      }
    },
    [searchVal, roleFilter, facilityFilter, statusFilter, messageApi]
  );

  useEffect(() => {
    if (mounted && isAuthenticated) {
      fetchEmployees(1, 10);
    }
  }, [mounted, isAuthenticated, fetchEmployees]);

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
    fetchEmployees(1, pagination.pageSize);
  };

  const openModal = (emp: Employee | null = null) => {
    setEditingEmployee(emp);
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
        role: 'SALES_STAFF',
        facilityId: 1,
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
        status: values.status ? 'ACTIVE' : 'INACTIVE',
      };

      if (editingEmployee) {
        await employeeService.updateEmployee(editingEmployee.id, payload);
        messageApi.success('Employee updated successfully');
      } else {
        await employeeService.createEmployee(payload as any);
        messageApi.success('Employee created successfully');
      }

      setModalOpen(false);
      fetchEmployees(pagination.current, pagination.pageSize);
    } catch (err: any) {
      messageApi.error(err?.message || 'Failed to save employee');
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
      width: 170,
      render: (_: any, row: Employee) => (
        <div className="flex items-center gap-3">
          <UserAvatar name={row.fullName} email={row.email} />
          <div className="min-w-0">
            <p className="font-semibold text-sm text-slate-800 m-0 truncate">{row.fullName}</p>
            <p className="text-xs text-slate-500 font-mono m-0 truncate">{row.email}</p>
          </div>
        </div>
      ),
    },
    {
      title: 'System Role',
      dataIndex: 'role',
      key: 'role',
      width: 150,
      render: (role: string) => getRoleBadge(role),
    },
    {
      title: 'Assigned Facility',
      key: 'facility',
      width: 180,
      render: (_: any, row: Employee) => {
        const facName = row.facility?.name || `Facility #${row.facilityId}`;
        return <Tag color="blue" className="max-w-[160px] truncate">{facName}</Tag>;
      },
    },
    {
      title: 'Status',
      key: 'status',
      width: 120,
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
            <span
              className={`text-xs font-semibold ${isActive ? 'text-emerald-600' : 'text-rose-500'
                }`}
            >
              {isActive ? 'Active' : 'Disabled'}
            </span>
          </div>
        );
      },
    },
    {
      title: 'Details',
      key: 'details',
      width: 90,
      align: 'center' as const,
      render: (_: any, row: Employee) => (
        <Tooltip title="View Profile & Actions">
          <AButton
            size="small"
            icon={<EyeOutlined />}
            onClick={() => openDetailModal(row)}
            className="!shadow-none"
          />
        </Tooltip>
      ),
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 sm:p-6 !rounded-md shadow-sm border border-slate-100">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 m-0 flex items-center gap-2">
              <TeamOutlined className="text-[#1e4287]" /> Staff & Access Permissions
            </h2>
            <p className="text-slate-500 text-xs sm:text-sm m-0 mt-1">
              Manage user directory, system authorization, and facility assignments
            </p>
          </div>
          <AButton
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => openModal()}
            size="large"
            className="bg-[#1e4287] hover:bg-[#153166] font-semibold w-full sm:w-auto !shadow-none"
          >
            Add Staff Member
          </AButton>
        </div>

        {/* Filter Controls Bar */}
        <Card className="shadow-sm !rounded-md border-slate-100" styles={{ body: { padding: '16px' } }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
            <Input
              placeholder="Search by name or email"
              prefix={<SearchOutlined className="text-slate-400" />}
              value={searchVal}
              onChange={(e) => setSearchVal(e.target.value)}
              onPressEnter={handleSearchClick}
              allowClear
            />

            <Select
              placeholder="Filter by System Role"
              value={roleFilter}
              onChange={(val) => setRoleFilter(val)}
              allowClear
              options={ROLES_OPTIONS.map((r) => ({ value: r.value, label: r.label }))}
            />

            <Select
              placeholder="Filter by Facility"
              value={facilityFilter}
              onChange={(val) => setFacilityFilter(val)}
              allowClear
              options={facilityOptions}
            />

            <Select
              placeholder="Filter by Status"
              value={statusFilter}
              onChange={(val) => setStatusFilter(val)}
              allowClear
              options={STATUS_OPTIONS}
            />

            <div className="flex gap-2 sm:col-span-2 md:col-span-3 lg:col-span-1">
              <AButton
                type="primary"
                icon={<SearchOutlined />}
                onClick={handleSearchClick}
                className="bg-[#1e4287] flex-1 !shadow-none"
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
            <Card className="!rounded-md text-center py-6 text-slate-500">Loading staff directory...</Card>
          ) : employees.length === 0 ? (
            <Card className="!rounded-md text-center py-6 text-slate-500">No staff members found.</Card>
          ) : (
            employees.map((row) => {
              const isActive = row.status === 'ACTIVE';
              const isSelf = row.id === currentUser?.id;
              return (
                <Card
                  key={row.id}
                  className="shadow-sm !rounded-md border-slate-100 hover:border-blue-200 transition-all cursor-pointer"
                  styles={{ body: { padding: '14px' } }}
                // onClick={() => openDetailModal(row)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <UserAvatar name={row.fullName} email={row.email} />
                      <div className="min-w-0">
                        <p className="font-bold text-sm text-slate-900 m-0 truncate">{row.fullName}</p>
                        <div className="mt-1 flex items-center gap-2">
                          {getRoleBadge(row.role)}
                        </div>
                      </div>
                    </div>

                    <AButton
                      type="default"
                      size="small"
                      icon={<EyeOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        openDetailModal(row);
                      }}
                      className="bg-blue-50 text-[#1e4287] border-blue-200 font-medium shrink-0 !shadow-none"
                    >
                      Details
                    </AButton>
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
                      <span className={`font-semibold ${isActive ? 'text-emerald-600' : 'text-rose-500'}`}>
                        {isActive ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                  </div>
                </Card>
              );
            })
          )}

          {/* Mobile Pagination */}
          <div className="flex justify-center pt-2">
            <Pagination
              current={pagination.current}
              pageSize={pagination.pageSize}
              total={pagination.total}
              showSizeChanger={false}
              onChange={(page, pageSize) => fetchEmployees(page, pageSize)}
              itemRender={(_page, type, originalElement) => {
                if (type === 'prev') {
                  return <span className="px-1 text-slate-600 text-sm font-medium">&lt; Previous</span>;
                }
                if (type === 'next') {
                  return <span className="px-1 text-[#1e4287] text-sm font-medium">Next &gt;</span>;
                }
                return originalElement;
              }}
            />
          </div>
        </div>

        {/* Desktop & Tablet View: Full Table (>= 640px) */}
        <Card className="hidden sm:block shadow-sm !rounded-md border-slate-100 overflow-hidden" styles={{ body: { padding: 0 } }}>
          <Table
            dataSource={employees}
            columns={columns}
            rowKey="id"
            loading={loading}
            pagination={{
              current: pagination.current,
              pageSize: pagination.pageSize,
              total: pagination.total,
              showSizeChanger: false,
              onChange: (page, pageSize) => fetchEmployees(page, pageSize),
              itemRender: (_page, type, originalElement) => {
                if (type === 'prev') {
                  return <span className="px-1 text-slate-600 text-sm font-medium">&lt; Previous</span>;
                }
                if (type === 'next') {
                  return <span className="px-1 text-[#1e4287] text-sm font-medium">Next &gt;</span>;
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
            <div className="font-bold text-lg text-slate-900 flex items-center gap-2">
              <UserOutlined className="text-[#1e4287]" /> Staff Member Profile
            </div>
          }
          open={detailModalOpen}
          onCancel={() => setDetailModalOpen(false)}
          footer={
            <div className="flex items-center justify-between gap-2 pt-2">
              {viewingEmployee.id === currentUser?.id ? (
                <Tooltip title="Cannot delete your own account">
                  <span>
                    <AButton size="small" danger icon={<DeleteOutlined />} disabled className="shadow-none">
                      Delete Member
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
                  <AButton size="small" danger icon={<DeleteOutlined />} className="shadow-none">
                    Delete Member
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
                className="bg-[#1e4287] hover:bg-[#153166] font-semibold !shadow-none border-0"
              >
                Edit Profile
              </AButton>
            </div>
          }
          centered
          width={520}
        >
          <div className="py-4 space-y-6">
            {/* Header Profile Summary */}
            <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
              <UserAvatar name={viewingEmployee.fullName} email={viewingEmployee.email} size="large" />
              <div className="min-w-0">
                <h3 className="font-bold text-base text-slate-900 m-0 truncate">
                  {viewingEmployee.fullName}
                </h3>
                <p className="text-xs text-slate-500 font-mono m-0 flex items-center gap-1 mt-0.5">
                  <MailOutlined className="text-slate-400" /> {viewingEmployee.email}
                </p>
              </div>
            </div>

            {/* Details Specification Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div className="p-3 bg-white border border-slate-100 rounded-xl space-y-1">
                <span className="text-slate-400 text-xs font-medium uppercase tracking-wider flex items-center gap-1 mb-1">
                  <SafetyCertificateOutlined className="text-blue-500" /> System Authorization
                </span>
                <div>{getRoleBadge(viewingEmployee.role)}</div>
              </div>

              <div className="p-3 bg-white border border-slate-100 rounded-xl space-y-1">
                <span className="text-slate-400 text-xs font-medium uppercase tracking-wider flex items-center gap-1">
                  <HomeOutlined className="text-purple-500" /> Assigned Facility
                </span>
                <p className="font-semibold text-slate-800 m-0">
                  {viewingEmployee.facility?.name || `Facility #${viewingEmployee.facilityId}`}
                </p>
              </div>

              <div className="p-3 bg-white border border-slate-100 rounded-xl space-y-1 sm:col-span-2">
                <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">
                  Account Active Status
                </span>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-slate-600 font-medium text-xs">
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
          <div className="font-bold text-base sm:text-lg text-slate-800">
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
        width={560}
        okButtonProps={{ className: 'bg-[#1e4287] font-semibold !shadow-none' }}
        cancelButtonProps={{ className: '!shadow-none' }}
      >
        <Form form={form} layout="vertical" onFinish={handleSave} className="mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <Form.Item
              label="Full Name"
              name="fullName"
              rules={[{ required: true, message: 'Please enter full name' }]}
            >
              <Input placeholder="e.g. John Doe" />
            </Form.Item>

            <Form.Item
              label="Email Address"
              name="email"
              rules={[
                { required: true, message: 'Please enter email address' },
                { type: 'email', message: 'Please enter a valid email' },
              ]}
            >
              <Input placeholder="name@pharmatrace.vn" />
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
            <Input.Password placeholder="At least 6 characters" />
          </Form.Item>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <Form.Item
              label="System Role"
              name="role"
              rules={[{ required: true, message: 'Please select system role' }]}
            >
              <Select options={ROLES_OPTIONS.map((r) => ({ value: r.value, label: r.label }))} />
            </Form.Item>

            <Form.Item
              label="Assigned Facility"
              name="facilityId"
              rules={[{ required: true, message: 'Please select assigned facility' }]}
            >
              <Select options={facilityOptions} placeholder="Select assigned facility" />
            </Form.Item>
          </div>

          <Form.Item label="Active Account Status" name="status" valuePropName="checked">
            <Switch disabled={editingEmployee?.id === currentUser?.id} />
          </Form.Item>
        </Form>
      </Modal>
    </AdminLayout>
  );
}
