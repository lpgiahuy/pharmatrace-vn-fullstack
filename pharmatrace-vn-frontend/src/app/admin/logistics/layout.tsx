'use client';

import { useHydrated } from '@/hooks/useHydrated';
import React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Tabs } from 'antd';
import { SwapOutlined } from '@ant-design/icons';
import { useAuthStore } from '@/store/useAuthStore';

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
  const isFinanceStaff = role === 'ACCOUNTANT' || role === 'FINANCEMANAGER';

  // Determine active tab key
  let activeKey = '/admin/logistics/transfers';
  if (pathname.includes('/policies')) {
    activeKey = '/admin/logistics/policies';
  }

  const tabItems = [
    ...(!isFinanceStaff
      ? [
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
          Manage inter-facility stock transfers and delivery policies.
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
