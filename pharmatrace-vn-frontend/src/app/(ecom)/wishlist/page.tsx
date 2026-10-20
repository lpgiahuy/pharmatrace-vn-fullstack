'use client';

import React, { useEffect, useState, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Spin, Pagination, Popconfirm, App } from 'antd';
import { Trash2, ShoppingCart } from 'lucide-react';
import { wishlistService, WishlistItem } from '@/services/wishlist.service';
import { useAuth } from '@/store/useAuthStore';
import { useCartStore } from '@/store/useCartStore';
import { formatCurrency, cleanText } from '@/utils';

function WishlistContent() {
  const { message } = App.useApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const addItem = useCartStore((state) => state.addItem);

  const [mounted, setMounted] = useState(false);
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [selectedVariants, setSelectedVariants] = useState<Record<number, number>>({});

  const page = Number(searchParams.get('page')) || 1;
  const sort = (searchParams.get('sort') as 'newest' | 'oldest' | 'price_asc' | 'price_desc') || 'newest';
  const search = searchParams.get('search') || '';

  useEffect(() => {
    setMounted(true);
  }, []);

  const fetchWishlist = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await wishlistService.getWishlist({
        page,
        limit: 10,
        sort,
        search: search.trim() || undefined,
      });
      if (res && res.data) {
        setItems(res.data);
        setTotal(res.pagination?.total || 0);

        // Pre-select base variant or initial variant for each item
        const initialVars: Record<number, number> = {};
        res.data.forEach((it) => {
          if (it.variantId) {
            initialVars[it.id] = it.variantId;
          } else if (it.packagingOptions && it.packagingOptions.length > 0) {
            const base = it.packagingOptions.find((o) => o.isBaseUnit) || it.packagingOptions[0];
            initialVars[it.id] = base.id;
          }
        });
        setSelectedVariants(initialVars);
      }
    } catch {
      message.error('Failed to load wishlist');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, page, sort, search, message]);

  useEffect(() => {
    if (mounted && !authLoading) {
      fetchWishlist();
    }
  }, [mounted, authLoading, fetchWishlist]);

  const updateQueryParams = (key: string, val: string) => {
    const current = new URLSearchParams(Array.from(searchParams.entries()));
    if (val) {
      current.set(key, val);
    } else {
      current.delete(key);
    }
    if (key !== 'page') current.set('page', '1');
    router.push(`/wishlist?${current.toString()}`);
  };

  const handleVariantChange = (productId: number, variantId: number) => {
    setSelectedVariants((prev) => ({
      ...prev,
      [productId]: variantId,
    }));
  };

  const handleAddToCart = (product: WishlistItem) => {
    const activeVariantId = selectedVariants[product.id] || product.variantId || product.packagingOptions?.[0]?.id;
    const activeVariant = product.packagingOptions?.find((v) => v.id === activeVariantId) || {
      id: activeVariantId || product.variantId || undefined,
      unitName: product.unitName || 'Box',
      price: product.price,
      originalPrice: product.originalPrice,
      discountPercent: 0,
    };

    addItem({
      id: `${product.id}-${activeVariant.id || 'base'}`,
      productId: product.id,
      slug: product.slug || String(product.id),
      medicineName: product.medicineName,
      imageUrl: product.imageUrl,
      variantId: activeVariant.id ? Number(activeVariant.id) : undefined,
      unitName: activeVariant.unitName || 'Box',
      price: Number(activeVariant.price),
      originalPrice: activeVariant.originalPrice ? Number(activeVariant.originalPrice) : undefined,
      packagingOptions: product.packagingOptions?.map((p) => ({
        id: p.id,
        unitName: p.unitName,
        price: Number(p.price),
        originalPrice: p.originalPrice ? Number(p.originalPrice) : null,
      })),
    }, 1);

    message.success('Added to cart!');
  };

  const handleRemove = async (productId: number) => {
    setActionLoading(productId);
    try {
      await wishlistService.removeFromWishlist(productId);
      message.success('Item removed from wishlist');
      setItems((prev) => prev.filter((item) => item.id !== productId));
      setTotal((prev) => Math.max(0, prev - 1));
    } catch {
      message.error('Failed to remove item');
    } finally {
      setActionLoading(null);
    }
  };

  if (!mounted || authLoading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <Spin size="large" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-3xl mx-auto py-20 px-4 text-center">
        <h1 className="text-2xl font-bold text-slate-900 mb-3 tracking-tight">My Wishlist</h1>
        <p className="text-slate-500 text-sm max-w-sm mx-auto mb-8 leading-relaxed">
          Please sign in to view and manage your saved items.
        </p>
        <Link
          href="/login?redirect=/wishlist"
          className="inline-block bg-[#004996] hover:bg-[#003875] text-white px-8 py-3 rounded-[6px] text-xs font-bold tracking-widest uppercase transition-colors shadow-xs"
        >
          Sign In
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 font-sans">
      {/* Header */}
      <div className="mb-6 sm:mb-8 flex items-baseline gap-2.5">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight m-0">
          My Wishlist
        </h1>
        {!loading && (
          <span className="text-sm font-medium text-slate-500">
            ({total} {total === 1 ? 'item' : 'items'})
          </span>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="py-24 flex items-center justify-center">
          <Spin size="large" />
        </div>
      ) : items.length === 0 ? (
        <div className="py-20 text-center ">
          <p className="text-slate-500 text-sm mb-6">
            Your wishlist is currently empty.
          </p>
          <Link
            href="/products"
            className="inline-block bg-[#004996] hover:bg-[#003875] text-white px-8 py-3 text-xs font-bold tracking-widest uppercase transition-colors"
          >
            Explore Products
          </Link>
        </div>
      ) : (
        <div>
          {/* Desktop Table View (>= 768px) */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b-2 border-slate-200 text-slate-900 text-sm font-bold uppercase tracking-wider">
                  <th className="py-4 px-3 w-24 font-bold text-slate-900"></th>
                  <th className="py-4 px-4 font-bold text-slate-900">Product Name</th>
                  <th className="py-4 px-4 font-bold text-slate-900">Price</th>
                  <th className="py-4 px-4 font-bold text-slate-900">Status</th>
                  <th className="py-4 px-4 text-right font-bold text-slate-900">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {items.map((product) => {
                  const activeVariantId = selectedVariants[product.id] || product.variantId || product.packagingOptions?.[0]?.id;
                  const activeVariant = product.packagingOptions?.find((v) => v.id === activeVariantId) || {
                    id: activeVariantId || product.variantId || null,
                    unitName: product.unitName || 'Box',
                    price: product.price,
                    originalPrice: product.originalPrice,
                    discountPercent: 0,
                  };

                  const displayPrice = activeVariant.price;
                  const displayOriginalPrice = activeVariant.originalPrice;
                  const hasDiscount = Boolean(displayOriginalPrice && displayOriginalPrice > displayPrice);
                  const stockCount = product.totalStock !== undefined ? product.totalStock : 0;
                  const isAvailable =
                    product.status === 'ACTIVE' &&
                    (product.totalStock ?? 0) > 0;

                  return (
                    <tr key={product.id} className="hover:bg-slate-50/60 transition-colors">
                      {/* Image Column */}
                      <td className="py-5 px-3 align-middle">
                        <Link
                          href={`/products/${product.slug || product.id}`}
                          className="block w-20 h-20 bg-slate-50 border border-slate-200/80 rounded-[6px] p-2 overflow-hidden flex items-center justify-center"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={product.imageUrl || '/favicon.ico'}
                            alt={product.medicineName}
                            className={`max-w-full max-h-full object-contain ${!isAvailable ? 'opacity-50 grayscale' : ''
                              }`}
                            loading="lazy"
                          />
                        </Link>
                      </td>

                      {/* Product Name Column */}
                      <td className="py-5 px-4 align-middle">
                        <Link
                          href={`/products/${product.slug || product.id}`}
                          className="text-sm font-semibold !text-slate-900 hover:!text-[#004996] transition-colors line-clamp-2"
                        >
                          {cleanText(product.medicineName)}
                        </Link>
                        {product.manufacturer && (
                          <div className="text-xs text-slate-400 mt-0.5">
                            {cleanText(product.manufacturer)}
                          </div>
                        )}

                        {/* Variant Dropdown */}
                        {product.packagingOptions && product.packagingOptions.length > 1 ? (
                          <div className="mt-2 flex items-center gap-1.5">
                            <span className="text-xs text-slate-500 font-medium">Packaging:</span>
                            <select
                              value={activeVariantId || ''}
                              onChange={(e) => handleVariantChange(product.id, Number(e.target.value))}
                              className="text-xs font-semibold text-slate-800 bg-slate-50 border border-slate-200 rounded-md py-1 px-2 focus:outline-none focus:ring-1 focus:ring-[#004996] cursor-pointer"
                            >
                              {product.packagingOptions.map((opt) => (
                                <option key={opt.id} value={opt.id}>
                                  {opt.unitName} - {formatCurrency(opt.price)}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div className="mt-1">
                            <span className="inline-block text-[11px] font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                              {activeVariant.unitName || product.unitName || 'Box'}
                            </span>
                          </div>
                        )}
                      </td>

                      {/* Unit Price Column */}
                      <td className="py-5 px-4 align-middle whitespace-nowrap">
                        {hasDiscount && (
                          <span className="text-xs text-slate-400 line-through mr-2 font-normal">
                            {formatCurrency(Number(displayOriginalPrice))}
                          </span>
                        )}
                        <span className="text-sm font-bold text-slate-900">
                          {formatCurrency(displayPrice)}
                        </span>
                      </td>

                      {/* Stock Status Column */}
                      <td className="py-5 px-4 align-middle whitespace-nowrap text-sm text-slate-600">
                        {isAvailable ? (
                          <span className="text-emerald-700 font-semibold text-xs inline-flex items-center gap-1">
                            <span>In Stock</span>
                            <span className="text-slate-500 font-normal">({stockCount})</span>
                          </span>
                        ) : (
                          <span className="text-rose-600 font-semibold text-xs">
                            Out of Stock
                          </span>
                        )}
                      </td>

                      {/* Actions Column */}
                      <td className="py-5 px-4 align-middle text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            disabled={!isAvailable}
                            onClick={() => handleAddToCart(product)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#004996] hover:bg-[#004084] disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-semibold rounded-[6px] transition-colors cursor-pointer disabled:cursor-not-allowed"
                            title={isAvailable ? 'Add to cart' : 'Out of stock'}
                          >
                            <ShoppingCart className="w-3.5 h-3.5" />
                            <span>Add to Cart</span>
                          </button>

                          <Popconfirm
                            title="Remove from wishlist?"
                            description="Are you sure you want to remove this item?"
                            onConfirm={() => handleRemove(product.id)}
                            okText="Remove"
                            cancelText="Cancel"
                            okButtonProps={{ danger: true, size: 'small' }}
                            cancelButtonProps={{ size: 'small' }}
                          >
                            <button
                              type="button"
                              disabled={actionLoading === product.id}
                              className="w-8 h-8 rounded-[6px] border border-slate-200 hover:border-rose-300 text-slate-400 hover:text-rose-600 bg-transparent hover:bg-transparent flex items-center justify-center transition-colors cursor-pointer"
                              title="Remove item"
                              aria-label="Remove item"
                            >
                              <Trash2 className="w-4 h-4 stroke-[1.75]" />
                            </button>
                          </Popconfirm>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Responsive List View (< 768px, no horizontal scroll) */}
          <div className="block md:hidden divide-y divide-slate-200 border-t border-slate-200">
            {items.map((product) => {
              const activeVariantId = selectedVariants[product.id] || product.variantId || product.packagingOptions?.[0]?.id;
              const activeVariant = product.packagingOptions?.find((v) => v.id === activeVariantId) || {
                id: activeVariantId || product.variantId || null,
                unitName: product.unitName || 'Box',
                price: product.price,
                originalPrice: product.originalPrice,
                discountPercent: 0,
              };

              const displayPrice = activeVariant.price;
              const displayOriginalPrice = activeVariant.originalPrice;
              const hasDiscount = Boolean(displayOriginalPrice && displayOriginalPrice > displayPrice);
              const stockCount = product.totalStock !== undefined ? product.totalStock : 0;
              const isAvailable =
                product.status === 'ACTIVE' &&
                (product.totalStock ?? 0) > 0;

              return (
                <div key={product.id} className="py-4 space-y-3">
                  <div className="flex items-start gap-3">
                    {/* Thumbnail */}
                    <Link
                      href={`/products/${product.slug || product.id}`}
                      className="w-20 h-20 shrink-0 bg-slate-50 border border-slate-200/80 rounded-[6px] p-2 overflow-hidden flex items-center justify-center"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={product.imageUrl || '/favicon.ico'}
                        alt={product.medicineName}
                        className={`max-w-full max-h-full object-contain ${!isAvailable ? 'opacity-50 grayscale' : ''
                          }`}
                        loading="lazy"
                      />
                    </Link>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/products/${product.slug || product.id}`}
                        className="text-sm font-semibold !text-slate-900 hover:!text-[#004996] line-clamp-2 leading-snug"
                      >
                        {cleanText(product.medicineName)}
                      </Link>

                      {product.manufacturer && (
                        <div className="text-xs text-slate-400 mt-0.5 truncate">
                          {cleanText(product.manufacturer)}
                        </div>
                      )}

                      {/* Variant Selection on Mobile */}
                      {product.packagingOptions && product.packagingOptions.length > 1 && (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <span className="text-xs text-slate-500 font-medium">Packaging:</span>
                          <select
                            value={activeVariantId || ''}
                            onChange={(e) => handleVariantChange(product.id, Number(e.target.value))}
                            className="text-xs font-semibold text-slate-800 bg-slate-50 border border-slate-200 rounded-md py-1 px-2 focus:outline-none focus:ring-1 focus:ring-[#004996] cursor-pointer"
                          >
                            {product.packagingOptions.map((opt) => (
                              <option key={opt.id} value={opt.id}>
                                {opt.unitName} - {formatCurrency(opt.price)}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* Price */}
                      <div className="mt-1.5 flex items-center gap-2">
                        {hasDiscount && (
                          <span className="text-xs text-slate-400 line-through">
                            {formatCurrency(Number(displayOriginalPrice))}
                          </span>
                        )}
                        <span className="text-sm font-bold text-slate-900">
                          {formatCurrency(displayPrice)}
                        </span>
                      </div>

                      {/* Stock Status */}
                      <div className="mt-1">
                        {isAvailable ? (
                          <span className="text-emerald-700 font-semibold text-xs">
                            In Stock <span className="text-slate-500 font-normal">({stockCount})</span>
                          </span>
                        ) : (
                          <span className="text-rose-600 font-semibold text-xs">Out of Stock</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions (Mobile) */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      disabled={!isAvailable}
                      onClick={() => handleAddToCart(product)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#004996] hover:bg-[#004084] disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-semibold rounded-[6px] transition-colors cursor-pointer disabled:cursor-not-allowed"
                    >
                      <ShoppingCart className="w-3.5 h-3.5" />
                      <span>Add to Cart</span>
                    </button>

                    <Popconfirm
                      title="Remove from wishlist?"
                      description="Are you sure you want to remove this item?"
                      onConfirm={() => handleRemove(product.id)}
                      okText="Remove"
                      cancelText="Cancel"
                      okButtonProps={{ danger: true, size: 'small' }}
                      cancelButtonProps={{ size: 'small' }}
                    >
                      <button
                        type="button"
                        disabled={actionLoading === product.id}
                        className="w-8 h-8 rounded-[6px] border border-slate-200 hover:border-rose-300 text-slate-400 hover:text-rose-600 bg-transparent hover:bg-transparent flex items-center justify-center transition-colors cursor-pointer shrink-0"
                        title="Remove item"
                        aria-label="Remove item"
                      >
                        <Trash2 className="w-4 h-4 stroke-[1.75]" />
                      </button>
                    </Popconfirm>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {total > 10 && (
            <div className="mt-8 flex justify-center sm:justify-end">
              <Pagination
                current={page}
                total={total}
                pageSize={10}
                onChange={(p) => updateQueryParams('page', String(p))}
                showSizeChanger={false}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function WishlistPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[40vh] flex items-center justify-center">
          <Spin size="large" />
        </div>
      }
    >
      <WishlistContent />
    </Suspense>
  );
}
