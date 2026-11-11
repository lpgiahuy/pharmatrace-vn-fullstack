'use client';

import { useHydrated } from '@/hooks/useHydrated';
import React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Tabs } from 'antd';
import { CarOutlined, SwapOutlined, DollarOutlined } from '@ant-design/icons';
import { useAuthStore } from '@/store/useAuthStore';
import { codPermissions } from '@/utils/cod-workflow';

interface LogisticsLayoutProps {
  children: React.ReactNode;
}


export default function LogisticsLayout({ children }: LogisticsLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const getUser = useAuthStore((state) => state.getUser);
  const mounted = useHydrated();

  const user = mounted ? getUser() : null;
  const role = (user?.role || '').toUpperCase().replace(/[\s_-]/g, '');
  const canAccessCod = codPermissions(user?.role).canView;
  const isFinanceStaff = role === 'ACCOUNTANT' || role === 'FINANCEMANAGER';

  // Determine active tab key
  let activeKey = '/admin/logistics/shipments';
  if (pathname.includes('/transfers')) {
    activeKey = '/admin/logistics/transfers';
  } else if (pathname.includes('/cod')) {
    activeKey = '/admin/logistics/cod';
  } else if (pathname.includes('/policies')) {
    activeKey = '/admin/logistics/policies';
  }

  const tabItems = [
    ...(!isFinanceStaff
      ? [
          {
            key: '/admin/logistics/shipments',
            label: (
              <span className="flex items-center gap-1.5 text-xs sm:text-sm font-medium">
                <CarOutlined /> Shipments
              </span>
            ),
          },
          {
            key: '/admin/logistics/transfers',
            label: (
              <span className="flex items-center gap-1.5 text-xs sm:text-sm font-medium">
                <SwapOutlined /> Internal Transfers
              </span>
            ),
          },
        ]
      : []),
    ...(canAccessCod
      ? [
          {
            key: '/admin/logistics/cod',
            label: (
              <span className="flex items-center gap-1.5 text-xs sm:text-sm font-medium">
                <DollarOutlined /> COD &amp; Reconciliation
              </span>
            ),
          },
        ]
      : []),
    ...(['SUPERADMIN', 'STOREMANAGER'].includes(role)
      ? [
          {
            key: '/admin/logistics/policies',
            label: (
              <span className="flex items-center gap-1.5 text-xs sm:text-sm font-medium">
                Delivery policies
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-3 font-sans w-full">
      {/* Top Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">
          Logistics &amp; Warehouse Operations
        </h1>
        <p className="text-slate-500 text-xs sm:text-sm mt-0.5">
          Manage delivery shipments, inter-facility stock transfers, and cash-on-delivery (COD) reconciliation.
        </p>
      </div>

      {/* Navigation Tabs (flat, cohesive, clean bottom border) */}
      <div className="border-b border-gray-200">
        <Tabs
          activeKey={activeKey}
          onChange={(key) => router.push(key)}
          items={tabItems}
          className="[&_.ant-tabs-nav]:mb-0 [&_.ant-tabs-ink-bar]:bg-[#004996] [&_.ant-tabs-tab-active_.ant-tabs-tab-btn]:text-[#004996]! [&_.ant-tabs-tab]:text-xs sm:[&_.ant-tabs-tab]:text-sm [&_.ant-tabs-tab]:pb-2.5"
        />
      </div>

      {/* Main Tab Content */}
      <div className="min-w-0 pt-1">{children}</div>
    </div>
  );
}
