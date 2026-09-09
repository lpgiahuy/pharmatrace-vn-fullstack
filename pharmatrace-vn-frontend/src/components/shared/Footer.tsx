'use client';

import React from 'react';
import Link from 'next/link';
import { Pill, Phone, Mail, MapPin } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="bg-[#004996] text-white mt-auto overflow-hidden">
      <div className="max-w-[1440px] mx-auto px-4 py-12 md:py-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-12 lg:gap-8">
          {/* Column 1: About */}
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-white flex items-center justify-center shadow-lg">
                <Pill className="w-6 h-6 text-[#004996]" />
              </div>
              <div>
                <span className="text-white font-display font-black text-2xl block leading-none">
                  PharmaTrace VN
                </span>
                <span className="text-[10px] text-white font-black tracking-widest uppercase">
                  Health & Care
                </span>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-white font-medium max-w-xs m-0">
              Your trusted partner for healthcare in Vietnam. We guarantee 100% authentic products with transparent traceability and dedicated safety standards.
            </p>
            <div className="flex gap-4">
              <a
                href="#"
                className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white hover:text-[#004996] transition-all group"
                aria-label="Facebook"
              >
                <svg className="w-5 h-5 fill-white group-hover:fill-[#004996] transition-colors" viewBox="0 0 24 24">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                </svg>
              </a>
              <a
                href="#"
                className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-[#ed1c24] hover:text-white transition-all group"
                aria-label="Youtube"
              >
                <svg className="w-5 h-5 fill-white transition-colors" viewBox="0 0 24 24">
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                </svg>
              </a>
            </div>
          </div>

          {/* Column 2: Products */}
          <div>
            <h4 className="text-white font-black text-sm uppercase tracking-widest mb-8 relative inline-block">
              Products
            </h4>
            <ul className="space-y-4 text-[13px] font-bold text-white list-none p-0 m-0">
              {[
                'Dietary Supplements',
                'OTC Medicines',
                'Personal Care',
                'Cosmeceuticals',
                'Medical Devices',
                'Baby Products',
              ].map((item) => (
                <li key={item}>
                  <Link
                    href="/products"
                    className="!text-white hover:text-green-300 transition-all flex items-center hover:translate-x-1 duration-300"
                  >
                    {item}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Column 3: Customer Support */}
          <div>
            <h4 className="text-white font-black text-sm uppercase tracking-widest mb-8 relative inline-block">
              Customer Support
            </h4>
            <ul className="space-y-4 text-[13px] font-bold text-white list-none p-0 m-0">
              {[
                { label: 'My Orders', href: '/products' },
                { label: 'Returns Policy', href: '/products' },
                { label: 'Shipping & Payment', href: '/products' },
                { label: 'Health Blog', href: '/products' },
                { label: 'FAQs', href: '/products' },
                { label: 'Product Traceability', href: '/products' },
              ].map((item) => (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    className="!text-white !hover:text-green-300 transition-all flex items-center hover:translate-x-1 duration-300"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Column 4: Contact */}
          <div>
            <h4 className="text-white font-black text-sm uppercase tracking-widest mb-8 relative inline-block">
              Contact
            </h4>
            <ul className="space-y-5 list-none p-0 m-0">
              <li className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shrink-0 shadow-md">
                  <Phone className="w-5 h-5 text-[#004996]" />
                </div>
                <div>
                  <p className="text-white/70 text-[10px] uppercase font-black tracking-tighter m-0">
                    FREE 24/7 HOTLINE
                  </p>
                  <p className="text-white font-black text-lg leading-none m-0 mt-1">1800 6821</p>
                </div>
              </li>
              <li className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shrink-0 shadow-md">
                  <Mail className="w-5 h-5 text-[#004996]" />
                </div>
                <div>
                  <p className="text-white/70 text-[10px] uppercase font-black tracking-tighter m-0">
                    EMAIL SUPPORT
                  </p>
                  <p className="text-white font-black text-sm leading-none m-0 mt-1">
                    support@pharmatrace.vn
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shrink-0 shadow-md">
                  <MapPin className="w-5 h-5 text-[#004996]" />
                </div>
                <div>
                  <p className="text-white/70 text-[10px] uppercase font-black tracking-tighter m-0">
                    HEAD OFFICE
                  </p>
                  <p className="text-white font-black text-sm leading-none m-0 mt-1">
                    Ho Chi Minh City
                  </p>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Bottom Sub-Footer Bar */}
      <div className="bg-[#003b7a] py-5 sm:py-6 border-t border-white/10">
        <div className="max-w-[1440px] mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4 text-xs font-medium text-white/90">
          <p className="m-0 text-center md:text-left text-[11px] sm:text-xs tracking-normal">
            © 2026 PHARMATRACE VN. DEVELOPED BY LE PHAM GIA HUY.
          </p>
          <div className="flex flex-wrap items-center justify-center md:justify-end gap-x-5 gap-y-2 text-[11px] sm:text-xs font-bold uppercase tracking-wider">
            <Link href="/products" className="!text-white hover:text-green-300 transition-colors whitespace-nowrap">
              PRIVACY POLICY
            </Link>
            <Link href="/products" className="!text-white hover:text-green-300 transition-colors whitespace-nowrap">
              TERMS OF SERVICE
            </Link>
            <Link href="/products" className="!text-white hover:text-green-300 transition-colors whitespace-nowrap">
              OPERATION LICENSE
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
};
