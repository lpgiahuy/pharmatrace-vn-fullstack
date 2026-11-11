'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LogisticsIndexPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/admin/logistics/shipments');
  }, [router]);

  return null;
}

