'use client';

import { useHydrated } from '@/hooks/useHydrated';
import React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Layout, Menu, Drawer } from 'antd';
import type { MenuProps } from 'antd';
import {
  DashboardOutlined,
  TeamOutlined,
  UserOutlined,
  MedicineBoxOutlined,
  AppstoreOutlined,
  PercentageOutlined,
  CommentOutlined,
  ShoppingOutlined,
  CarOutlined,
} from '@ant-design/icons';

const { Sider } = Layout;

interface AdminSidebarProps {
  collapsed: boolean;
  onCollapse: () => void;
  isMobile: boolean;
  role?: string;
}

const LOGO_URL = 'https://res.cloudinary.com/dc64co0el/image/upload/v1777731026/Logo_ck5ouv.svg';


interface SidebarContentProps {
  isCollapsed: boolean;
  isWarehouseStaff: boolean;
  selectedKey: string;
  menuItems: MenuProps['items'];
  onCollapse: () => void;
  isMobile: boolean;
  onNavigate: (key: string) => void;
}

function SidebarContent({
  isCollapsed,
  isWarehouseStaff,
  selectedKey,
  menuItems,
  onCollapse,
  isMobile,
  onNavigate,
}: SidebarContentProps) {
  return (
    <div className="flex h-full flex-col bg-white select-none border-r border-slate-100">
      {/* Brand Header */}
      <div
        className={`flex shrink-0 items-center gap-2.5 px-4 h-16 border-b border-slate-100 ${
          isCollapsed ? 'justify-center px-2' : ''
        }`}
      >
        <div className="w-9 h-9 rounded-lg bg-linear-to-tr from-[#003875] to-[#004996] flex items-center justify-center p-1.5 shadow-xs shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={LOGO_URL}
            alt="PharmaTrace VN"
            className="w-full h-full object-contain"
          />
        </div>
        {!isCollapsed && (
          <span className="font-display font-black text-[#004996] text-lg tracking-tight whitespace-nowrap">
            PharmaTrace VN
          </span>
        )}
      </div>

      {/* Category Section Caption */}
      {!isCollapsed && (
        <div className="shrink-0 px-5 pt-4 pb-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            {isWarehouseStaff ? 'WMS LOGISTICS' : 'ADMIN PORTAL'}
          </span>
        </div>
      )}

      {/* Vertical Navigation Menu */}
      <div className="flex-1 overflow-y-auto py-2">
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => {
            if (isMobile) onCollapse();
            onNavigate(key);
          }}
          className="border-r-0! bg-transparent! px-2"
        />
      </div>
    </div>
  );
}

export const AdminSidebar: React.FC<AdminSidebarProps> = ({
  collapsed,
  onCollapse,
  isMobile,
  role,
}) => {
  const router = useRouter();
  const pathname = usePathname();
  const mounted = useHydrated();

  const normalizedRole = (role || '').toUpperCase().replace(/[\s_-]/g, '');
  const canManageStaff = normalizedRole === 'SUPERADMIN' || normalizedRole === 'STOREMANAGER';
  const isWarehouseStaff = normalizedRole === 'WAREHOUSESTAFF' || normalizedRole === 'WAREHOUSEMANAGER';
  const isFinanceStaff = normalizedRole === 'ACCOUNTANT' || normalizedRole === 'FINANCEMANAGER';

  const menuItems = isFinanceStaff
    ? [
        { key: '/admin/orders', icon: <ShoppingOutlined style={{ fontSize: 16 }} />, label: 'Order Payments' },
      ]
    : isWarehouseStaff
    ? [
        {
          key: '/admin/logistics',
          icon: <CarOutlined style={{ fontSize: 16 }} />,
          label: 'Logistics Operations',
        },
        {
          key: '/admin/orders',
          icon: <ShoppingOutlined style={{ fontSize: 16 }} />,
          label: 'Orders & Packing',
        },
      ]
    : [
        {
          key: '/admin',
          icon: <DashboardOutlined style={{ fontSize: 16 }} />,
          label: 'Dashboard',
        },
        {
          key: '/admin/categories',
          icon: <AppstoreOutlined style={{ fontSize: 16 }} />,
          label: 'Categories',
        },
        {
          key: '/admin/products',
          icon: <MedicineBoxOutlined style={{ fontSize: 16 }} />,
          label: 'Medicines & Catalog',
        },
        {
          key: '/admin/orders',
          icon: <ShoppingOutlined style={{ fontSize: 16 }} />,
          label: 'Orders & Fulfillment',
        },
        {
          key: '/admin/logistics',
          icon: <CarOutlined style={{ fontSize: 16 }} />,
          label: 'Logistics Operations',
        },
        {
          key: '/admin/reviews',
          icon: <CommentOutlined style={{ fontSize: 16 }} />,
          label: 'Review Moderation',
        },
        {
          key: '/admin/vouchers',
          icon: <PercentageOutlined style={{ fontSize: 16 }} />,
          label: 'Vouchers & Promos',
        },
        ...(canManageStaff
          ? [
              {
                key: '/admin/staff',
                icon: <TeamOutlined style={{ fontSize: 16 }} />,
                label: 'Staff & RBAC',
              },
            ]
          : []),
        {
          key: '/admin/customers',
          icon: <UserOutlined style={{ fontSize: 16 }} />,
          label: 'Customer Management',
        },
      ];

  // Determine selected key based on current pathname
  const selectedKey =
    menuItems.find(
      (item) =>
        pathname === item.key ||
        (item.key !== '/admin' && pathname.startsWith(item.key))
    )?.key || (isWarehouseStaff ? '/admin/logistics' : '/admin');

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
        <SidebarContent
          isCollapsed={collapsed}
          isWarehouseStaff={isWarehouseStaff}
          selectedKey={selectedKey}
          menuItems={menuItems}
          onCollapse={onCollapse}
          isMobile={isMobile}
          onNavigate={(k) => router.push(k)}
        />
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
        <SidebarContent
          isCollapsed={false}
          isWarehouseStaff={isWarehouseStaff}
          selectedKey={selectedKey}
          menuItems={menuItems}
          onCollapse={onCollapse}
          isMobile={isMobile}
          onNavigate={(k) => router.push(k)}
        />
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
      <SidebarContent
        isCollapsed={collapsed}
        isWarehouseStaff={isWarehouseStaff}
        selectedKey={selectedKey}
        menuItems={menuItems}
        onCollapse={onCollapse}
        isMobile={isMobile}
        onNavigate={(k) => router.push(k)}
      />
    </Sider>
  );
};
