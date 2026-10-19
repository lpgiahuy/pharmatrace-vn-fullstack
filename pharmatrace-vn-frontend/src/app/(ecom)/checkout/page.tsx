'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ShieldCheck,
  Truck,
  CreditCard,
  Banknote,
  CheckCircle2,
  ChevronRight,
  ArrowLeft,
  Tag,
  AlertCircle,
  Clock,
  MapPin,
  Phone,
  User,
  FileText,
  Loader2,
  Gift,
} from 'lucide-react';
import { App, Spin } from 'antd';
import dynamic from 'next/dynamic';
import type { SelectedLocationResult } from '@/components/shared/MapAddressPickerModal';

const MapAddressPickerModal = dynamic(
  () => import('@/components/shared/MapAddressPickerModal'),
  { ssr: false }
);
import { useCartStore } from '@/store/useCartStore';
import { useAuth } from '@/store/useAuthStore';
import { orderService, PaymentMethod } from '@/services/order.service';
import { voucherService } from '@/services/voucher.service';
import { formatCurrency } from '@/utils';

export default function CheckoutPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const { user, isAuthenticated, isLoading: authLoading, fetchProfile } = useAuth();

  const [mounted, setMounted] = useState(false);
  const items = useCartStore((s) => s.items);
  const selectedItemIds = useCartStore((s) => s.selectedItemIds);
  const appliedVoucher = useCartStore((s) => s.appliedVoucher);
  const applyVoucherStore = useCartStore((s) => s.applyVoucher);
  const removeVoucherStore = useCartStore((s) => s.removeVoucher);
  const removeSelectedItems = useCartStore((s) => s.removeSelectedItems);

  // Form State
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [note, setNote] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('COD');
  const [isMapModalOpen, setIsMapModalOpen] = useState(false);
  const [deliveryCoords, setDeliveryCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  // Voucher state
  const [voucherInput, setVoucherInput] = useState('');
  const [voucherLoading, setVoucherLoading] = useState(false);
  const [voucherError, setVoucherError] = useState<string | null>(null);

  // Points redemption
  const [useLoyaltyPoints, setUseLoyaltyPoints] = useState(false);
  const [pointsInput, setPointsInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Fresh user profile fetch on mount to ensure real-time reward points
  useEffect(() => {
    if (isAuthenticated) {
      fetchProfile();
    }
  }, [isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-fill user profile
  useEffect(() => {
    if (user) {
      if (!recipientName && (user.fullName || user.name)) {
        setRecipientName(user.fullName || user.name || '');
      }
      if (!recipientPhone && user.phone) {
        setRecipientPhone(user.phone || '');
      }
    }
  }, [user]);

  // Selected items from cart
  const selectedItems = useMemo(() => {
    return items.filter((item) => selectedItemIds.includes(item.id));
  }, [items, selectedItemIds]);

  // Financial calculations
  const subtotal = useMemo(() => {
    return selectedItems.reduce((acc, item) => acc + item.price * item.quantity, 0);
  }, [selectedItems]);

  const FREE_SHIPPING_THRESHOLD = 500000;
  const STANDARD_SHIPPING_FEE = 30000;
  const shippingFee = subtotal >= FREE_SHIPPING_THRESHOLD || subtotal === 0 ? 0 : STANDARD_SHIPPING_FEE;

  // Voucher discount calculation
  const voucherDiscount = useMemo(() => {
    if (!appliedVoucher || subtotal < (appliedVoucher.minOrderValue || 0)) {
      return 0;
    }
    if (appliedVoucher.discountType === 'PERCENT') {
      let disc = (subtotal * appliedVoucher.discountValue) / 100;
      if (appliedVoucher.maxDiscountAmount && disc > appliedVoucher.maxDiscountAmount) {
        disc = appliedVoucher.maxDiscountAmount;
      }
      return Math.round(disc);
    }
    return Math.min(appliedVoucher.discountValue, subtotal);
  }, [appliedVoucher, subtotal]);

  // Loyalty points (1 point = 1 VND; max 20% of subtotal)
  const availablePoints = user?.rewardPoints || 0;
  const maxRedeemablePoints = Math.min(
    availablePoints,
    Math.floor(subtotal * 0.2)
  );

  const effectivePointsToUse = useMemo(() => {
    if (!useLoyaltyPoints) return 0;
    const parsed = parseInt(pointsInput, 10);
    if (isNaN(parsed) || parsed <= 0) return 0;
    return Math.min(parsed, maxRedeemablePoints);
  }, [useLoyaltyPoints, pointsInput, maxRedeemablePoints]);

  const pointsDiscount = effectivePointsToUse;

  const totalAmount = Math.max(0, subtotal + shippingFee - voucherDiscount - pointsDiscount);

  // Loyalty points handlers
  const handleToggleLoyaltyPoints = (checked: boolean) => {
    setUseLoyaltyPoints(checked);
    if (checked && (!pointsInput || parseInt(pointsInput, 10) <= 0)) {
      setPointsInput(String(maxRedeemablePoints));
    }
  };

  const handleSetMaxPoints = () => {
    setPointsInput(String(maxRedeemablePoints));
  };

  const handlePointsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '');
    if (raw === '') {
      setPointsInput('');
      return;
    }
    const val = parseInt(raw, 10);
    if (val > maxRedeemablePoints) {
      setPointsInput(String(maxRedeemablePoints));
    } else {
      setPointsInput(String(val));
    }
  };

  // Apply voucher handler
  const handleApplyVoucher = async () => {
    const code = voucherInput.trim().toUpperCase();
    if (!code) return;

    setVoucherLoading(true);
    setVoucherError(null);
    try {
      const res = await voucherService.validateVoucher(code, subtotal);
      if (res?.data?.valid) {
        applyVoucherStore({
          voucherId: res.data.voucherId,
          voucherCode: res.data.voucherCode,
          discountType: res.data.discountType,
          discountValue: res.data.discountValue,
          discountAmount: res.data.discountAmount,
          minOrderValue: res.data.minOrderValue,
          maxDiscountAmount: res.data.maxDiscountAmount,
        });
        message.success(`Voucher ${code} applied successfully.`);
        setVoucherInput('');
      } else {
        setVoucherError(res?.message || 'Invalid voucher code for this order.');
      }
    } catch (err: any) {
      setVoucherError(err?.message || 'Unable to apply voucher. Please check code or order total.');
    } finally {
      setVoucherLoading(false);
    }
  };

  // Submit order handler
  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isAuthenticated) {
      message.warning('Please log in to complete your order.');
      router.push('/login?redirect=/checkout');
      return;
    }

    if (!recipientName.trim()) {
      message.error('Recipient name is required.');
      return;
    }
    if (!recipientPhone.trim() || recipientPhone.trim().length < 9) {
      message.error('A valid phone number is required.');
      return;
    }
    if (!shippingAddress.trim() || shippingAddress.trim().length < 6) {
      message.error('A detailed shipping address is required.');
      return;
    }
    if (selectedItems.length === 0) {
      message.error('No items selected for checkout.');
      router.push('/cart');
      return;
    }

    // Prepare items payload
    const orderItems = selectedItems
      .filter((i) => i.variantId)
      .map((i) => ({
        variantId: Number(i.variantId),
        quantity: i.quantity,
      }));

    if (orderItems.length === 0) {
      message.error('Selected items must have a valid packaging unit.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await orderService.createOrder({
        shippingAddress: shippingAddress.trim(),
        latitude: deliveryCoords?.latitude,
        longitude: deliveryCoords?.longitude,
        recipientName: recipientName.trim(),
        recipientPhone: recipientPhone.trim(),
        paymentMethod,
        voucherCode: appliedVoucher?.voucherCode || undefined,
        usedPoints: useLoyaltyPoints && effectivePointsToUse > 0 ? effectivePointsToUse : undefined,
        note: note.trim() || undefined,
        items: orderItems,
      });

      if (res?.success && res?.data) {
        message.success('Order placed successfully.');
        removeSelectedItems();
        router.push(`/account/orders?success=true&orderCode=${res.data.orderCode}`);
      } else {
        message.error(res?.message || 'Failed to place order. Please try again.');
      }
    } catch (err: any) {
      console.error('Checkout error:', err);
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        (typeof err === 'string' ? err : null) ||
        'Failed to place order. Please try again.';
      message.error(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (!mounted || authLoading) {
    return (
      <div className="min-h-screen bg-[#f7f8fa] flex items-center justify-center">
        <Spin size="large" />
      </div>
    );
  }

  // Not authenticated banner
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#f7f8fa] py-16 px-4">
        <div className="max-w-md mx-auto bg-white rounded-lg p-6 border border-gray-200 shadow-xs text-center">
          <div className="w-12 h-12 rounded-full bg-blue-50 text-[#004996] flex items-center justify-center mx-auto mb-4">
            <User className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Sign In Required</h2>
          <p className="text-gray-600 text-sm mb-6 leading-relaxed">
            Please log in with your account to complete your purchase and track deliveries.
          </p>
          <div className="space-y-2.5">
            <Link
              href="/login?redirect=/checkout"
              className="block w-full py-2.5 px-4 bg-[#004996] hover:bg-[#004084] text-white text-sm font-medium rounded-md transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/cart"
              className="block w-full py-2.5 px-4 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 text-sm font-medium rounded-md transition-colors"
            >
              Return to Cart
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Empty checkout guard
  if (selectedItems.length === 0) {
    return (
      <div className="min-h-screen bg-[#f7f8fa] py-16 px-4">
        <div className="max-w-md mx-auto bg-white rounded-lg p-6 border border-gray-200 shadow-xs text-center">
          <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-700 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">No Items Selected</h2>
          <p className="text-gray-600 text-sm mb-6 leading-relaxed">
            You do not have any items selected for checkout. Please return to your cart and choose the products you wish to purchase.
          </p>
          <Link
            href="/cart"
            className="inline-flex items-center gap-2 py-2.5 px-5 bg-[#004996] hover:bg-[#004084] text-white text-sm font-medium rounded-md transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Return to Cart
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f8fa] pb-16 pt-4 sm:pt-6">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Breadcrumb Navigation */}
        <nav className="flex items-center gap-2 text-xs sm:text-sm text-gray-500 mb-5">
          <Link href="/" className="hover:text-[#004996] transition-colors">
            Home
          </Link>
          <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
          <Link href="/cart" className="hover:text-[#004996] transition-colors">
            Shopping Cart
          </Link>
          <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
          <span className="font-medium text-gray-900">Checkout</span>
        </nav>

        {/* Page Title */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            Checkout
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Enter your shipping details and select a payment method to complete your order.
          </p>
        </div>

        <form onSubmit={handleSubmitOrder}>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* LEFT COLUMN: Shipping details + Payment + Items review (7 cols on lg) */}
            <div className="lg:col-span-7 space-y-6">
              {/* Section 1: Shipping Address Card */}
              <div className="bg-white rounded-lg border border-gray-200 p-5 sm:p-6 shadow-xs">
                <div className="pb-3 mb-4 border-b border-gray-200 flex items-center justify-between">
                  <h2 className="text-base font-semibold text-gray-900">
                    1. Shipping Information
                  </h2>
                  <span className="text-xs text-gray-500">Required (*)</span>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Recipient Name */}
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Recipient Full Name <span className="text-red-600">*</span>
                      </label>
                      <div className="relative">
                        <User className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          required
                          value={recipientName}
                          onChange={(e) => setRecipientName(e.target.value)}
                          placeholder="e.g. Nguyen Van A"
                          className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-gray-300 focus:border-[#004996] focus:ring-1 focus:ring-[#004996] outline-none transition-colors"
                        />
                      </div>
                    </div>

                    {/* Phone Number */}
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Phone Number <span className="text-red-600">*</span>
                      </label>
                      <div className="relative">
                        <Phone className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="tel"
                          required
                          value={recipientPhone}
                          onChange={(e) => setRecipientPhone(e.target.value)}
                          placeholder="e.g. 0901234567"
                          className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-gray-300 focus:border-[#004996] focus:ring-1 focus:ring-[#004996] outline-none transition-colors"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Shipping Address */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-medium text-gray-700">
                        Full Shipping Address <span className="text-red-600">*</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => setIsMapModalOpen(true)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[#004996] hover:text-[#003772] hover:underline transition-colors"
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        Select on Map
                      </button>
                    </div>
                    <div className="relative">
                      <MapPin className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
                      <textarea
                        required
                        rows={3}
                        value={shippingAddress}
                        onChange={(e) => {
                          setShippingAddress(e.target.value);
                          // Clear pinned coordinates if user edits text manually
                          setDeliveryCoords(null);
                        }}
                        placeholder="House number, street name, ward, district, city/province..."
                        className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-gray-300 focus:border-[#004996] focus:ring-1 focus:ring-[#004996] outline-none transition-colors resize-none"
                      />
                    </div>
                  </div>

                  {/* Delivery Note */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Delivery Note <span className="text-gray-400 font-normal">(Optional)</span>
                    </label>
                    <div className="relative">
                      <FileText className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
                      <textarea
                        rows={2}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Delivery instructions, e.g., call upon arrival..."
                        className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-gray-300 focus:border-[#004996] focus:ring-1 focus:ring-[#004996] outline-none transition-colors resize-none"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 2: Payment Method Card */}
              <div className="bg-white rounded-lg border border-gray-200 p-5 sm:p-6 shadow-xs">
                <div className="pb-3 mb-4 border-b border-gray-200">
                  <h2 className="text-base font-semibold text-gray-900">
                    2. Payment Method
                  </h2>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* COD */}
                  <label
                    className={`relative flex items-start gap-3 p-3.5 rounded-md border cursor-pointer transition-colors ${paymentMethod === 'COD'
                      ? 'border-[#004996] bg-[#f0f7ff]'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                      }`}
                  >
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="COD"
                      checked={paymentMethod === 'COD'}
                      onChange={() => setPaymentMethod('COD')}
                      className="mt-1 text-[#004996] focus:ring-[#004996]"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <Banknote className="w-4 h-4 text-gray-700" />
                        <span className="text-sm font-medium text-gray-900">
                          Cash on Delivery (COD)
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 leading-relaxed">
                        Pay in cash upon physical receipt and verification.
                      </p>
                    </div>
                  </label>

                  {/* Bank Transfer / VietQR */}
                  <label
                    className={`relative flex items-start gap-3 p-3.5 rounded-md border cursor-pointer transition-colors ${paymentMethod === 'BANK_TRANSFER'
                      ? 'border-[#004996] bg-[#f0f7ff]'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                      }`}
                  >
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="BANK_TRANSFER"
                      checked={paymentMethod === 'BANK_TRANSFER'}
                      onChange={() => setPaymentMethod('BANK_TRANSFER')}
                      className="mt-1 text-[#004996] focus:ring-[#004996]"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <CreditCard className="w-4 h-4 text-[#004996]" />
                        <span className="text-sm font-medium text-gray-900">
                          Bank Transfer (VietQR)
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 leading-relaxed">
                        Direct transfer via 24/7 Napas banking network.
                      </p>
                    </div>
                  </label>
                </div>

                {/* Bank transfer info helper */}
                {paymentMethod === 'BANK_TRANSFER' && (
                  <div className="mt-3.5 p-3.5 rounded-md bg-[#f9fafb] border border-gray-200 text-xs text-gray-700 space-y-1">
                    <div className="font-semibold text-gray-900">
                      Bank Transfer Information:
                    </div>
                    <div>• Bank: <strong>Military Bank (MBBank)</strong></div>
                    <div>• Account Number: <strong className="font-mono">9999 8888 7777</strong></div>
                    <div>• Account Name: <strong>CONG TY CP DUOC PHAM PHARMATRACE VN</strong></div>
                    <div>• Transfer Content: <strong>[Your Order Code will be displayed after placement]</strong></div>
                  </div>
                )}
              </div>

              {/* Section 3: Selected Order Items Review */}
              <div className="bg-white rounded-lg border border-gray-200 p-5 sm:p-6 shadow-xs">
                <div className="flex items-center justify-between pb-3 mb-4 border-b border-gray-200">
                  <h2 className="text-base font-semibold text-gray-900">
                    3. Items Review ({selectedItems.length})
                  </h2>
                  <Link
                    href="/cart"
                    className="text-xs font-medium text-[#004996] hover:underline"
                  >
                    Edit in Cart
                  </Link>
                </div>

                <div className="divide-y divide-gray-100">
                  {selectedItems.map((item) => (
                    <div key={item.id} className="py-3 first:pt-0 last:pb-0 flex items-center gap-3 sm:gap-4">
                      <div className="w-12 h-12 rounded-md border border-gray-200 bg-white flex items-center justify-center shrink-0 overflow-hidden p-1">
                        {item.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.imageUrl}
                            alt={item.medicineName}
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <div className="text-xs font-bold text-gray-300">RX</div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <Link
                          href={`/products/${item.slug || item.productId}`}
                          className="text-sm font-semibold !text-black hover:!text-[#004996] transition-colors line-clamp-1"
                        >
                          {item.medicineName}
                        </Link>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] font-medium bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">
                            {item.unitName}
                          </span>
                          <span className="text-xs text-gray-500">Quantity: {item.quantity}</span>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-sm font-semibold text-gray-900">
                          {formatCurrency(item.price * item.quantity)}
                        </div>
                        {item.originalPrice && item.originalPrice > item.price && (
                          <div className="text-xs text-gray-400 line-through">
                            {formatCurrency(item.originalPrice * item.quantity)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: Order Financial Summary (5 cols on lg, sticky) */}
            <div className="lg:col-span-5 lg:sticky lg:top-[112px] space-y-4">
              <div className="bg-white rounded-lg border border-gray-200 p-5 sm:p-6 shadow-xs space-y-4">
                <h3 className="text-base font-semibold text-gray-900 border-b border-gray-200 pb-3">
                  Order Summary
                </h3>

                {/* Free shipping alert */}
                {subtotal >= FREE_SHIPPING_THRESHOLD ? (
                  <div className="flex items-center gap-2 text-xs font-medium text-[#15803d] py-1">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-[#15803d]" />
                    <span>Eligible for Free Standard Delivery (Order ≥ 500,000₫)</span>
                  </div>
                ) : (
                  <div className="text-xs text-gray-700 flex items-center gap-2 py-1">
                    <Truck className="w-4 h-4 text-amber-600 shrink-0" />
                    <div>
                      Add <strong>{formatCurrency(FREE_SHIPPING_THRESHOLD - subtotal)}</strong> more for <strong>Free Shipping</strong>.
                    </div>
                  </div>
                )}

                {/* Voucher code input section */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-gray-700 flex items-center gap-1.5">
                      <Tag className="w-3.5 h-3.5 text-gray-500" />
                      Voucher Code
                    </label>
                    {appliedVoucher && (
                      <button
                        type="button"
                        onClick={removeVoucherStore}
                        className="text-xs text-red-600 hover:underline cursor-pointer"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  {appliedVoucher ? (
                    <div className="p-2.5 rounded-md bg-[#f0f7ff] border border-blue-200 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="px-1.5 py-0.5 bg-[#004996] text-white text-xs font-mono font-medium rounded">
                          {appliedVoucher.voucherCode}
                        </span>
                        <span className="text-xs font-semibold text-[#004996]">
                          -{formatCurrency(voucherDiscount)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={voucherInput}
                        onChange={(e) => setVoucherInput(e.target.value)}
                        placeholder="Enter voucher code"
                        className="flex-1 px-3 py-1.5 text-xs uppercase font-medium rounded-md border border-gray-300 focus:border-[#004996] focus:ring-1 focus:ring-[#004996] outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleApplyVoucher}
                        disabled={voucherLoading || !voucherInput.trim()}
                        className="px-3 py-1.5 bg-gray-800 hover:bg-gray-900 disabled:bg-gray-200 disabled:text-gray-400 text-white text-xs font-medium rounded-md transition-colors cursor-pointer"
                      >
                        {voucherLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Apply'}
                      </button>
                    </div>
                  )}

                  {voucherError && (
                    <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3 shrink-0" />
                      {voucherError}
                    </p>
                  )}
                </div>

                {/* Loyalty points custom redemption card */}
                {availablePoints > 0 && maxRedeemablePoints > 0 && (
                  <div className="p-3.5 rounded-md bg-gray-50 border border-gray-200 transition-all">
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useLoyaltyPoints}
                        onChange={(e) => handleToggleLoyaltyPoints(e.target.checked)}
                        className="mt-0.5 rounded text-[#004996] focus:ring-[#004996]"
                      />
                      <div className="flex-1 text-xs">
                        <div className="font-semibold text-gray-900 flex items-center gap-1.5">
                          <Gift className="w-3.5 h-3.5 text-amber-600" />
                          <span>Redeem Loyalty Points</span>
                          <span className="text-gray-500 font-normal">
                            ({availablePoints.toLocaleString('vi-VN')} available)
                          </span>
                        </div>
                        <p className="text-gray-500 text-[11px] mt-0.5">
                          1 point = 1 ₫ · Maximum allowed for this order: up to {maxRedeemablePoints.toLocaleString('vi-VN')} points (max 20% of subtotal).
                        </p>
                      </div>
                    </label>

                    {useLoyaltyPoints && (
                      <div className="mt-3 pt-3 border-t border-gray-200/80 space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="relative flex-1">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={pointsInput}
                              onChange={handlePointsChange}
                              placeholder={`Enter points (1 - ${maxRedeemablePoints.toLocaleString('vi-VN')})`}
                              className="w-full pl-3 pr-14 py-1.5 text-xs rounded border border-gray-300 focus:border-[#004996] focus:ring-1 focus:ring-[#004996] outline-none bg-white font-medium text-gray-900"
                            />
                            <button
                              type="button"
                              onClick={handleSetMaxPoints}
                              className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2 py-0.5 text-[10px] font-semibold text-[#004996] bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 transition-colors"
                            >
                              MAX
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-gray-500">
                            Points being redeemed:{' '}
                            <strong className="text-gray-900 font-medium">
                              {effectivePointsToUse.toLocaleString('vi-VN')} pts
                            </strong>
                          </span>
                          <span className="text-amber-700 font-semibold">
                            -{formatCurrency(effectivePointsToUse)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Price Breakdown */}
                <div className="space-y-2 pt-3 border-t border-gray-200 text-xs sm:text-sm">
                  <div className="flex justify-between text-gray-600">
                    <span>Subtotal</span>
                    <span className="font-medium text-gray-900">{formatCurrency(subtotal)}</span>
                  </div>

                  <div className="flex justify-between text-gray-600">
                    <span>Shipping Fee</span>
                    <span className="font-medium text-gray-900">
                      {shippingFee === 0 ? (
                        <span className="text-[#15803d] font-semibold">FREE</span>
                      ) : (
                        formatCurrency(shippingFee)
                      )}
                    </span>
                  </div>

                  {voucherDiscount > 0 && (
                    <div className="flex justify-between text-[#004996]">
                      <span>Voucher Discount</span>
                      <span className="font-medium">-{formatCurrency(voucherDiscount)}</span>
                    </div>
                  )}

                  {pointsDiscount > 0 && (
                    <div className="flex justify-between text-amber-700">
                      <span>
                        Reward Points ({effectivePointsToUse.toLocaleString('vi-VN')} pts)
                      </span>
                      <span className="font-medium">-{formatCurrency(pointsDiscount)}</span>
                    </div>
                  )}

                  <div className="pt-3 border-t border-gray-200 flex justify-between items-baseline">
                    <span className="text-sm font-semibold text-gray-900">Total Amount</span>
                    <div className="text-right">
                      <div className="text-xl font-bold text-[#004996]">
                        {formatCurrency(totalAmount)}
                      </div>
                      <span className="text-[11px] text-gray-400">VAT included</span>
                    </div>
                  </div>
                </div>

                {/* Place Order Button */}
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 rounded-md bg-[#004996] hover:bg-[#004084] disabled:bg-gray-300 text-white font-medium text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Processing Order...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      <span>Confirm & Place Order</span>
                    </>
                  )}
                </button>

                {/* Assurance text */}
                <div className="pt-3 text-[11px] text-gray-500 space-y-1.5 border-t border-gray-100">
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-[#15803d]" />
                    <span>GSP & GACP-WHO Certified Authentic Pharmaceuticals</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Truck className="w-3.5 h-3.5 text-gray-500" />
                    <span>Temperature-controlled logistics & distribution</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </form>
      </div>

      {/* Map Address Picker Modal */}
      {isMapModalOpen && (
        <MapAddressPickerModal
          isOpen={isMapModalOpen}
          onClose={() => setIsMapModalOpen(false)}
          initialAddress={shippingAddress}
          initialNote={note}
          initialCoords={deliveryCoords || undefined}
          onConfirm={(result: SelectedLocationResult) => {
            setShippingAddress(result.fullAddress);
            setDeliveryCoords({
              latitude: result.latitude,
              longitude: result.longitude,
            });
            if (result.note) {
              setNote(result.note);
            }
            message.success('Delivery location confirmed on map!');
          }}
        />
      )}
    </div>
  );
}
