'use client';

import { useHydrated } from '@/hooks/useHydrated';
import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Tag, Button, Descriptions } from 'antd';
import { Warehouse, LogOut, PackageCheck, Truck, ArrowRight } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { formatRole } from '@/utils';

export default function WarehouseDashboardPage() {
  const router = useRouter();
  const getIsAuthenticated = useAuthStore((state) => state.getIsAuthenticated);
  const getUser = useAuthStore((state) => state.getUser);
  const logout = useAuthStore((state) => state.logout);

  const mounted = useHydrated();

  const isAuthenticated = mounted ? getIsAuthenticated() : false;
  const user = mounted ? getUser() : null;

  React.useEffect(() => {
    if (mounted && !isAuthenticated) {
      router.push('/warehouse/login');
    }
  }, [mounted, isAuthenticated, router]);

  const handleLogout = async () => {
    await logout();
    router.push('/warehouse/login');
  };

  if (!mounted || !isAuthenticated || !user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <header className="bg-[#1e4287] text-white py-4 px-6 shadow-md flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Warehouse className="w-6 h-6" />
          <h1 className="text-xl font-bold tracking-tight">PharmaTrace WMS - Warehouse Portal</h1>
        </div>
        <Button
          type="text"
          icon={<LogOut className="w-4 h-4 text-white" />}
          onClick={handleLogout}
          className="text-white hover:text-white/80"
        >
          Logout
        </Button>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {/* Quick Launch to Logistics Operations */}
        <Card className="shadow-sm rounded-xl border-blue-100 bg-gradient-to-r from-blue-50/70 to-indigo-50/40">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-lg bg-[#004996] text-white flex items-center justify-center shadow-xs shrink-0">
                <Truck className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900 m-0">Logistics Operations & Transfers</h2>
                <p className="text-sm text-slate-600 m-0 mt-0.5">
                  Manage shipments, dispatch & receive internal inventory transfers for your facility.
                </p>
              </div>
            </div>
            <Button
              type="primary"
              size="large"
              onClick={() => router.push('/admin/logistics')}
              className="!bg-[#004996] hover:!bg-[#003875] !font-medium flex items-center gap-2"
            >
              Open Logistics Center <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </Card>

        <Card title={<div className="flex items-center gap-2"><PackageCheck className="w-5 h-5 text-blue-600" /><span>Staff Profile & Unit Info</span></div>} className="shadow-sm rounded-xl">
          <Descriptions bordered column={1} size="middle">
            <Descriptions.Item label="Full Name">{user.fullName || user.full_name || 'Warehouse Staff'}</Descriptions.Item>
            <Descriptions.Item label="Email">{user.email}</Descriptions.Item>
            <Descriptions.Item label="Role">
              <Tag color="blue" className="font-semibold">{formatRole(user.role || 'WAREHOUSE_STAFF')}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Job Title">{user.jobTitle || user.job_title || 'Warehouse Staff'}</Descriptions.Item>
            <Descriptions.Item label="Assigned Facility">{user.facility?.name || 'PharmaTrace Distribution Hub'}</Descriptions.Item>
            <Descriptions.Item label="Status">
              <Tag color="green">ACTIVE</Tag>
            </Descriptions.Item>
          </Descriptions>
        </Card>
      </main>
    </div>
  );
}
