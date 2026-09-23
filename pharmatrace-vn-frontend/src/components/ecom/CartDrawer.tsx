'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  X,
  Plus,
  Minus,
  Trash2,
  ShoppingBag,
  ArrowRight,
} from 'lucide-react';
import { useCartStore } from '@/store/useCartStore';
import { formatCurrency, cleanText, cn } from '@/utils';

export const CartDrawer: React.FC = () => {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  const items = useCartStore((state) => state.items);
  const isDrawerOpen = useCartStore((state) => state.isDrawerOpen);
  const setDrawerOpen = useCartStore((state) => state.setDrawerOpen);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const removeItem = useCartStore((state) => state.removeItem);
  const getTotalItems = useCartStore((state) => state.getTotalItems);
  const getSubtotal = useCartStore((state) => state.getSubtotal);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleClose = useCallback(() => {
    setDrawerOpen(false);
  }, [setDrawerOpen]);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isDrawerOpen) {
        handleClose();
      }
    };
    if (isDrawerOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isDrawerOpen, handleClose]);

  if (!mounted) return null;

  const totalItems = getTotalItems();
  const subtotal = getSubtotal();

  const handleNavigate = (path: string) => {
    setDrawerOpen(false);
    router.push(path);
  };

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 transition-all duration-300',
        isDrawerOpen
          ? 'visible opacity-100 pointer-events-auto'
          : 'invisible opacity-0 pointer-events-none delay-200',
      )}
      aria-modal="true"
      role="dialog"
    >
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] transition-opacity duration-300',
          isDrawerOpen ? 'opacity-100' : 'opacity-0',
        )}
        onClick={handleClose}
      />

      {/* Slide-over Panel */}
      <div
        className={cn(
          'fixed inset-y-0 right-0 w-full max-w-[420px] bg-white shadow-2xl flex flex-col z-10 font-sans transition-transform duration-300 ease-in-out',
          isDrawerOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/80 shrink-0">
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-[#004996]" />
            <h2 className="text-base font-bold text-slate-900 m-0">
              Shopping Cart
            </h2>
            <span className="text-xs font-semibold text-slate-500 bg-slate-200/80 px-2 py-0.5 rounded-full">
              {totalItems}
            </span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 rounded-lg transition-colors cursor-pointer"
            aria-label="Close cart drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-12">
              <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-4">
                <ShoppingBag className="w-7 h-7" />
              </div>
              <h3 className="text-base font-bold text-slate-800 mb-1">
                Your cart is empty
              </h3>
              <p className="text-sm text-slate-500 max-w-[240px] mb-6">
                Explore our certified pharmaceutical catalog to add medications.
              </p>
              <button
                type="button"
                onClick={() => handleNavigate('/products')}
                className="px-5 py-2.5 bg-[#004996] hover:bg-[#003875] text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer shadow-xs"
              >
                Browse Products
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {items.map((item) => {
                const itemTotal = item.price * item.quantity;
                return (
                  <div
                    key={item.id}
                    className="flex gap-3 pb-4 border-b border-slate-100 last:border-0"
                  >
                    {/* Thumbnail */}
                    <div className="w-16 h-16 rounded-lg bg-slate-50 border border-slate-200 p-1 shrink-0 flex items-center justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.imageUrl || '/placeholder-drug.png'}
                        alt={item.medicineName}
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/products/${item.slug || item.productId}`}
                        onClick={handleClose}
                        className="text-sm font-bold text-slate-900 hover:text-[#004996] transition-colors line-clamp-2 leading-snug m-0"
                      >
                        {cleanText(item.medicineName)}
                      </Link>

                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                          {item.unitName}
                        </span>
                        <span className="text-xs font-bold text-slate-700">
                          {formatCurrency(item.price)}
                        </span>
                      </div>

                      {/* Controls row */}
                      <div className="flex items-center justify-between mt-2.5">
                        <div className="inline-flex items-center border border-slate-200 rounded-md bg-white">
                          <button
                            type="button"
                            onClick={() => updateQuantity(item.id, item.quantity - 1)}
                            className="p-1 text-slate-500 hover:bg-slate-100 transition-colors rounded-l-md cursor-pointer"
                            aria-label="Decrease quantity"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="px-2 text-xs font-bold text-slate-800 min-w-[24px] text-center">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateQuantity(item.id, item.quantity + 1)}
                            className="p-1 text-slate-500 hover:bg-slate-100 transition-colors rounded-r-md cursor-pointer"
                            aria-label="Increase quantity"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="flex items-center gap-3">
                          <span className="text-sm font-bold text-[#004996]">
                            {formatCurrency(itemTotal)}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeItem(item.id)}
                            className="text-slate-400 hover:text-rose-600 p-1 transition-colors cursor-pointer"
                            aria-label="Remove item"
                            title="Remove item"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="p-5 border-t border-slate-100 bg-slate-50/60 space-y-3 shrink-0">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-slate-600">Subtotal:</span>
              <span className="text-lg font-bold text-[#004996]">
                {formatCurrency(subtotal)}
              </span>
            </div>
            <p className="text-xs text-slate-400 m-0">
              Vouchers and shipping calculated on the cart page.
            </p>

            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={() => handleNavigate('/cart')}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#004996] hover:bg-[#003875] text-white text-sm font-bold rounded-lg transition-colors cursor-pointer shadow-xs"
              >
                <span>View Full Cart</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="w-full py-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                Continue Shopping
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
