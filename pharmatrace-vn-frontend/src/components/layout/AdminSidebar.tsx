'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Layout, Menu, Drawer } from 'antd';
import {
  DashboardOutlined,
  TeamOutlined,
  UserOutlined,
  MedicineBoxOutlined,
} from '@ant-design/icons';

const { Sider } = Layout;

interface AdminSidebarProps {
  collapsed: boolean;
  onCollapse: () => void;
  isMobile: boolean;
}

export const AdminSidebar: React.FC<AdminSidebarProps> = ({
  collapsed,
  onCollapse,
  isMobile,
}) => {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const menuItems = [
    {
      key: '/admin',
      icon: <DashboardOutlined style={{ fontSize: 16 }} />,
      label: <Link href="/admin">Dashboard</Link>,
    },
    {
      key: '/admin/staff',
      icon: <TeamOutlined style={{ fontSize: 16 }} />,
      label: <Link href="/admin/staff">Staff & RBAC</Link>,
    },
    {
      key: '/admin/customers',
      icon: <UserOutlined style={{ fontSize: 16 }} />,
      label: <Link href="/admin/customers">Customer Management</Link>,
    },
  ];

  // Determine selected key based on current pathname
  const selectedKey =
    menuItems.find(
      (item) =>
        pathname === item.key ||
        (item.key !== '/admin' && pathname.startsWith(item.key))
    )?.key || '/admin';

  const SidebarContent = ({ isCollapsed }: { isCollapsed: boolean }) => (
    <div className="flex h-full flex-col bg-white select-none border-r border-slate-100">
      {/* Brand Header */}
      <div
        className={`flex shrink-0 items-center gap-2.5 px-4 h-16 border-b border-slate-100 ${isCollapsed ? 'justify-center' : ''
          }`}
      >
        <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-[#1e4287] to-[#3b82f6] flex items-center justify-center text-white shadow-xs shrink-0">
          <MedicineBoxOutlined className="text-xl" />
        </div>
        {!isCollapsed && (
          <span className="font-bold text-[#1e4287] text-base tracking-tight whitespace-nowrap">
            PharmaTrace VN
          </span>
        )}
      </div>

      {/* Category Section Caption */}
      {!isCollapsed && (
        <div className="shrink-0 px-5 pt-4 pb-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            ADMIN PORTAL
          </span>
        </div>
      )}

      {/* Vertical Navigation Menu */}
      <div className="flex-1 overflow-y-auto py-2">
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          className="!border-r-0 !bg-transparent px-2"
        />
      </div>
    </div>
  );

  // If not mounted yet (SSR), render standard Sider to avoid Drawer SSR hydration errors
  if (!mounted) {
    return (
      <Sider
        collapsible
        collapsed={collapsed}
        trigger={null}
        width={240}
        collapsedWidth={80}
        style={{
          position: 'fixed',
          height: '100vh',
          left: 0,
          top: 0,
          zIndex: 100,
        }}
        theme="light"
      >
        <SidebarContent isCollapsed={collapsed} />
      </Sider>
    );
  }

  if (isMobile) {
    return (
      <Drawer
        placement="left"
        onClose={onCollapse}
        open={!collapsed}
        styles={{ wrapper: { width: 240 }, body: { padding: 0 } }}
        closable={false}
      >
        <SidebarContent isCollapsed={false} />
      </Drawer>
    );
  }

  return (
    <Sider
      collapsible
      collapsed={collapsed}
      trigger={null}
      width={240}
      collapsedWidth={80}
      style={{
        position: 'fixed',
        height: '100vh',
        left: 0,
        top: 0,
        zIndex: 100,
        boxShadow: '2px 0 8px rgba(0,0,0,0.04)',
      }}
      theme="light"
    >
      <SidebarContent isCollapsed={collapsed} />
    </Sider>
  );
};
