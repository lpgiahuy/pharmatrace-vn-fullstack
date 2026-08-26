'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import {
  Search,
  ShoppingCart,
  User,
  Menu,
  X,
  Heart,
  Bell,
  MapPin,
  Phone,
  Smartphone,
  ChevronDown,
  QrCode,
} from 'lucide-react';
import { useAuth } from '@/store/useAuthStore';

const Logo = "https://res.cloudinary.com/dc64co0el/image/upload/v1777731026/Logo_ck5ouv.svg";

const NAV_LINKS = [
  { label: 'Thuốc Kê Đơn', href: '/products' },
  { label: 'Góc Sức Khỏe', href: '/blog' },
  { label: 'Thực Phẩm Chức Năng', href: '/products' },
  { label: 'Mẹ & Bé', href: '/products' },
  { label: 'Tra Cứu Nguồn Gốc (QR)', href: '/trace' },
];

export const Header: React.FC = () => {
  const [searchVal, setSearchVal] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { user, isAuthenticated, logout } = useAuth();

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchVal.trim()) {
      router.push(`/products?search=${encodeURIComponent(searchVal.trim())}`);
      setMobileMenuOpen(false);
    }
  };

  return (
    <header className="sticky top-0 z-40 shadow-sm">
      {/* Top Utility Bar */}
      <div className="bg-white border-b border-slate-100 py-1.5 hidden md:block">
        <div className="max-w-[1440px] mx-auto px-4 flex items-center justify-between text-[11px] font-bold text-slate-500">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 hover:text-[#004996] cursor-pointer transition-colors uppercase">
              <Smartphone className="w-3.5 h-3.5" /> Tải ứng dụng PharmaTrace
            </span>
            <div className="h-3 w-px bg-slate-200" />
            <div className="flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5" />
              <span className="uppercase">Hotline Tư Vấn:</span>
              <span className="font-black text-slate-900">1800 6821</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Link
              href="/trace"
              className="flex items-center gap-1.5 text-[#004996] font-extrabold hover:underline uppercase"
            >
              <QrCode className="w-3.5 h-3.5" /> Tra cứu Nguồn gốc Dual-Code
              <span className="px-1.5 py-0.5 rounded-sm bg-[#00A551] text-white text-[8px] font-black leading-none">
                HOT
              </span>
            </Link>
            <div className="h-3 w-px bg-slate-200" />
            <Link
              href="/blog"
              className="flex items-center gap-1.5 hover:text-[#004996] transition-colors uppercase"
            >
              <Heart className="w-3.5 h-3.5 text-[#ed1c24]" /> Góc Sức Khỏe
            </Link>
            <div className="h-3 w-px bg-slate-200" />
            <span className="flex items-center gap-1.5 hover:text-[#004996] cursor-pointer transition-colors uppercase">
              <MapPin className="w-3.5 h-3.5 text-[#004996]" /> Hệ Thống Nhà Thuốc
            </span>
          </div>
        </div>
      </div>

      {/* Main Header — Pharmacity Blue */}
      <div className="bg-[#004996] border-b border-[#004084] shadow-md">
        <div className="max-w-[1440px] mx-auto px-4">
          <div className="flex items-center gap-6 h-[64px] justify-between">
            {/* Logo & Brand Name */}
            <div className="flex items-center gap-4">
              <Link href="/" className="flex items-center gap-2.5 shrink-0">
                <img
                  src={Logo}
                  alt="PharmaTrace VN Logo"
                  className="h-10 w-auto object-contain bg-white rounded-lg p-1"
                />
                <div className="hidden lg:block">
                  <span className="text-[18px] font-bold text-white block leading-none tracking-tight">
                    PharmaTrace VN
                  </span>
                  <span className="text-[9px] text-white/70 font-bold tracking-[0.2em] uppercase mt-0.5 block">
                    Supply Chain Transparency
                  </span>
                </div>
              </Link>

              {/* Navigation Links */}
              <nav className="hidden xl:flex items-center gap-1">
                {NAV_LINKS.map((link) => (
                  <Link
                    key={link.label}
                    href={link.href}
                    className={`text-[14px] font-bold px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
                      pathname === link.href
                        ? 'bg-white/20 text-white'
                        : 'text-white/90 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
            </div>

            {/* Center Search Bar */}
            <form onSubmit={handleSearch} className="flex-1 max-w-md hidden md:flex items-center relative">
              <input
                type="text"
                placeholder="Tìm kiếm thuốc, thực phẩm chức năng, thiết bị y tế..."
                value={searchVal}
                onChange={(e) => setSearchVal(e.target.value)}
                className="w-full pl-4 pr-10 py-2 rounded-full border-none bg-white text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 shadow-inner"
              />
              <button
                type="submit"
                className="absolute right-1 top-1/2 -translate-y-1/2 bg-[#004996] hover:bg-[#004084] text-white p-1.5 rounded-full transition-colors"
              >
                <Search className="w-4 h-4" />
              </button>
            </form>

            {/* Right Action Icons */}
            <div className="flex items-center gap-2 shrink-0">
              <Link href="/trace">
                <button className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-bold transition-all shadow-sm">
                  <QrCode className="w-4 h-4" />
                  <span>Tra Cứu QR</span>
                </button>
              </Link>

              {mounted && isAuthenticated ? (
                <div className="relative group">
                  <button className="flex items-center gap-2 px-3 py-1.5 text-white hover:bg-white/10 rounded-xl transition-all">
                    <User className="w-5 h-5" />
                    <span className="text-[13px] font-bold hidden md:block max-w-[100px] truncate">
                      {user?.fullName || user?.name || 'Tài khoản'}
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 opacity-70" />
                  </button>
                  <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-2xl shadow-xl border border-slate-100 py-2 invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-all z-50">
                    <div className="px-4 py-2 border-b border-slate-100">
                      <p className="text-[10px] text-slate-400 font-bold uppercase">Đã đăng nhập</p>
                      <p className="text-sm font-bold text-[#004996] truncate">{user?.email}</p>
                    </div>
                    <Link href="/account/profile" className="block px-4 py-2 text-sm text-slate-700 hover:bg-blue-50 font-medium">
                      Hồ sơ cá nhân
                    </Link>
                    <Link href="/account/orders" className="block px-4 py-2 text-sm text-slate-700 hover:bg-blue-50 font-medium">
                      Đơn hàng của tôi
                    </Link>
                    {['SuperAdmin', 'Admin', 'QuanLyCuaHang'].includes(user?.role || '') && (
                      <Link href="/admin" className="block px-4 py-2 text-sm text-[#004996] font-bold hover:bg-blue-50">
                        Trang Admin ERP
                      </Link>
                    )}
                    {['QuanLyKho', 'NhanVienKho'].includes(user?.role || '') && (
                      <Link href="/warehouse" className="block px-4 py-2 text-sm font-bold text-amber-600 hover:bg-amber-50">
                        Trang WMS Kho hàng
                      </Link>
                    )}
                    <button
                      onClick={logout}
                      className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 font-bold border-t border-slate-100 mt-1"
                    >
                      Đăng xuất
                    </button>
                  </div>
                </div>
              ) : (
                <Link
                  href="/login"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-white hover:bg-white/10 rounded-xl transition-all"
                >
                  <User className="w-5 h-5" />
                  <span className="text-[13px] font-bold hidden md:block">Đăng nhập</span>
                </Link>
              )}

              <Link
                href="/cart"
                className="relative flex items-center gap-1.5 px-3 py-1.5 text-white hover:bg-white/10 rounded-xl transition-all"
              >
                <ShoppingCart className="w-5 h-5" />
                <span className="text-[13px] font-bold hidden md:block">Giỏ hàng</span>
              </Link>

              {/* Mobile menu button */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="p-2 text-white hover:bg-white/10 rounded-xl xl:hidden"
              >
                {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
