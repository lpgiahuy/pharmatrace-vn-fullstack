'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Layout, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MenuOutlined,
  LogoutOutlined,
  UserOutlined,
  DashboardOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '@/store/useAuthStore';

const { Header } = Layout;

interface AdminHeaderProps {
  collapsed: boolean;
  onToggle: () => void;
  isMobile: boolean;
}

export const AdminHeader: React.FC<AdminHeaderProps> = ({
  collapsed,
  onToggle,
  isMobile,
}) => {
  const router = useRouter();
  const getUser = useAuthStore((state) => state.getUser);
  const logout = useAuthStore((state) => state.logout);

  const user = getUser();
  const userName = user?.fullName || user?.full_name || user?.name || 'Administrator';
  const userRole = user?.role || 'SUPER_ADMIN';

  const handleLogout = async () => {
    await logout();
    router.push('/admin/login');
  };

  const menuItems: MenuProps['items'] = [
    {
      key: 'dashboard',
      icon: <DashboardOutlined />,
      label: 'Admin Dashboard',
      onClick: () => router.push('/admin'),
    },
    {
      type: 'divider',
    },
    {
      key: 'logout',
      icon: <LogoutOutlined className="text-rose-500" />,
      label: <span className="text-rose-500 font-semibold">Sign Out</span>,
      onClick: handleLogout,
    },
  ];

  return (
    <Header
      style={{
        background: '#fff',
        padding: isMobile ? '0 16px' : '0 24px',
        borderBottom: '1px solid #f1f5f9',
        display: 'flex',
        alignItems: 'center',
        height: 64,
        lineHeight: 'normal',
        position: 'sticky',
        top: 0,
        zIndex: 90,
      }}
    >
      <button
        onClick={onToggle}
        className="p-2 rounded-sm hover:bg-slate-100 transition-colors mr-3 text-slate-600 cursor-pointer border-none bg-transparent flex items-center justify-center"
      >
        {isMobile ? (
          <MenuOutlined style={{ fontSize: 18 }} />
        ) : collapsed ? (
          <MenuUnfoldOutlined style={{ fontSize: 18 }} />
        ) : (
          <MenuFoldOutlined style={{ fontSize: 18 }} />
        )}
      </button>

      <span className="text-sm font-semibold text-slate-500">
        Admin Management Portal
      </span>

      <div className="ml-auto flex items-center gap-3">
        <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="bottomRight">
          <button className="flex items-center gap-2.5 py-1.5 px-2.5 rounded-sm hover:bg-slate-100 transition-colors border-none bg-transparent cursor-pointer">
            <div className="w-8 h-8 rounded-full bg-[#1e4287] text-white font-bold flex items-center justify-center text-xs">
              {(userName || 'A').charAt(0).toUpperCase()}
            </div>
            <div className="text-left hidden sm:flex flex-col justify-center">
              <p className="text-xs font-semibold text-slate-800 leading-none m-0">{userName}</p>
              <p className="text-[10px] text-slate-400 font-mono mt-0.5 leading-none m-0 uppercase font-semibold">
                {userRole}
              </p>
            </div>
          </button>
        </Dropdown>
      </div>
    </Header>
  );
};
