'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Tag, Dropdown, MenuProps } from 'antd';
import { UserOutlined, LogoutOutlined, QrcodeOutlined, DashboardOutlined } from '@ant-design/icons';
import { useAuth } from '@/store/useAuthStore';

export const Navbar: React.FC = () => {
  const router = useRouter();
  const { user, isAuthenticated, logout, fetchProfile } = useAuth();
  const [mounted, setMounted] = React.useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && isAuthenticated && !user) {
      fetchProfile();
    }
  }, [mounted, isAuthenticated, user, fetchProfile]);

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  const userMenuItems: MenuProps['items'] = [
    {
      key: 'profile',
      label: (
        <div className="py-1">
          <p className="font-semibold text-gray-800 m-0">{user?.fullName || user?.name || user?.email}</p>
          <p className="text-xs text-gray-500 m-0">{user?.email}</p>
        </div>
      ),
    },
    { type: 'divider' },
    ...(user?.role && ['SUPER_ADMIN', 'ADMIN', 'STORE_MANAGER', 'PHARMACIST'].includes(user.role)
      ? [
        {
          key: 'admin',
          icon: <DashboardOutlined />,
          label: <Link href="/admin">Admin Portal</Link>,
        },
      ]
      : []),
    ...(user?.role && ['WAREHOUSE_MANAGER', 'WAREHOUSE_STAFF', 'FACTORY_WAREHOUSE_STAFF'].includes(user.role)
      ? [
        {
          key: 'warehouse',
          icon: <DashboardOutlined />,
          label: <Link href="/warehouse">Warehouse Portal</Link>,
        },
      ]
      : []),
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      danger: true,
      label: 'Sign Out',
      onClick: handleLogout,
    },
  ];

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-8">
          <Link href="/" className="flex items-center space-x-2">
            <span className="text-xl font-bold text-blue-600 tracking-tight">PharmaTrace VN</span>
          </Link>
          <nav className="hidden md:flex space-x-6 text-sm font-medium text-gray-600">
            <Link href="/" className="hover:text-blue-600 transition-colors">Catalog</Link>
            <Link href="/trace" className="hover:text-blue-600 transition-colors flex items-center space-x-1">
              <QrcodeOutlined />
              <span>Public Trace</span>
            </Link>
          </nav>
        </div>

        <div className="flex items-center space-x-4">
          {mounted && isAuthenticated && user ? (
            <Dropdown menu={{ items: userMenuItems }} trigger={['click']} placement="bottomRight">
              <Button type="default" icon={<UserOutlined />} className="flex items-center">
                <span className="hidden sm:inline font-medium">{user.fullName || user.username || user.name || 'Account'}</span>
              </Button>
            </Dropdown>
          ) : (
            <Link href="/login">
              <Button type="primary">Sign In</Button>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
};
