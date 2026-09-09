'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { AdminLayout } from '@/components/layout/AdminLayout';

export default function AdminRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  // Bypass layout for the login page
  if (pathname === '/admin/login') {
    return <>{children}</>;
  }

  return <AdminLayout>{children}</AdminLayout>;
}
