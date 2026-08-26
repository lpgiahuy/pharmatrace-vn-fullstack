'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Tag, Button, Descriptions } from 'antd';
import { DashboardOutlined, SafetyCertificateOutlined, LogoutOutlined } from '@ant-design/icons';
import { useAuthStore } from '@/store/useAuthStore';
import { apiClient } from '@/services/api.client';

export default function AdminDashboardPage() {
  const router = useRouter();
  const getIsAuthenticated = useAuthStore((state) => state.getIsAuthenticated);
  const getUser = useAuthStore((state) => state.getUser);
  const logout = useAuthStore((state) => state.logout);

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

  const handleLogout = async () => {
    await logout();
    router.push('/admin/login');
  };

  if (!mounted || !isAuthenticated || !user) {
    return null;
  }

  const isSuperAdmin = user.role === 'SUPER_ADMIN' || user.role === 'SuperAdmin';

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <header className="bg-[#1e4287] text-white py-4 px-6 shadow-md flex items-center justify-between">
        <div className="flex items-center gap-3">
          <DashboardOutlined className="text-xl" />
          <h1 className="text-xl font-bold tracking-tight">PharmaTrace Admin Portal</h1>
        </div>
        <Button
          type="text"
          icon={<LogoutOutlined className="text-white" />}
          onClick={handleLogout}
          className="text-white hover:text-white/80"
        >
          Sign Out
        </Button>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card title="Admin Profile Information" className="shadow-sm rounded-xl">
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

          <Card title="RBAC Security Check" className="shadow-sm rounded-xl">
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
      </main>
    </div>
  );
}
