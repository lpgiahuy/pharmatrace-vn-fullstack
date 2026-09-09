'use client';

import React from 'react';
import { Header } from '@/components/shared/Header';
import { Footer } from '@/components/shared/Footer';

export default function EcomLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 font-sans">
      <Header />
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 py-6">
        {children}
      </main>
      <Footer />
    </div>
  );
}
