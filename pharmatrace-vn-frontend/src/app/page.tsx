'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Card, Tag } from 'antd';
import { QrcodeOutlined, ShoppingCartOutlined, DashboardOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { Navbar } from '@/components/common/Navbar';
import { useAuth } from '@/store/useAuthStore';

export default function HomePage() {
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center max-w-3xl mx-auto mb-12">
          <Tag color="blue" className="px-3 py-1 text-sm font-medium mb-3 rounded-full">
            Fullstack TypeScript Architecture
          </Tag>
          <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight sm:text-5xl">
            PharmaTrace VN Platform
          </h1>
          <p className="mt-4 text-lg text-gray-600 leading-relaxed">
            An integrated pharmaceutical supply chain transparency, warehouse logistics (WMS), and dual-code anti-counterfeiting verification ecosystem.
          </p>

          <div className="mt-8 flex justify-center gap-4">
            <Button
              type="primary"
              size="large"
              icon={<QrcodeOutlined />}
              className="h-12 px-6 text-base font-semibold"
              onClick={() => router.push('/trace')}
            >
              Public QR Trace
            </Button>

            {mounted && isAuthenticated ? (
              <Button
                size="large"
                icon={<DashboardOutlined />}
                className="h-12 px-6 text-base font-semibold"
                onClick={() => router.push('/admin')}
              >
                Dashboard
              </Button>
            ) : (
              <Button
                size="large"
                className="h-12 px-6 text-base font-semibold"
                onClick={() => router.push('/login')}
              >
                Sign In / Register
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-12">
          <Card className="shadow-sm rounded-xl border-gray-200 hover:shadow-md transition-shadow">
            <div className="text-blue-600 text-3xl mb-4">
              <SafetyCertificateOutlined />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Dual-Code Verification</h3>
            <p className="text-gray-600 text-sm">
              Public QR codes combined with scratch-off master OTPs encrypted via HMAC/AES cryptographic signatures to ensure zero counterfeit cloning.
            </p>
          </Card>

          <Card className="shadow-sm rounded-xl border-gray-200 hover:shadow-md transition-shadow">
            <div className="text-green-600 text-3xl mb-4">
              <QrcodeOutlined />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Velocity Anomaly Engine</h3>
            <p className="text-gray-600 text-sm">
              Real-time fraud detection computing geographic displacement using the Haversine formula to instantly flag duplicated QR code scans.
            </p>
          </Card>

          <Card className="shadow-sm rounded-xl border-gray-200 hover:shadow-md transition-shadow">
            <div className="text-purple-600 text-3xl mb-4">
              <ShoppingCartOutlined />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">WMS & Multi-Batch Logistics</h3>
            <p className="text-gray-600 text-sm">
              Atomic inter-facility inventory transactions, purchase order synchronization, and prescription management.
            </p>
          </Card>
        </div>
      </main>
    </div>
  );
}
