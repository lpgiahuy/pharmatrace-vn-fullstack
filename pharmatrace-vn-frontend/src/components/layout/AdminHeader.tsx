'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Layout, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { LogOut, User } from 'lucide-react';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MenuOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '@/store/useAuthStore';
import { formatRole, getAvatarColor } from '@/utils';

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
      key: 'profile',
      icon: <User className="w-4 h-4 text-slate-600 shrink-0 stroke-[1.8]" />,
      label: 'My Profile',
      onClick: () => router.push('/admin/profile'),
    },
    {
      type: 'divider',
    },
    {
      key: 'logout',
      icon: <LogOut className="w-4 h-4 text-red-600 shrink-0 stroke-[1.8]" />,
      label: <span className="text-red-600 font-semibold">Logout</span>,
      className: '!text-red-600 hover:!bg-red-50',
      onClick: handleLogout,
    },
  ];

  const avatarBg = getAvatarColor(userName || userRole);

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
        className="p-1.5 rounded-[6px] hover:bg-slate-100 transition-colors mr-3 text-slate-600 cursor-pointer border-none bg-transparent flex items-center justify-center"
      >
        {isMobile ? (
          <MenuOutlined style={{ fontSize: 18 }} />
        ) : collapsed ? (
          <MenuUnfoldOutlined style={{ fontSize: 18 }} />
        ) : (
          <MenuFoldOutlined style={{ fontSize: 18 }} />
        )}
      </button>

      <span className="text-sm font-semibold text-slate-600">
        Admin Management Portal
      </span>

      <div className="ml-auto flex items-center gap-3">
        <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="bottomRight">
          <button className="flex items-center gap-2.5 py-1 px-2 rounded-[6px] hover:bg-slate-100 transition-colors border-none bg-transparent cursor-pointer">
            <div
              style={{ backgroundColor: avatarBg }}
              className="w-8 h-8 rounded-full text-white font-bold flex items-center justify-center text-xs shadow-xs"
            >
              {(userName || 'A').charAt(0).toUpperCase()}
            </div>
            <div className="text-left hidden sm:flex flex-col justify-center">
              <p className="text-sm font-semibold text-slate-800 leading-none m-0">{userName}</p>
              <p className="text-xs text-slate-500 font-medium mt-1 leading-none m-0">
                {formatRole(userRole)}
              </p>
            </div>
          </button>
        </Dropdown>
      </div>
    </Header>
  );
};
