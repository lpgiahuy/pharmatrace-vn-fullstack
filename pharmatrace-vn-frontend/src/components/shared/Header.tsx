'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  User,
  Menu,
  X,
  Heart,
  Bell,
  MapPin,
  Phone,
  Smartphone,
  ChevronDown,
  Flame,
  Search,
  LogOut,
  ShoppingCart,
  Package,
  FileText,
} from 'lucide-react';
import { useAuth } from '@/store/useAuthStore';
import { useCartStore } from '@/store/useCartStore';
import { categoryService } from '@/services/category.service';
import { Category } from '@/types/category.types';
import { CategoryIcon } from '@/components/common/CategoryIcon';

const Logo = "https://res.cloudinary.com/dc64co0el/image/upload/v1777731026/Logo_ck5ouv.svg";

const NAV_LINKS = [
  { label: 'Medications', href: '/products' },
  { label: 'Health Library', href: '/products' },
  { label: 'Supplements', href: '/products' },
  { label: 'Mom & Baby', href: '/products' },
  { label: 'PharmaTrace VN Brands', href: '/products' },
];

export const Header: React.FC = () => {
  const [searchVal, setSearchVal] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  const { user, isAuthenticated, logout } = useAuth();
  const totalCartItems = useCartStore((state) => state.getTotalItems());
  const fetchServerCart = useCartStore((state) => state.fetchServerCart);

  useEffect(() => {
    setMounted(true);
    categoryService.getCategories().then((res) => {
      if (res?.data) {
        setCategories(res.data.filter((c) => !c.parentId));
      }
    });
  }, []);

  useEffect(() => {
    if (mounted && isAuthenticated) {
      fetchServerCart();
    }
  }, [mounted, isAuthenticated, fetchServerCart]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchVal.trim()) {
      router.push(`/products?search=${encodeURIComponent(searchVal.trim())}`);
      setMobileMenuOpen(false);
    }
  };

  return (
    <header className="sticky top-0 z-40 shadow-xs">
      {/* Top Utility Bar (100% replica of Photo 4 - single evenly-spaced bar across full width) */}
      <div className="bg-white border-b border-slate-100 py-2 hidden md:block">
        <div className="max-w-[1440px] mx-auto px-4 flex items-center justify-between gap-2 text-[11px] font-bold text-slate-500 tracking-wide overflow-x-auto no-scrollbar">
          <Link
            href="/products"
            className="flex items-center gap-1.5 !text-slate-500 hover:text-[#004996] transition-colors uppercase whitespace-nowrap shrink-0"
          >
            <Smartphone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>DOWNLOAD OUR APP</span>
          </Link>
          <div className="h-3 w-px bg-slate-200 shrink-0" />
          <div className="flex items-center gap-1.5 whitespace-nowrap text-slate-500 shrink-0">
            <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="uppercase">SUPPORT HOTLINE</span>
            <span className="font-black text-slate-900 ml-0.5">1800 6821</span>
          </div>
          <div className="h-3 w-px bg-slate-200 shrink-0" />
          <Link
            href="/products"
            className="flex items-center gap-1.5 !text-slate-500 hover:text-[#004996] transition-colors uppercase whitespace-nowrap shrink-0"
          >
            <span>CORPORATE / B2B</span>
            <span className="px-1.5 py-0.5 rounded-xs bg-[#00A551] text-white text-[8px] font-black leading-none">
              NEW
            </span>
          </Link>
          <div className="h-3 w-px bg-slate-200 shrink-0" />
          <Link
            href="/products"
            className="flex items-center gap-1.5 !text-slate-500 hover:text-[#004996] transition-colors uppercase whitespace-nowrap shrink-0"
          >
            <span>MONTHLY SAVINGS</span>
            <Flame className="w-3.5 h-3.5 text-orange-500 fill-orange-500 shrink-0" />
          </Link>
          <div className="h-3 w-px bg-slate-200 shrink-0" />
          <Link
            href="/products"
            className="flex items-center gap-1.5 !text-slate-500 hover:text-[#004996] transition-colors uppercase whitespace-nowrap shrink-0"
          >
            <span>TRACK ORDER</span>
            <span className="px-1.5 py-0.5 rounded-xs bg-[#004996] text-white text-[8px] font-black leading-none">
              NEW
            </span>
          </Link>
          <div className="h-3 w-px bg-slate-200 shrink-0" />
          <Link
            href="/products"
            className="flex items-center gap-1.5 !text-slate-500 hover:text-[#004996] transition-colors uppercase whitespace-nowrap shrink-0"
          >
            <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500 shrink-0" />
            <span>HEALTH BLOG</span>
          </Link>
          <div className="h-3 w-px bg-slate-200 shrink-0" />
          <Link
            href="/products"
            className="flex items-center gap-1.5 !text-slate-500 hover:text-[#004996] transition-colors uppercase whitespace-nowrap shrink-0"
          >
            <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>PHARMACIES</span>
          </Link>
        </div>
      </div>

      {/* Main Header — Solid Brand Blue (#004996) */}
      <div className="bg-[#004996]">
        <div className="max-w-[1440px] mx-auto px-4">
          <div className="flex items-center gap-6 h-[60px] justify-between">
            {/* Left: Logo + Categories dropdown + Nav Links */}
            <div className="flex items-center gap-5">
              {/* Logo */}
              <Link href="/products" className="flex items-center gap-2 sm:gap-2.5 shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={Logo} alt="Logo" className="h-8 sm:h-9 w-auto object-contain shrink-0" />
                <div className="flex flex-col">
                  <span className="text-[15px] sm:text-[18px] font-display font-black !text-white block leading-none tracking-tight">
                    PharmaTrace VN
                  </span>
                  <span className="text-[8px] sm:text-[9px] !text-white/90 font-bold tracking-[0.18em] uppercase mt-0.5 block">
                    Health & Care
                  </span>
                </div>
              </Link>

              {/* Categories Dropdown */}
              <div className="relative group">
                <button
                  type="button"
                  className="hidden lg:flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-md text-sm font-bold transition-all whitespace-nowrap shrink-0 border border-white/20 cursor-pointer"
                >
                  <Menu className="w-4 h-4 text-white" />
                  <span className="text-white">Categories</span>
                  <ChevronDown className="w-3.5 h-3.5 text-white opacity-80" />
                </button>

                {/* Dropdown Menu */}
                <div className="absolute left-0 top-full mt-2 w-56 bg-white rounded-2xl shadow-xl border border-slate-100 py-2 invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-all duration-200 z-50 max-h-96 overflow-y-auto">
                  {categories.map((cat) => (
                    <Link
                      key={cat.id}
                      href={`/products?category=${cat.id}`}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm !text-black hover:bg-slate-100 hover:!text-black font-bold transition-colors"
                    >
                      <CategoryIcon icon={cat.icon || 'category'} size={16} />
                      <span className="flex-1 truncate !text-black">{cat.categoryName}</span>
                    </Link>
                  ))}
                </div>
              </div>

              {/* Nav links (Crisp white text with compact padding to prevent overlap) */}
              <nav className="hidden xl:flex items-center gap-0.5">
                {NAV_LINKS.map((link) => (
                  <Link
                    key={link.label}
                    href={link.href}
                    className="text-[13px] font-bold !text-white hover:text-green-300 px-2.5 py-1 rounded-lg hover:bg-white/10 transition-all whitespace-nowrap"
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
            </div>

            {/* Right: Notification, User Account, Mobile Menu Toggle */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <button
                type="button"
                className="p-2 text-white hover:bg-white/10 rounded-full transition-all cursor-pointer"
                title="Notifications"
              >
                <Bell className="w-5 h-5 text-white" />
              </button>

              {/* Shopping Cart Button */}
              <Link
                href="/cart"
                className="relative p-2 text-white hover:bg-white/10 rounded-full transition-all cursor-pointer flex items-center justify-center"
                title="Shopping Cart"
                aria-label="Shopping Cart"
              >
                <ShoppingCart className="w-5 h-5 text-white" />
                {mounted && totalCartItems > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-[#15803d] text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-[#004996] leading-none">
                    {totalCartItems > 99 ? '99+' : totalCartItems}
                  </span>
                )}
              </Link>

              {mounted && isAuthenticated && user ? (
                <div className="relative group">
                  <button
                    type="button"
                    className="flex items-center gap-2.5 px-3 py-1.5 text-white hover:bg-white/10 rounded-full transition-all cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white shrink-0">
                      <User className="w-4.5 h-4.5" />
                    </div>
                    <span className="text-sm font-bold text-white hidden sm:block max-w-[140px] truncate">
                      {user.fullName || user.name || user.email || 'Customer'}
                    </span>
                  </button>

                  <div className="absolute right-0 top-full mt-2.5 w-60 bg-white rounded-2xl shadow-xl border border-slate-100/90 py-2.5 px-1.5 invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-all duration-200 z-50">
                    {/* Upward pointer arrow */}
                    <div className="absolute -top-1.5 right-8 w-3 h-3 bg-white rotate-45 border-l border-t border-slate-100/90" />

                    <Link
                      href="/cart"
                      className="flex items-center justify-between px-3.5 py-2.5 text-sm font-semibold !text-black hover:bg-slate-100 rounded-xl transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <ShoppingCart className="w-[18px] h-[18px] text-black shrink-0 stroke-[1.8]" />
                        <span className="!text-black">Shopping Cart</span>
                      </div>
                      {mounted && totalCartItems > 0 && (
                        <span className="text-[11px] font-bold text-[#004996] bg-blue-50 px-2 py-0.5 rounded-full">
                          {totalCartItems}
                        </span>
                      )}
                    </Link>

                    <Link
                      href="/account"
                      className="flex items-center gap-3 px-3.5 py-2.5 text-sm font-semibold !text-black hover:bg-slate-100 rounded-xl transition-colors"
                    >
                      <User className="w-[18px] h-[18px] text-black shrink-0 stroke-[1.8]" />
                      <span className="!text-black">My Profile</span>
                    </Link>
                    <Link
                      href="/account/orders"
                      className="flex items-center gap-3 px-3.5 py-2.5 text-sm font-semibold !text-black hover:bg-slate-100 rounded-xl transition-colors"
                    >
                      <Package className="w-[18px] h-[18px] text-black shrink-0 stroke-[1.8]" />
                      <span className="!text-black">My Orders</span>
                    </Link>

                    <Link href="/account/prescriptions" className="flex items-center gap-3 px-3.5 py-2.5 text-sm font-semibold !text-black hover:bg-slate-100 rounded-xl transition-colors">
                      <FileText className="w-[18px] h-[18px] text-black shrink-0 stroke-[1.8]" />
                      <span className="!text-black">My Prescriptions</span>
                    </Link>

                    <Link
                      href="/wishlist"
                      className="flex items-center gap-3 px-3.5 py-2.5 text-sm font-semibold !text-black hover:bg-slate-100 rounded-xl transition-colors"
                    >
                      <Heart className="w-[18px] h-[18px] text-black shrink-0 stroke-[1.8]" />
                      <span className="!text-black">Wishlist</span>
                    </Link>

                    <button
                      type="button"
                      onClick={logout}
                      className="w-full flex items-center gap-3 px-3.5 py-2.5 text-sm font-semibold !text-red-600 hover:bg-red-50 rounded-xl transition-colors cursor-pointer text-left"
                    >
                      <LogOut className="w-[18px] h-[18px] text-red-600 shrink-0 stroke-[1.8]" />
                      <span className="!text-red-600">Logout</span>
                    </button>
                  </div>
                </div>
              ) : (
                <Link
                  href="/login"
                  className="flex items-center gap-2.5 px-3 py-1.5 text-white hover:bg-white/10 rounded-full transition-all"
                >
                  <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white shrink-0">
                    <User className="w-4.5 h-4.5" />
                  </div>
                  <span className="text-sm font-bold text-white hidden sm:block">Login</span>
                </Link>
              )}

              {/* Mobile Hamburger Toggle Button */}
              <button
                type="button"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="lg:hidden p-2 text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer ml-1"
                aria-label="Toggle mobile menu"
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Search Row */}
        <div className="lg:hidden px-4 pb-2.5 pt-0.5">
          <form onSubmit={handleSearch} className="relative w-full">
            <input
              type="text"
              value={searchVal}
              onChange={(e) => setSearchVal(e.target.value)}
              placeholder="Search medicines, vitamins, care products..."
              className="w-full bg-white/95 text-slate-800 text-xs rounded-lg pl-8 pr-4 py-2 border border-white/20 outline-none placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-blue-300 transition-all shadow-inner"
            />
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          </form>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
          />

          {/* Drawer Content */}
          <div data-mobile-nav className="fixed inset-y-0 right-0 max-w-xs w-full bg-white shadow-2xl p-5 overflow-y-auto flex flex-col z-10 animate-slide-left">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={Logo} alt="Logo" className="h-7 w-auto object-contain" />
                <span className="text-base font-bold text-[#004996]">PharmaTrace VN</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Navigation links */}
            <div className="py-4 border-b border-slate-100 space-y-1">
              <Link
                href="/cart"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center justify-between px-3 py-2 text-sm font-semibold !text-slate-800 hover:bg-slate-50 hover:!text-[#004996] rounded-xl transition-colors group"
              >
                <div className="flex items-center gap-2.5">
                  <ShoppingCart className="w-4 h-4 text-slate-600 group-hover:text-[#004996] transition-colors" />
                  <span className="!text-slate-800 group-hover:!text-[#004996]">Shopping Cart</span>
                </div>
                {mounted && totalCartItems > 0 && (
                  <span className="text-[11px] font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-full">
                    {totalCartItems}
                  </span>
                )}
              </Link>
              <Link href="/account/profile" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-2.5 px-3 py-2 text-sm font-semibold !text-slate-800 hover:bg-slate-50 rounded-xl">My profile</Link>
              <Link
                href="/account/orders"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2 text-sm font-semibold !text-slate-800 hover:bg-slate-50 hover:!text-[#004996] rounded-xl transition-colors group"
              >
                <Package className="w-4 h-4 text-slate-600 group-hover:text-[#004996] transition-colors" />
                <span className="!text-slate-800 group-hover:!text-[#004996]">My Orders</span>
              </Link>
              <Link href="/account/prescriptions" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-2.5 px-3 py-2 text-sm font-semibold !text-slate-800 hover:bg-slate-50 hover:!text-[#004996] rounded-xl transition-colors group">
                <FileText className="w-4 h-4 text-slate-600 group-hover:text-[#004996]" />
                <span className="!text-slate-800 group-hover:!text-[#004996]">My Prescriptions</span>
              </Link>
              <Link
                href="/wishlist"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2 text-sm font-semibold !text-slate-800 hover:bg-slate-50 hover:!text-[#004996] rounded-xl transition-colors group"
              >
                <Heart className="w-4 h-4 text-slate-600 group-hover:text-[#004996] transition-colors" />
                <span className="!text-slate-800 group-hover:!text-[#004996]">Wishlist</span>
              </Link>
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="block px-3 py-2 text-sm font-semibold !text-slate-800 hover:bg-slate-50 hover:!text-[#004996] rounded-xl transition-colors"
                >
                  {link.label}
                </Link>
              ))}
            </div>

            {/* Categories in Drawer */}
            <div className="py-4 border-b border-slate-100 flex-1">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2 mb-2">Categories</p>
              <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                {categories.map((cat) => (
                  <Link
                    key={cat.id}
                    href={`/products?category=${cat.id}`}
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-2.5 px-3 py-2 text-xs font-semibold !text-slate-800 hover:bg-slate-50 hover:!text-[#004996] rounded-xl transition-colors group"
                  >
                    <span className="text-slate-600 group-hover:text-[#004996] transition-colors">
                      <CategoryIcon icon={cat.icon || 'category'} size={14} />
                    </span>
                    <span className="truncate !text-slate-800 group-hover:!text-[#004996]">{cat.categoryName}</span>
                  </Link>
                ))}
              </div>
            </div>

            {/* Bottom Support / Login */}
            <div className="pt-4 space-y-2">
              <Link
                href="/products"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-2 text-xs font-semibold !text-slate-700 hover:!text-[#004996] px-3 py-1.5 transition-colors"
              >
                <Phone className="w-3.5 h-3.5 text-[#00A551]" />
                <span className="!text-slate-700">Support: 1800 6821</span>
              </Link>
              <Link
                href="/login"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-[#004996] text-white font-bold text-xs shadow-xs"
              >
                <User className="w-4 h-4" />
                <span>Account Login</span>
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
