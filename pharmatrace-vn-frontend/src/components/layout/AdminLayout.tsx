'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Layout } from 'antd';
import { AdminSidebar } from './AdminSidebar';
import { AdminHeader } from './AdminHeader';
import { useAuthStore } from '@/store/useAuthStore';

const { Content } = Layout;

interface AdminLayoutProps {
  children: React.ReactNode;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({ children }) => {
  const router = useRouter();
  const getIsAuthenticated = useAuthStore((state) => state.getIsAuthenticated);
  const getUser = useAuthStore((state) => state.getUser);

  const [mounted, setMounted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setMounted(true);

    const handleResize = () => {
      const mobile = window.innerWidth < 1024;
      setIsMobile(mobile);
      if (mobile) {
        setCollapsed(true);
      } else {
        setCollapsed(false);
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
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
    setCollapsed((prev) => !prev);
  };

  const sidebarWidth = isMobile ? 0 : collapsed ? 80 : 240;

  return (
    <Layout className="min-h-screen bg-slate-50 font-sans" hasSider>
      <AdminSidebar
        collapsed={collapsed}
        onCollapse={toggleSidebar}
        isMobile={isMobile}
        role={user.role}
      />

      <Layout
        style={{
          marginLeft: sidebarWidth,
          transition: 'margin-left 0.2s cubic-bezier(0.2, 0, 0, 1)',
          minHeight: '100vh',
        }}
        className="bg-slate-50 flex flex-col flex-1 min-w-0"
      >
        <AdminHeader
          collapsed={collapsed}
          onToggle={toggleSidebar}
          isMobile={isMobile}
        />

        <Content className="p-4 sm:p-6 lg:p-6 min-h-[calc(100vh-64px)] flex-1 min-w-0">
          {children}
        </Content>
      </Layout>
    </Layout>
  );
};

