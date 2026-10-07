'use client';

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Popconfirm } from 'antd';
import {
  Plus,
  Minus,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  ShoppingBag,
  ChevronDown,
  ChevronUp,
  X,
  Check,
  Truck,
} from 'lucide-react';
import { useCartStore, CartItem, CartPackagingOption } from '@/store/useCartStore';
import { productService } from '@/services/product.service';
import { formatCurrency } from '@/utils';

const FREE_SHIPPING_THRESHOLD = 500000;
const STANDARD_SHIPPING_FEE = 30000;

export default function CartPage() {
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  const items = useCartStore((state) => state.items);
  const selectedItemIds = useCartStore((state) => state.selectedItemIds);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const updateItemVariant = useCartStore((state) => state.updateItemVariant);
  const removeItem = useCartStore((state) => state.removeItem);
  const addItem = useCartStore((state) => state.addItem);
  const setSelectedItems = useCartStore((state) => state.setSelectedItems);
  const toggleSelectItem = useCartStore((state) => state.toggleSelectItem);
  const selectAllItems = useCartStore((state) => state.selectAllItems);
  const unselectAllItems = useCartStore((state) => state.unselectAllItems);
  const removeSelectedItems = useCartStore((state) => state.removeSelectedItems);

  // Variant switcher state
  const [productVariantsMap, setProductVariantsMap] = useState<Record<number, CartPackagingOption[]>>({});
  const [openVariantPickerId, setOpenVariantPickerId] = useState<string | null>(null);

  // Mobile bottom summary sheet expansion
  const [isMobileSummaryOpen, setIsMobileSummaryOpen] = useState(false);

  // On first mount, set mounted
  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch packaging options for products in cart if they have multiple variants
  useEffect(() => {
    if (!mounted || items.length === 0) return;

    const productIds = Array.from(new Set(items.map((i) => i.productId)));
    const missingIds = productIds.filter((id) => !productVariantsMap[id]);

    if (missingIds.length === 0) return;

    let isMounted = true;
    Promise.all(
      missingIds.map(async (pid) => {
        try {
          const res = await productService.getProductById(pid);
          const p = res?.data;
          if (p && p.packagingOptions && p.packagingOptions.length > 0) {
            return {
              productId: pid,
              options: p.packagingOptions.map((opt) => ({
                id: opt.id,
                unitName: opt.unitName,
                price: Number(opt.price),
                originalPrice: opt.originalPrice ? Number(opt.originalPrice) : null,
              })),
            };
          }
          return { productId: pid, options: [] };
        } catch {
          return { productId: pid, options: [] };
        }
      })
    ).then((results) => {
      if (!isMounted) return;
      setProductVariantsMap((prev) => {
        const next = { ...prev };
        results.forEach((r) => {
          next[r.productId] = r.options;
        });
        return next;
      });
    });

    return () => {
      isMounted = false;
    };
  }, [mounted, items, productVariantsMap]);

  // Close variant picker when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-variant-picker]')) {
        setOpenVariantPickerId(null);
      }
    };
    if (openVariantPickerId) {
      document.addEventListener('click', handleOutsideClick);
      return () => document.removeEventListener('click', handleOutsideClick);
    }
  }, [openVariantPickerId]);

  // Clean up selectedItemIds when items in cart change: only retain IDs that still exist in items
  useEffect(() => {
    if (items.length > 0 && selectedItemIds.length > 0) {
      const validSelected = selectedItemIds.filter((id) => items.some((item) => item.id === id));
      if (validSelected.length !== selectedItemIds.length) {
        setSelectedItems(validSelected);
      }
    }
  }, [items, selectedItemIds, setSelectedItems]);

  // Selected items for checkout (Shopee style)
  const selectedItems = useMemo(() => {
    return items.filter((item) => selectedItemIds.includes(item.id));
  }, [items, selectedItemIds]);

  const selectedItemsCount = useMemo(() => {
    return selectedItems.reduce((acc, item) => acc + item.quantity, 0);
  }, [selectedItems]);

  const totalItemsCount = useMemo(() => {
    if (!mounted) return 0;
    return items.reduce((acc, item) => acc + item.quantity, 0);
  }, [mounted, items]);

  // Subtotal is calculated ONLY for checked / selected items (Shopee style)
  const subtotal = useMemo(() => {
    if (!mounted) return 0;
    return selectedItems.reduce((acc, item) => acc + Number(item.price || 0) * item.quantity, 0);
  }, [mounted, selectedItems]);

  // Original subtotal (total original price of selected items before discount)
  const originalSubtotal = useMemo(() => {
    if (!mounted) return 0;
    return selectedItems.reduce((acc, item) => {
      const orig = item.originalPrice ? Number(item.originalPrice) : Number(item.price || 0);
      return acc + orig * item.quantity;
    }, 0);
  }, [mounted, selectedItems]);

  // Product discount = total original price - total discounted price
  const productDiscount = useMemo(() => {
    return Math.max(0, originalSubtotal - subtotal);
  }, [originalSubtotal, subtotal]);

  const isFreeShipping = subtotal >= FREE_SHIPPING_THRESHOLD;
  const shippingFee = selectedItems.length === 0 ? 0 : (isFreeShipping ? 0 : STANDARD_SHIPPING_FEE);
  const amountToFreeShipping = Math.max(0, FREE_SHIPPING_THRESHOLD - subtotal);
  const freeShippingPercent = isFreeShipping
    ? 100
    : subtotal === 0
      ? 0
      : Math.min(100, Math.round((subtotal / FREE_SHIPPING_THRESHOLD) * 100));

  const total = useMemo(() => {
    return subtotal + shippingFee;
  }, [subtotal, shippingFee]);

  // Selection helpers 

  const isAllSelected = items.length > 0 && selectedItemIds.length === items.length;
  const isSomeSelected = selectedItemIds.length > 0 && !isAllSelected;

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      unselectAllItems();
    } else {
      selectAllItems();
    }
  };

  const handleToggleSelectItem = (id: string) => {
    toggleSelectItem(id);
  };

  // Quantity direct input state (allows typing e.g. 100 directly)
  const [quantityInputs, setQuantityInputs] = useState<Record<string, string>>({});

  // Handlers
  const handleQuantityChange = (item: CartItem, delta: number) => {
    const newQty = item.quantity + delta;
    if (newQty <= 0) {
      removeItem(item.id);
    } else {
      updateQuantity(item.id, newQty);
    }
    setQuantityInputs((prev) => {
      const copy = { ...prev };
      delete copy[item.id];
      return copy;
    });
  };

  const handleQuantityInputChange = (id: string, rawVal: string) => {
    const cleaned = rawVal.replace(/\D/g, '');
    setQuantityInputs((prev) => ({ ...prev, [id]: cleaned }));

    if (cleaned !== '') {
      const parsed = parseInt(cleaned, 10);
      if (parsed > 0 && parsed <= 9999) {
        updateQuantity(id, parsed);
      }
    }
  };

  const handleQuantityInputBlur = (item: CartItem) => {
    const rawVal = quantityInputs[item.id];
    if (rawVal === undefined) return;

    const parsed = parseInt(rawVal, 10);
    if (!parsed || parsed <= 0) {
      updateQuantity(item.id, 1);
    } else if (parsed > 9999) {
      updateQuantity(item.id, 9999);
    } else {
      updateQuantity(item.id, parsed);
    }

    setQuantityInputs((prev) => {
      const copy = { ...prev };
      delete copy[item.id];
      return copy;
    });
  };

  const handleDeleteSelected = () => {
    if (selectedItemIds.length === 0) return;
    removeSelectedItems();
  };

  const handleProceedToCheckout = () => {
    if (selectedItems.length === 0) return;
    router.push('/checkout');
  };

  if (!mounted) {
    return (
      <div className="py-16 flex items-center justify-center">
        <div className="text-sm font-medium text-[#1f2937]">Loading shopping cart...</div>
      </div>
    );
  }

  return (
    <div className="w-full pb-32 lg:pb-4">
      <div className="w-full">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="mb-4">
          <div className="flex items-center text-sm">
            <Link href="/" className="text-gray-500 hover:text-black transition-colors font-medium">
              Home
            </Link>
            <span className="mx-2 text-gray-400">/</span>
            <span className="text-black font-semibold">Shopping Cart</span>
          </div>
        </nav>

        {/* Page Header */}
        <header className="mb-6 flex flex-row items-center justify-between gap-4 pb-4 border-b border-[#e5e7eb]">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-[#1f2937] tracking-tight">
              Cart ({totalItemsCount})
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/products"
              style={{ color: '#004996' }}
              className="inline-flex items-center gap-1 text-sm font-semibold hover:text-[#004084] hover:underline"
            >
              <ArrowLeft className="w-4 h-4" />
              Continue Shopping
            </Link>
          </div>
        </header>

        {items.length === 0 ? (
          /* Empty State */
          <div className="py-16 text-center max-w-xl mx-auto">
            <div className="w-14 h-14 text-[#004996] flex items-center justify-center mx-auto mb-2">
              <ShoppingBag className="w-10 h-10" />
            </div>
            <h2 className="text-xl font-bold text-[#1f2937] mb-2">
              Your cart is empty
            </h2>
            <p className="text-sm text-[#6b7280] mb-6">
              You haven&apos;t added any medical supplies or prescription products yet.
            </p>
            <Link
              href="/products"
              className="inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-[#004996] hover:bg-[#004084] text-white text-sm font-semibold rounded-[6px] transition-colors"
            >
              Browse Products
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Cart Layout (Desktop: 2fr + 380px, Mobile: 1 col) */}
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-8 items-start">
              {/* Main Content (Left Column) */}
              <div className="space-y-6">
                {/* Cart Items Section  */}
                <section className="bg-[#ffffff] border border-[#e5e7eb] rounded-[6px]">
                  {/* Table Header with Select All Tickbox & Actions */}
                  <div className="px-4 sm:px-5 py-3 border-b border-[#e5e7eb] flex items-center justify-between bg-[#ffffff] rounded-t-[6px]">
                    <div className="flex items-center gap-3">
                      <div className="w-5 flex items-center justify-center shrink-0">
                        <input
                          type="checkbox"
                          id="select-all-header"
                          checked={isAllSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = isSomeSelected;
                          }}
                          onChange={handleToggleSelectAll}
                          className="w-4 h-4 rounded border-[#d1d5db] text-[#004996] focus:ring-[#004996] cursor-pointer"
                        />
                      </div>
                      <label
                        htmlFor="select-all-header"
                        className="text-xs font-bold uppercase tracking-wider text-[#6b7280] cursor-pointer select-none"
                      >
                        PRODUCTS
                      </label>

                      {selectedItemIds.length > 0 && (
                        <Popconfirm
                          title={`Remove ${selectedItemIds.length} item(s)?`}
                          description="Are you sure you want to remove selected items?"
                          onConfirm={handleDeleteSelected}
                          okText="Remove"
                          cancelText="Cancel"
                          okButtonProps={{ danger: true, size: 'small' }}
                          cancelButtonProps={{ size: 'small' }}
                          placement="bottomLeft"
                        >
                          <button
                            type="button"
                            className="ml-3 text-xs font-medium text-[#b91c1c] hover:underline cursor-pointer transition-colors"
                          >
                            Delete ({selectedItemIds.length})
                          </button>
                        </Popconfirm>
                      )}
                    </div>

                    <div className="hidden sm:flex items-center gap-6 text-xs font-bold uppercase tracking-wider text-[#6b7280]">
                      <span className="w-[100px] text-right">Unit Price</span>
                      <span className="w-[104px] text-center">Quantity</span>
                      <span className="w-[110px] text-right">Total</span>
                    </div>
                  </div>

                  {/* Product Rows */}
                  <div className="divide-y divide-[#e5e7eb]">
                    {items.map((item) => {
                      const itemPrice = Number(item.price || 0);
                      const originalPrice = item.originalPrice ? Number(item.originalPrice) : null;
                      const itemTotal = itemPrice * item.quantity;
                      const hasDiscount = originalPrice !== null && originalPrice > itemPrice;
                      const isSelected = selectedItemIds.includes(item.id);

                      const availableVariants = productVariantsMap[item.productId] || item.packagingOptions || [];
                      const hasMultipleVariants = availableVariants.length > 1;
                      const isPickerOpen = openVariantPickerId === item.id;

                      return (
                        <div
                          key={item.id}
                          className={`p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 transition-colors last:rounded-b-[6px] ${isSelected ? 'bg-blue-50/20' : 'bg-[#ffffff]'
                            } ${isPickerOpen ? 'relative z-20' : ''}`}
                        >
                          {/* Row Checkbox & Product Info */}
                          <div className="flex items-start gap-3 flex-1 min-w-0">
                            {/* Tickbox*/}
                            <div className="w-5 h-16 flex items-center justify-center shrink-0">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleSelectItem(item.id)}
                                className="w-4 h-4 rounded border-[#d1d5db] text-[#004996] focus:ring-[#004996] cursor-pointer"
                                aria-label={`Select ${item.medicineName} for checkout`}
                              />
                            </div>

                            <div className="w-16 h-16 rounded-[6px] bg-[#f9fafb] border border-[#e5e7eb] p-1 shrink-0 flex items-center justify-center">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={item.imageUrl || '/placeholder-drug.png'}
                                alt={item.medicineName}
                                className="max-h-full max-w-full object-contain"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = '/placeholder-drug.png';
                                }}
                              />
                            </div>

                            <div className="min-w-0 flex-1">
                              <Link
                                href={item.slug ? `/products/${item.slug}` : `/products/${item.productId}`}
                                className="text-sm font-semibold !text-black hover:!text-[#004996] hover:!underline line-clamp-1"
                              >
                                {item.medicineName}
                              </Link>

                              {/* On Mobile (< sm): Variant Picker / Badge */}
                              <div className="flex sm:hidden items-center mt-1.5">
                                {hasMultipleVariants ? (
                                  <div className="relative inline-block" data-variant-picker>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setOpenVariantPickerId(isPickerOpen ? null : item.id)
                                      }
                                      className="text-xs font-medium text-[#1f2937] hover:text-[#004996] inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#f9fafb] hover:bg-slate-100 border border-[#d1d5db] rounded-[4px] transition-colors cursor-pointer"
                                      title="Click to switch packaging variant"
                                    >
                                      <span>{item.unitName || 'Box'}</span>
                                      <ChevronDown
                                        className={`w-3 h-3 text-slate-500 transition-transform ${isPickerOpen ? 'rotate-180' : ''
                                          }`}
                                      />
                                    </button>

                                    {isPickerOpen && (
                                      <div className="absolute left-0 top-full mt-1.5 z-30 min-w-[200px] bg-white border border-[#e5e7eb] rounded-[6px] shadow-lg py-1">
                                        <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-[#f1f5f9]">
                                          Variant ({availableVariants.length})
                                        </div>
                                        <div className="max-h-48 overflow-y-auto divide-y divide-[#f8fafc]">
                                          {availableVariants.map((v) => {
                                            const isCurrent =
                                              v.id === item.variantId || v.unitName === item.unitName;
                                            return (
                                              <button
                                                key={v.id}
                                                type="button"
                                                onClick={() => {
                                                  updateItemVariant(item.id, v);
                                                  setOpenVariantPickerId(null);
                                                }}
                                                className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between transition-colors hover:bg-blue-50/50 cursor-pointer ${isCurrent
                                                  ? 'bg-blue-50/70 font-semibold text-[#004996]'
                                                  : 'text-slate-800'
                                                  }`}
                                              >
                                                <div>
                                                  <div className="font-medium">{v.unitName}</div>
                                                  <div className="text-[11px] text-[#004996] font-semibold mt-0.5">
                                                    {formatCurrency(v.price)}
                                                  </div>
                                                </div>
                                                {isCurrent && (
                                                  <Check className="w-3.5 h-3.5 text-[#004996] shrink-0" />
                                                )}
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="text-xs font-medium text-[#4b5563] inline-flex items-center px-2 py-0.5 bg-[#f9fafb] border border-[#e5e7eb] rounded-[4px]">
                                    {item.unitName || 'Box'}
                                  </div>
                                )}
                              </div>

                              {/* On Mobile (< sm): Price (Left) + Quantity Selector (Right) */}
                              <div className="flex sm:hidden items-end justify-between gap-3 mt-2.5 pt-2 border-t border-[#f3f4f6]">
                                {/* Price (Discounted + Strikethrough Original) */}
                                <div className="flex flex-col">
                                  <span className="text-sm font-bold text-[#004996]">
                                    {formatCurrency(item.price)}
                                  </span>
                                  {hasDiscount && (
                                    <span className="text-xs text-[#6b7280] line-through">
                                      {formatCurrency(item.originalPrice)}
                                    </span>
                                  )}
                                </div>

                                {/* Quantity Selector on Mobile */}
                                <div className="flex items-center bg-[#ffffff] border border-[#d1d5db] rounded-[6px] overflow-hidden shrink-0">
                                  {item.quantity === 1 ? (
                                    <Popconfirm
                                      title="Remove from cart?"
                                      description="Are you sure you want to remove this item?"
                                      onConfirm={() => removeItem(item.id)}
                                      okText="Remove"
                                      cancelText="Cancel"
                                      okButtonProps={{ danger: true, size: 'small' }}
                                      cancelButtonProps={{ size: 'small' }}
                                      placement="top"
                                    >
                                      <button
                                        type="button"
                                        className="w-7 h-7 flex items-center justify-center text-[#4b5563] hover:text-[#1f2937] hover:bg-[#f9fafb] transition-colors cursor-pointer"
                                        aria-label="Decrease quantity"
                                        title="Decrease quantity"
                                      >
                                        <Minus className="w-3 h-3" />
                                      </button>
                                    </Popconfirm>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleQuantityChange(item, -1)}
                                      className="w-7 h-7 flex items-center justify-center text-[#4b5563] hover:text-[#1f2937] hover:bg-[#f9fafb] transition-colors cursor-pointer"
                                      aria-label="Decrease quantity"
                                      title="Decrease quantity"
                                    >
                                      <Minus className="w-3 h-3" />
                                    </button>
                                  )}
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    value={
                                      quantityInputs[item.id] !== undefined
                                        ? quantityInputs[item.id]
                                        : item.quantity
                                    }
                                    onChange={(e) => handleQuantityInputChange(item.id, e.target.value)}
                                    onBlur={() => handleQuantityInputBlur(item)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        (e.target as HTMLInputElement).blur();
                                      }
                                    }}
                                    className="w-9 h-7 text-center text-xs font-medium text-[#1f2937] focus:outline-hidden focus:bg-blue-50/20"
                                    aria-label={`Quantity for ${item.medicineName}`}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleQuantityChange(item, 1)}
                                    className="w-7 h-7 flex items-center justify-center text-[#4b5563] hover:text-[#1f2937] hover:bg-[#f9fafb] transition-colors cursor-pointer"
                                    aria-label="Increase quantity"
                                  >
                                    <Plus className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>

                              {/* On Desktop (>= sm): Variant Picker */}
                              <div className="hidden sm:block">
                                {hasMultipleVariants ? (
                                  <div className="relative mt-1 inline-block" data-variant-picker>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setOpenVariantPickerId(isPickerOpen ? null : item.id)
                                      }
                                      className="text-xs font-medium text-[#1f2937] hover:text-[#004996] inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-[#f9fafb] hover:bg-slate-100 border border-[#d1d5db] rounded-[4px] transition-colors cursor-pointer"
                                      title="Click to switch packaging variant"
                                    >
                                      <span>{item.unitName || 'Box'}</span>
                                      <ChevronDown
                                        className={`w-3 h-3 text-slate-500 transition-transform ${isPickerOpen ? 'rotate-180' : ''
                                          }`}
                                      />
                                    </button>

                                    {isPickerOpen && (
                                      <div className="absolute left-0 top-full mt-1.5 z-30 min-w-[210px] bg-white border border-[#e5e7eb] rounded-[6px] shadow-lg py-1">
                                        <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-[#f1f5f9]">
                                          Variant ({availableVariants.length})
                                        </div>
                                        <div className="max-h-48 overflow-y-auto divide-y divide-[#f8fafc]">
                                          {availableVariants.map((v) => {
                                            const isCurrent =
                                              v.id === item.variantId || v.unitName === item.unitName;
                                            return (
                                              <button
                                                key={v.id}
                                                type="button"
                                                onClick={() => {
                                                  updateItemVariant(item.id, v);
                                                  setOpenVariantPickerId(null);
                                                }}
                                                className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between transition-colors hover:bg-blue-50/50 cursor-pointer ${isCurrent
                                                  ? 'bg-blue-50/70 font-semibold text-[#004996]'
                                                  : 'text-slate-800'
                                                  }`}
                                              >
                                                <div>
                                                  <div className="font-medium">{v.unitName}</div>
                                                  <div className="text-[11px] text-[#004996] font-semibold mt-0.5">
                                                    {formatCurrency(v.price)}
                                                  </div>
                                                </div>
                                                {isCurrent && (
                                                  <Check className="w-3.5 h-3.5 text-[#004996] shrink-0" />
                                                )}
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="text-xs font-medium text-[#4b5563] mt-1 inline-flex items-center px-2 py-0.5 bg-[#f9fafb] border border-[#e5e7eb] rounded-[4px]">
                                    {item.unitName || 'Box'}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Controls & Pricing on Desktop (>= sm) */}
                          <div className="hidden sm:flex items-center gap-6 shrink-0">
                            {/* Unit Price (Vietnamese Dong) */}
                            <div className="text-right w-[100px] shrink-0">
                              <div className="text-sm font-semibold text-[#004996]">
                                {formatCurrency(item.price)}
                              </div>
                              {hasDiscount && (
                                <div className="text-xs text-[#6b7280] line-through">
                                  {formatCurrency(item.originalPrice)}
                                </div>
                              )}
                            </div>

                            {/* Quantity Selector: White background, #d1d5db border, 8px radius */}
                            <div className="w-[104px] shrink-0 flex justify-center">
                              <div className="flex items-center bg-[#ffffff] border border-[#d1d5db] rounded-[8px] overflow-hidden">
                                {item.quantity === 1 ? (
                                  <Popconfirm
                                    title="Remove from cart?"
                                    description="Are you sure you want to remove this item?"
                                    onConfirm={() => removeItem(item.id)}
                                    okText="Remove"
                                    cancelText="Cancel"
                                    okButtonProps={{ danger: true, size: 'small' }}
                                    cancelButtonProps={{ size: 'small' }}
                                    placement="top"
                                  >
                                    <button
                                      type="button"
                                      className="w-8 h-8 flex items-center justify-center text-[#4b5563] hover:text-[#1f2937] hover:bg-[#f9fafb] transition-colors cursor-pointer"
                                      aria-label="Decrease quantity"
                                      title="Decrease quantity"
                                    >
                                      <Minus className="w-3.5 h-3.5" />
                                    </button>
                                  </Popconfirm>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleQuantityChange(item, -1)}
                                    className="w-8 h-8 flex items-center justify-center text-[#4b5563] hover:text-[#1f2937] hover:bg-[#f9fafb] transition-colors cursor-pointer"
                                    aria-label="Decrease quantity"
                                    title="Decrease quantity"
                                  >
                                    <Minus className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  value={
                                    quantityInputs[item.id] !== undefined
                                      ? quantityInputs[item.id]
                                      : item.quantity
                                  }
                                  onChange={(e) => handleQuantityInputChange(item.id, e.target.value)}
                                  onBlur={() => handleQuantityInputBlur(item)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      (e.target as HTMLInputElement).blur();
                                    }
                                  }}
                                  className="w-10 h-8 text-center text-sm font-medium text-[#1f2937] focus:outline-hidden focus:bg-blue-50/20 selection:bg-blue-200"
                                  aria-label={`Quantity for ${item.medicineName}`}
                                />
                                <button
                                  type="button"
                                  onClick={() => handleQuantityChange(item, 1)}
                                  className="w-8 h-8 flex items-center justify-center text-[#4b5563] hover:text-[#1f2937] hover:bg-[#f9fafb] transition-colors cursor-pointer"
                                  aria-label="Increase quantity"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            {/* Line Total (Vietnamese Dong) */}
                            <div className="text-right w-[110px] shrink-0">
                              <div className="text-sm font-semibold text-[#004996]">
                                {formatCurrency(itemTotal)}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>

              {/* Sidebar (Right Column) - Hidden on Mobile (<lg), Sticky on Desktop (>=lg) */}
              <div className="hidden lg:block space-y-5 lg:sticky lg:top-[112px] self-start">
                {/* Order Summary (Calculated from selected items) */}
                <aside className="bg-[#ffffff] border border-[#e5e7eb] rounded-[6px] p-5">
                  <h2 className="text-base font-semibold text-[#1f2937] mb-4 pb-3 border-b border-[#e5e7eb]">
                    Order Summary
                  </h2>

                  {/* Free Shipping Status */}
                  <div className="mb-4">
                    {selectedItems.length === 0 ? (
                      <div className="bg-[#f0f7ff] text-[#004996] text-xs p-2.5 rounded-[6px] flex items-center gap-2 border border-blue-100">
                        <Truck className="w-4 h-4 shrink-0 text-[#004996]" />
                        <span>Free shipping on orders from <strong>{formatCurrency(FREE_SHIPPING_THRESHOLD)}</strong></span>
                      </div>
                    ) : isFreeShipping ? (
                      <div className="bg-emerald-50 text-emerald-700 text-xs p-2.5 rounded-[6px] flex items-center gap-2 border border-emerald-200">
                        <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                        <span>You qualify for <strong>FREE shipping</strong>!</span>
                      </div>
                    ) : (
                      <div className="bg-slate-50 border border-slate-200/80 p-3 rounded-[6px] space-y-2">
                        <div className="flex items-center justify-between text-xs text-slate-700">
                          <span>Add <strong className="text-[#004996]">{formatCurrency(amountToFreeShipping)}</strong> for Free Ship</span>
                          <span className="font-semibold text-slate-600">{freeShippingPercent}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#004996] transition-all duration-300 rounded-full"
                            style={{ width: `${freeShippingPercent}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between items-center text-[#4b5563]">
                      <span>
                        Subtotal ({selectedItems.length} selected item{selectedItems.length !== 1 ? 's' : ''})
                      </span>
                      <span className="font-medium text-[#1f2937]">
                        {formatCurrency(originalSubtotal > subtotal ? originalSubtotal : subtotal)}
                      </span>
                    </div>

                    {productDiscount > 0 && (
                      <div className="flex justify-between items-center text-[#4b5563]">
                        <span>Product Discount</span>
                        <span className="font-semibold text-[#15803d]">
                          -{formatCurrency(productDiscount)}
                        </span>
                      </div>
                    )}

                    <div className="flex justify-between items-center text-[#4b5563]">
                      <span>Shipping</span>
                      <span className="font-medium text-[#1f2937]">
                        {selectedItems.length === 0
                          ? formatCurrency(0)
                          : shippingFee === 0
                            ? (
                              <span className="text-[#15803d] font-semibold">FREE</span>
                            ) : (
                              formatCurrency(shippingFee)
                            )}
                      </span>
                    </div>

                    <div className="border-t border-[#e5e7eb] pt-3 mt-3">
                      <div className="flex justify-between items-baseline">
                        <span className="text-base font-semibold text-[#1f2937]">
                          Total
                        </span>
                        <span className="text-xl font-bold text-[#004996]">
                          {formatCurrency(total)}
                        </span>
                      </div>
                      <div className="text-right text-xs text-[#6b7280] mt-1">
                        VAT included where applicable
                      </div>
                    </div>
                  </div>

                  {/* Primary Checkout Button (Shopee style: disabled if 0 items selected) */}
                  <button
                    type="button"
                    disabled={selectedItems.length === 0}
                    onClick={handleProceedToCheckout}
                    className="w-full mt-5 h-11 bg-[#004996] hover:bg-[#004084] disabled:bg-[#d1d5db] disabled:text-[#6b7280] disabled:cursor-not-allowed text-white font-semibold text-sm rounded-[6px] transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-none"
                  >
                    <span>
                      {selectedItems.length === 0
                        ? 'Select items to checkout'
                        : `Proceed to Checkout (${selectedItems.length})`}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </aside>
              </div>
            </div>

            {/* Mobile & Tablet Bottom Sticky Checkout Bar (< lg) */}
            {/* Backdrop overlay when sheet is expanded */}
            {isMobileSummaryOpen && (
              <div
                className="lg:hidden fixed inset-0 bg-black/40 z-30 transition-opacity backdrop-blur-[1px]"
                onClick={() => setIsMobileSummaryOpen(false)}
                aria-hidden="true"
              />
            )}

            <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-[#e5e7eb] shadow-[0_-4px_24px_rgba(0,0,0,0.12)]">
              <div className="max-w-[1280px] mx-auto px-4 py-3 space-y-2.5">
                {/* Expanded Breakdown & Free Shipping bar */}
                {isMobileSummaryOpen && (
                  <div className="space-y-3 pb-3 border-b border-[#e5e7eb] animate-in fade-in slide-in-from-bottom-2 duration-200">
                    {/* Free Shipping Status */}
                    <div>
                      {selectedItems.length === 0 ? (
                        <div className="bg-[#f0f7ff] text-[#004996] text-xs p-2.5 rounded-[6px] flex items-center gap-2 border border-blue-100">
                          <Truck className="w-4 h-4 shrink-0 text-[#004996]" />
                          <span>Free shipping on orders from <strong>{formatCurrency(FREE_SHIPPING_THRESHOLD)}</strong></span>
                        </div>
                      ) : isFreeShipping ? (
                        <div className="bg-emerald-50 text-emerald-700 text-xs p-2.5 rounded-[6px] flex items-center gap-2 border border-emerald-200">
                          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                          <span>You qualify for <strong>FREE shipping</strong>!</span>
                        </div>
                      ) : (
                        <div className="bg-slate-50 border border-slate-200/80 p-3 rounded-[6px] space-y-2">
                          <div className="flex items-center justify-between text-xs text-slate-700">
                            <span>Add <strong className="text-[#004996]">{formatCurrency(amountToFreeShipping)}</strong> for Free Ship</span>
                            <span className="font-semibold text-slate-600">{freeShippingPercent}%</span>
                          </div>
                          <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#004996] transition-all duration-300 rounded-full"
                              style={{ width: `${freeShippingPercent}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Price Breakdown */}
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between items-center text-[#4b5563]">
                        <span>Subtotal ({selectedItems.length} selected item{selectedItems.length !== 1 ? 's' : ''})</span>
                        <span className="font-medium text-[#1f2937]">
                          {formatCurrency(originalSubtotal > subtotal ? originalSubtotal : subtotal)}
                        </span>
                      </div>

                      {productDiscount > 0 && (
                        <div className="flex justify-between items-center text-[#4b5563]">
                          <span>Product Discount</span>
                          <span className="font-semibold text-[#15803d]">
                            -{formatCurrency(productDiscount)}
                          </span>
                        </div>
                      )}

                      <div className="flex justify-between items-center text-[#4b5563]">
                        <span>Shipping</span>
                        <span className="font-medium text-[#1f2937]">
                          {selectedItems.length === 0
                            ? formatCurrency(0)
                            : shippingFee === 0
                              ? <span className="text-[#15803d] font-semibold">FREE</span>
                              : formatCurrency(shippingFee)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Total Row */}
                <button
                  type="button"
                  onClick={() => setIsMobileSummaryOpen((prev) => !prev)}
                  className="w-full flex items-center justify-between py-1 text-left cursor-pointer group bg-transparent border-0 p-0 select-none"
                  aria-expanded={isMobileSummaryOpen}
                  aria-label="Toggle order summary"
                >
                  <span className="text-base font-semibold text-[#1f2937]">
                    Total
                  </span>

                  <div className="flex items-center gap-1.5">
                    <span className="text-xl font-bold text-[#004996]">
                      {formatCurrency(total)}
                    </span>
                    {isMobileSummaryOpen ? (
                      <ChevronUp className="w-5 h-5 text-[#004996] stroke-[2.5] transition-transform" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-slate-600 group-hover:text-[#004996] stroke-[2.5] transition-transform" />
                    )}
                  </div>
                </button>

                {isMobileSummaryOpen && (
                  <div className="text-right text-xs text-[#6b7280] -mt-1 pb-0.5">
                    VAT included where applicable
                  </div>
                )}

                {/* Checkout Button (Full width) */}
                <button
                  type="button"
                  disabled={selectedItems.length === 0}
                  onClick={handleProceedToCheckout}
                  className="w-full h-11 bg-[#004996] hover:bg-[#004084] disabled:bg-[#d1d5db] disabled:text-[#6b7280] disabled:cursor-not-allowed text-white font-semibold text-sm rounded-[6px] transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-none"
                >
                  <span>
                    {selectedItems.length === 0
                      ? 'Select items to checkout'
                      : `Proceed to Checkout (${selectedItems.length})`}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
