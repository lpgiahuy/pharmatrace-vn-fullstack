'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Tag, Button, Descriptions } from 'antd';
import {
  SafetyCertificateOutlined,
  TeamOutlined,
  UserOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '@/store/useAuthStore';
import { apiClient } from '@/services/api.client';
import { AdminLayout } from '@/components/layout/AdminLayout';

export default function AdminDashboardPage() {
  const router = useRouter();
  const getIsAuthenticated = useAuthStore((state) => state.getIsAuthenticated);
  const getUser = useAuthStore((state) => state.getUser);

  const [mounted, setMounted] = useState(false);
  const [adminTestData, setAdminTestData] = useState<any>(null);
  const [loadingTest, setLoadingTest] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isAuthenticated = mounted ? getIsAuthenticated() : false;
  const user = mounted ? getUser() : null;

  useEffect(() => {
    if (mounted && !isAuthenticated) {
      router.push('/admin/login');
    }
  }, [mounted, isAuthenticated, router]);

  const verifyAdminAccess = async () => {
    try {
      setLoadingTest(true);
      const res = await apiClient.get('/auth/admin-test');
      setAdminTestData(res);
    } catch (err: any) {
      setAdminTestData({ error: err?.message || 'Access Denied: SuperAdmin role required.' });
    } finally {
      setLoadingTest(false);
    }
  };

  if (!mounted || !isAuthenticated || !user) {
    return null;
  }

  const isSuperAdmin = user.role === 'SUPER_ADMIN' || user.role === 'SuperAdmin';

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-slate-900 m-0">Admin Portal Dashboard</h2>
          <p className="text-slate-500 text-xs sm:text-sm m-0 mt-0.5">
            Overview and administrative control for PharmaTrace VN platform
          </p>
        </div>

        {/* Quick Access Portal Modules */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card
            hoverable
            onClick={() => router.push('/admin/staff')}
            className="shadow-xs rounded-xl border-slate-100 cursor-pointer"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-50 text-[#1e4287] flex items-center justify-center text-xl">
                  <TeamOutlined />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-800 m-0">Staff & Role Permissions</h3>
                  <p className="text-xs text-slate-500 m-0 mt-0.5">Manage employees, assigned facilities, and access roles</p>
                </div>
              </div>
              <ArrowRightOutlined className="text-slate-400 mt-2" />
            </div>
          </Card>

          <Card
            hoverable
            onClick={() => router.push('/admin/customers')}
            className="shadow-xs rounded-xl border-slate-100 cursor-pointer"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center text-xl">
                  <UserOutlined />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-800 m-0">Customer Management</h3>
                  <p className="text-xs text-slate-500 m-0 mt-0.5">Customer accounts, membership tiers, points, and order history</p>
                </div>
              </div>
              <ArrowRightOutlined className="text-slate-400 mt-2" />
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card title="Admin Profile Information" className="shadow-xs rounded-xl border-slate-100">
            <Descriptions bordered column={1} size="middle">
              <Descriptions.Item label="Full Name">{user.fullName || user.full_name || 'Admin User'}</Descriptions.Item>
              <Descriptions.Item label="Email">{user.email || 'N/A'}</Descriptions.Item>
              <Descriptions.Item label="Assigned Role">
                <Tag color={isSuperAdmin ? 'gold' : 'blue'} className="text-sm px-2 py-0.5 font-semibold">
                  {user.role}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Account Status">
                <Tag color="green">ACTIVE</Tag>
              </Descriptions.Item>
            </Descriptions>
          </Card>

          <Card title="RBAC Security Check" className="shadow-xs rounded-xl border-slate-100">
            <p className="text-sm text-slate-600 mb-4">
              Test protected backend endpoint (<code>/v1/pharmatrace/auth/admin-test</code>) enforcing <code>@Roles(&apos;SUPER_ADMIN&apos;)</code>.
            </p>
            <Button
              type="primary"
              icon={<SafetyCertificateOutlined />}
              onClick={verifyAdminAccess}
              loading={loadingTest}
              block
              className="mb-4 bg-[#1e4287]"
            >
              Verify SuperAdmin Endpoint
            </Button>

            {adminTestData && (
              <div className="p-3 bg-slate-100 rounded-lg text-xs font-mono break-all">
                {JSON.stringify(adminTestData, null, 2)}
              </div>
            )}
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
