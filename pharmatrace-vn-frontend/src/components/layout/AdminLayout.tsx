'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Layout, Grid } from 'antd';
import { AdminSidebar } from './AdminSidebar';
import { AdminHeader } from './AdminHeader';
import { useAuthStore } from '@/store/useAuthStore';

const { Content } = Layout;
const { useBreakpoint } = Grid;

interface AdminLayoutProps {
  children: React.ReactNode;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({ children }) => {
  const router = useRouter();
  const getIsAuthenticated = useAuthStore((state) => state.getIsAuthenticated);
  const getUser = useAuthStore((state) => state.getUser);

  const [mounted, setMounted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const screens = useBreakpoint();

  const isMobile = mounted ? screens.md === false : false;

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

  if (!mounted || !isAuthenticated || !user) {
    return null;
  }

  const toggleSidebar = () => {
    setCollapsed(!collapsed);
  };

  return (
    <Layout className="min-h-screen bg-slate-50 font-sans w-full">
      <AdminSidebar
        collapsed={collapsed}
        onCollapse={toggleSidebar}
        isMobile={isMobile}
      />

      <Layout
        className={`transition-all duration-300 ease-in-out bg-slate-50 min-h-screen flex flex-col flex-1 w-full ${isMobile ? 'ml-0' : collapsed ? 'ml-20' : 'ml-60'
          }`}
      >
        <AdminHeader
          collapsed={collapsed}
          onToggle={toggleSidebar}
          isMobile={isMobile}
        />

        <Content className="p-4 sm:p-6 lg:p-8 min-h-[calc(100vh-64px)] w-full flex-1">
          {children}
        </Content>
      </Layout>
    </Layout>
  );
};
