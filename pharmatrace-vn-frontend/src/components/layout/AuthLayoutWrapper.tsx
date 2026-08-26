'use client';

import React from 'react';
import Link from 'next/link';
import { Lock, ShieldCheck, Truck } from 'lucide-react';

const PHARMACIST_IMG =
  'https://img.freepik.com/premium-photo/man-pharmacy-with-white-coat-stands-front-shelf-with-medicines_856987-278.jpg?w=2000';

interface AuthLayoutWrapperProps {
  children: React.ReactNode;
}

export const AuthLayoutWrapper: React.FC<AuthLayoutWrapperProps> = ({ children }) => {
  return (
    <div className="min-h-screen flex bg-white font-sans text-slate-800">
      {/* Left Panel – Pharmacist Image + Brand Overlay (42% width) */}
      <div
        className="hidden lg:flex flex-col justify-between w-[42%] relative overflow-hidden shrink-0"
        style={{
          backgroundImage: `url(${PHARMACIST_IMG})`,
          backgroundSize: 'cover',
          backgroundPosition: 'right top',
        }}
      >
        {/* Blue Overlay (40% opacity) */}
        <div className="absolute inset-0 bg-[#004084]/40" />

        {/* Branding Content */}
        <div className="relative z-10 flex flex-col justify-between h-full p-12 text-white">
          {/* Logo Header */}
          <Link href="/" className="flex items-center gap-2.5">
            <svg
              className="w-7 h-7 text-white drop-shadow-sm"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M6 3h12v2H6V3zm0 4h12c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V9c0-1.1.9-2 2-2zm5 3v2H9v2h2v2h2v-2h2v-2h-2v-2h-2z" />
            </svg>
            <span className="text-xl font-bold text-white tracking-tight drop-shadow-sm">
              PharmaTrace VN
            </span>
          </Link>

          {/* Hero Tagline */}
          <div style={{ textShadow: '0 2px 12px rgba(0,0,0,0.45)' }} className="my-auto py-8">
            <h1 className="text-4xl font-extrabold text-white leading-tight mb-4 tracking-tight">
              Your trusted<br />pharmacy partner
            </h1>
            <p className="text-white/90 text-sm leading-relaxed max-w-xs font-normal">
              Access certified medicines, track your orders, and manage your health with confidence.
            </p>
          </div>

          {/* Trust Badges */}
          <div className="flex flex-row items-center gap-5 border-t border-white/20 pt-6">
            <div className="flex items-center gap-2 text-white/90 drop-shadow-sm">
              <Lock className="w-4 h-4 text-white/80" />
              <span className="text-xs font-semibold tracking-wide">Secure & Encrypted</span>
            </div>
            <div className="flex items-center gap-2 text-white/90 drop-shadow-sm">
              <ShieldCheck className="w-4 h-4 text-white/80" />
              <span className="text-xs font-semibold tracking-wide">GMP Certified</span>
            </div>
            <div className="flex items-center gap-2 text-white/90 drop-shadow-sm">
              <Truck className="w-4 h-4 text-white/80" />
              <span className="text-xs font-semibold tracking-wide">Fast Delivery</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel – Form Content */}
      <div className="flex-1 flex items-center justify-center p-8 bg-white overflow-y-auto">
        <div className="w-full max-w-md py-6">
          {/* Top Logo */}
          <div className="mb-8">
            <Link href="/" style={{ color: '#1e4287' }} className="text-2xl font-extrabold tracking-tight block">
              PharmaTrace VN
            </Link>
          </div>

          {children}
        </div>
      </div>
    </div>
  );
};
