'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Tag, Button, Descriptions } from 'antd';
import {
  SafetyCertificateOutlined,
  TeamOutlined,
  UserOutlined,
  ArrowRightOutlined,
  AppstoreOutlined,
  MedicineBoxOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '@/store/useAuthStore';
import { apiClient } from '@/services/api.client';
import { formatRole } from '@/utils';

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
    <div className="space-y-5 animate-fade-in font-sans w-full">
      {/* Header */}
      <div className="pb-1">
        <h1 className="text-xl font-bold text-slate-900 m-0 tracking-tight">
          Admin Portal Dashboard
        </h1>
        <p className="text-slate-500 text-xs m-0 mt-0.5">
          Overview and administrative control for PharmaTrace VN platform
        </p>
      </div>

      {/* Quick Navigation Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div
          onClick={() => router.push('/admin/categories')}
          className="bg-white p-4 rounded-[6px] border border-slate-200/80 shadow-xs hover:border-slate-300 transition-all cursor-pointer flex items-center justify-between group"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-[6px] bg-slate-100 text-slate-600 flex items-center justify-center text-sm group-hover:bg-slate-200 transition-colors">
              <AppstoreOutlined />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 m-0">Categories</h3>
              <p className="text-[11px] text-slate-400 m-0 mt-0.5">Medical taxonomy hierarchy</p>
            </div>
          </div>
          <ArrowRightOutlined className="text-slate-300 text-xs group-hover:text-slate-600 transition-colors" />
        </div>

        <div
          onClick={() => router.push('/admin/products')}
          className="bg-white p-4 rounded-[6px] border border-slate-200/80 shadow-xs hover:border-slate-300 transition-all cursor-pointer flex items-center justify-between group"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-[6px] bg-slate-100 text-slate-600 flex items-center justify-center text-sm group-hover:bg-slate-200 transition-colors">
              <MedicineBoxOutlined />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 m-0">Medicines Catalog</h3>
              <p className="text-[11px] text-slate-400 m-0 mt-0.5">Products, batches & stock</p>
            </div>
          </div>
          <ArrowRightOutlined className="text-slate-300 text-xs group-hover:text-slate-600 transition-colors" />
        </div>

        {isSuperAdmin && (
          <div
            onClick={() => router.push('/admin/staff')}
            className="bg-white p-4 rounded-[6px] border border-slate-200/80 shadow-xs hover:border-slate-300 transition-all cursor-pointer flex items-center justify-between group"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-[6px] bg-slate-100 text-slate-600 flex items-center justify-center text-sm group-hover:bg-slate-200 transition-colors">
                <TeamOutlined />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900 m-0">Staff & RBAC</h3>
                <p className="text-[11px] text-slate-400 m-0 mt-0.5">Employees & permissions</p>
              </div>
            </div>
            <ArrowRightOutlined className="text-slate-300 text-xs group-hover:text-slate-600 transition-colors" />
          </div>
        )}

        <div
          onClick={() => router.push('/admin/customers')}
          className="bg-white p-4 rounded-[6px] border border-slate-200/80 shadow-xs hover:border-slate-300 transition-all cursor-pointer flex items-center justify-between group"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-[6px] bg-slate-100 text-slate-600 flex items-center justify-center text-sm group-hover:bg-slate-200 transition-colors">
              <UserOutlined />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 m-0">Customers</h3>
              <p className="text-[11px] text-slate-400 m-0 mt-0.5">Accounts & order history</p>
            </div>
          </div>
          <ArrowRightOutlined className="text-slate-300 text-xs group-hover:text-slate-600 transition-colors" />
        </div>
      </div>

      {/* Main Info Panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white p-5 rounded-[6px] border border-slate-200/80 shadow-xs space-y-3">
          <h2 className="text-sm font-semibold text-slate-900 m-0 pb-2 border-b border-slate-100">
            Admin Profile Information
          </h2>
          <Descriptions bordered column={1} size="small" className="text-xs">
            <Descriptions.Item label="Full Name">
              <span className="font-medium text-slate-800">{user.fullName || user.full_name || 'Admin User'}</span>
            </Descriptions.Item>
            <Descriptions.Item label="Email">
              <span className="text-slate-600">{user.email || 'N/A'}</span>
            </Descriptions.Item>
            <Descriptions.Item label="Role">
              <span className="text-xs font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-[6px]">
                {formatRole(user.role)}
              </span>
            </Descriptions.Item>
            <Descriptions.Item label="Status">
              <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Active
              </span>
            </Descriptions.Item>
          </Descriptions>
        </div>

        <div className="bg-white p-5 rounded-[6px] border border-slate-200/80 shadow-xs space-y-3">
          <h2 className="text-sm font-semibold text-slate-900 m-0 pb-2 border-b border-slate-100">
            RBAC Security Check
          </h2>
          <p className="text-xs text-slate-500 m-0">
            Test backend endpoint (<code className="text-slate-700 bg-slate-100 px-1 py-0.5 rounded-[6px]">/v1/pharmatrace/auth/admin-test</code>) enforcing role access.
          </p>
          <button
            type="button"
            onClick={verifyAdminAccess}
            disabled={loadingTest}
            className="w-full inline-flex items-center justify-center gap-2 py-2 px-4 rounded-[6px] bg-[#1e4287] hover:bg-[#163266] text-white text-xs font-medium transition-colors cursor-pointer border-none shadow-xs"
          >
            <SafetyCertificateOutlined />
            {loadingTest ? 'Verifying...' : 'Verify SuperAdmin Endpoint'}
          </button>

          {adminTestData && (
            <div className="p-3 bg-slate-50 rounded-[6px] text-xs font-mono text-slate-600 break-all border border-slate-200/60 max-h-40 overflow-y-auto">
              {JSON.stringify(adminTestData, null, 2)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
