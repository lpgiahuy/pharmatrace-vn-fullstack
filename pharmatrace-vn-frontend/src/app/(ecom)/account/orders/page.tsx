'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Package,
  Truck,
  Eye,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  ShoppingBag,
  MapPin,
  Phone,
  User,
  Calendar,
  FileText,
  RotateCcw,
} from 'lucide-react';
import { App, Modal, Popconfirm, Spin } from 'antd';
import {
  orderService,
  Order,
  OrderStatus,
  formatOrderStatus,
  formatOrderStatusLabel,
  formatPaymentStatus,
  formatPaymentMethod,
  getOrderItems,
} from '@/services/order.service';
import { useCartStore } from '@/store/useCartStore';
import { useAuth } from '@/store/useAuthStore';
import { formatCurrency, formatDateTime } from '@/utils';

const STATUS_TABS: { key: string; label: string; status?: OrderStatus }[] = [
  { key: 'ALL', label: 'All Orders' },
  { key: 'PENDING', label: 'Pending', status: 'PENDING' },
  { key: 'WAITING_INTERNAL_TRANSFER', label: 'Consolidating', status: 'WAITING_INTERNAL_TRANSFER' },
  { key: 'PROCESSING', label: 'Processing', status: 'PROCESSING' },
  { key: 'SHIPPING', label: 'In Transit', status: 'SHIPPING' },
  { key: 'COMPLETED', label: 'Completed', status: 'COMPLETED' },
  { key: 'CANCELLED', label: 'Cancelled', status: 'CANCELLED' },
];

function OrderStatusBadge({ status }: { status?: string }) {
  const norm = formatOrderStatus(status);
  const label = formatOrderStatusLabel(status);

  let colorClass = 'text-gray-700';
  if (norm === 'COMPLETED') colorClass = 'text-emerald-700 font-medium';
  else if (norm === 'PROCESSING') colorClass = 'text-blue-700 font-medium';
  else if (norm === 'WAITING_INTERNAL_TRANSFER') colorClass = 'text-cyan-800 bg-cyan-50 px-2 py-0.5 rounded border border-cyan-200 font-medium';
  else if (norm === 'SHIPPING') colorClass = 'text-indigo-700 font-medium';
  else if (norm === 'CANCELLED') colorClass = 'text-red-700 font-medium';
  else if (norm === 'PENDING') colorClass = 'text-amber-700 font-medium';
  else if (norm === 'RETURNED' || norm === 'PARTIALLY_RETURNED') colorClass = 'text-amber-800 font-medium';

  return <span className={`text-xs ${colorClass}`}>{label}</span>;
}

function PaymentStatusBadge({ status }: { status?: string }) {
  const norm = formatPaymentStatus(status);
  let colorClass = 'text-gray-700';
  if (norm === 'PAID') colorClass = 'text-emerald-700 font-semibold';
  else if (norm === 'UNPAID') colorClass = 'text-amber-700 font-semibold';
  else if (norm === 'REFUNDED') colorClass = 'text-red-700 font-semibold';

  return <span className={`text-xs ${colorClass}`}>{norm}</span>;
}

function CustomerOrdersContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { message } = App.useApp();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const addItemToCart = useCartStore((s) => s.addItem);

  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState('ALL');
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [expandedOrders, setExpandedOrders] = useState<Record<number, boolean>>({});

  const toggleOrderExpand = (orderId: number) => {
    setExpandedOrders((prev) => ({
      ...prev,
      [orderId]: !prev[orderId],
    }));
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  // Success query param detection
  const isSuccess = searchParams.get('success') === 'true';
  const successOrderCode = searchParams.get('orderCode');

  const fetchOrders = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    try {
      const activeStatus = STATUS_TABS.find((t) => t.key === activeTab)?.status;
      const res = await orderService.getMyOrders({
        status: activeStatus,
        limit: 50,
      });
      if (res?.data) {
        setOrders(res.data);
      }
    } catch (err: any) {
      message.error(err?.message || 'Failed to load order history.');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, activeTab, message]);

  useEffect(() => {
    if (mounted && !authLoading && isAuthenticated) {
      fetchOrders();
    }
  }, [mounted, authLoading, isAuthenticated, fetchOrders]);

  const handleCancelOrder = async (orderId: number) => {
    setCancellingId(orderId);
    try {
      const res = await orderService.cancelMyOrder(orderId);
      if (res?.success) {
        message.success('Order cancelled successfully.');
        fetchOrders();
        if (selectedOrder?.id === orderId) {
          setDetailModalOpen(false);
        }
      } else {
        message.error(res?.message || 'Failed to cancel order.');
      }
    } catch (err: any) {
      message.error(err?.message || 'Failed to cancel order.');
    } finally {
      setCancellingId(null);
    }
  };

  const handleReorder = (order: Order) => {
    const orderItems = getOrderItems(order);
    if (!orderItems || orderItems.length === 0) return;
    orderItems.forEach((item) => {
      addItemToCart(
        {
          id: `${item.variant?.medicine?.id || item.medicine?.id || item.id}-${item.variantId || 'base'}`,
          productId: item.variant?.medicine?.id || item.medicine?.id || item.medicineId || 0,
          slug: item.medicine?.slug || '',
          medicineName: item.medicineName,
          imageUrl: item.medicine?.imageUrl || item.variant?.medicine?.images?.[0] || null,
          variantId: item.variantId,
          unitName: item.unitName,
          price: item.unitPrice,
        },
        item.quantity
      );
    });
    message.success('Items added to cart.');
    router.push('/cart');
  };

  if (!mounted || authLoading) {
    return (
      <div className="min-h-screen bg-[#f7f8fa] flex items-center justify-center">
        <Spin size="large" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#f7f8fa] py-16 px-4">
        <div className="max-w-md mx-auto bg-white rounded-md p-6 border border-gray-200 shadow-xs text-center">
          <div className="w-12 h-12 rounded-md bg-blue-50 text-[#004996] flex items-center justify-center mx-auto mb-4">
            <User className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Sign In Required</h2>
          <p className="text-gray-600 text-sm mb-6 leading-relaxed">
            Please log in with your account to view your past purchases and track ongoing deliveries.
          </p>
          <Link
            href="/login?redirect=/account/orders"
            className="block w-full py-2.5 px-4 bg-[#004996] hover:bg-[#004084] text-white text-sm font-medium rounded-md transition-colors"
          >
            Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f8fa] pb-16 pt-4 sm:pt-6">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Breadcrumb Navigation */}
        <nav className="flex items-center gap-2 text-xs sm:text-sm text-gray-500 mb-5">
          <Link href="/" className="hover:text-[#004996] transition-colors">
            Home
          </Link>
          <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
          <span className="font-medium text-gray-900">My Orders</span>
        </nav>

        {/* Success Banner (if redirected from checkout) */}
        {isSuccess && (
          <div className="mb-6 p-4 rounded-md bg-emerald-50 border border-emerald-200 flex items-start sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-emerald-900">
                Order Placed Successfully
              </h2>
              <p className="text-xs text-emerald-700 mt-0.5">
                Order Code:{' '}
                <strong className="font-mono font-semibold text-gray-900">
                  {successOrderCode || 'Confirmed'}
                </strong>
                . Your order is now being processed.
              </p>
            </div>
            <Link
              href="/"
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#004996] hover:bg-[#004084] text-white text-xs font-medium rounded-md transition-colors"
            >
              Continue Shopping
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}

        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              My Orders
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              Track delivery progress and review order history.
            </p>
          </div>
          <Link
            href="/cart"
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 rounded-md text-xs font-medium transition-colors w-fit"
          >
            <ShoppingBag className="w-4 h-4 text-[#004996]" />
            Shopping Cart
          </Link>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-2 mb-6 border-b border-gray-200 scrollbar-none">
          {STATUS_TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-3.5 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${isActive
                  ? 'bg-[#004996] text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                  }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Order Cards List */}
        {loading ? (
          <div className="py-20 text-center">
            <Spin size="large" />
            <p className="text-gray-400 text-xs mt-3">Loading order history...</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="bg-white rounded-md border border-gray-200 p-12 text-center max-w-lg mx-auto shadow-xs">
            <div className="w-12 h-12 rounded-md bg-gray-100 text-gray-400 flex items-center justify-center mx-auto mb-3">
              <ShoppingBag className="w-6 h-6" />
            </div>
            <h3 className="text-base font-semibold text-gray-900 mb-1">No Orders Found</h3>
            <p className="text-gray-500 text-xs mb-5 leading-relaxed">
              {activeTab === 'ALL'
                ? 'You have not placed any orders yet.'
                : `You currently have no orders with "${STATUS_TABS.find((t) => t.key === activeTab)?.label}" status.`}
            </p>
            <Link
              href="/products"
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#004996] hover:bg-[#004084] text-white text-xs font-medium rounded-md transition-colors"
            >
              Browse Medications
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {orders.map((order) => {
              const shipment = order.shipments?.[0] || order.shipment;
              const orderItems = getOrderItems(order);
              const isExpanded = !!expandedOrders[order.id];
              const displayedItems = isExpanded ? orderItems : orderItems.slice(0, 1);
              return (
                <div
                  key={order.id}
                  className="bg-white rounded-md border border-gray-200 overflow-hidden shadow-xs hover:border-gray-300 transition-colors"
                >
                  {/* Order Top Bar */}
                  <div className="p-3.5 sm:p-4 bg-[#f9fafb] border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs">
                      <div className="flex items-center gap-1.5 font-mono font-semibold text-gray-900">
                        <span className="text-gray-500 font-sans font-normal">Order:</span>
                        {order.orderCode}
                      </div>
                      <span className="text-gray-300 hidden sm:inline">•</span>
                      <div className="flex items-center gap-1 text-gray-500">
                        <Calendar className="w-3.5 h-3.5" />
                        {formatDateTime(order.createdAt)}
                      </div>
                      {shipment?.trackingNumber && (
                        <>
                          <span className="text-gray-300 hidden sm:inline">•</span>
                          <div className="flex items-center gap-1 text-gray-700 bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded font-mono text-[11px]">
                            <Truck className="w-3 h-3 text-gray-500" />
                            {shipment.trackingNumber}
                          </div>
                        </>
                      )}
                    </div>

                    <div>
                      <OrderStatusBadge status={order.orderStatus} />
                    </div>
                  </div>

                  {/* Internal Transfer Banner if Consolidating */}
                  {formatOrderStatus(order.orderStatus) === 'WAITING_INTERNAL_TRANSFER' && (
                    <div className="bg-cyan-50/80 border-b border-cyan-100 px-4 py-2.5 flex items-center gap-2.5 text-xs text-cyan-900">
                      <RotateCcw className="w-3.5 h-3.5 text-cyan-700 animate-spin shrink-0" />
                      <div className="flex-1">
                        <span className="font-semibold text-cyan-950">Internal Warehouse Transfer:</span>{' '}
                        Medications are being consolidated to{' '}
                        <strong className="text-cyan-950">{order.exportFacility?.facilityName || 'Main Hub'}</strong>{' '}
                        so your order is delivered in one complete shipment.
                      </div>
                    </div>
                  )}

                  {/* Order Items Preview */}
                  <div className="p-4 divide-y divide-gray-100">
                    {orderItems.length > 0 ? (
                      <>
                        {displayedItems.map((item, idx) => (
                          <div
                            key={item.id || idx}
                            className={`py-2.5 first:pt-0 ${orderItems.length === 1 || (!isExpanded && idx === 0)
                              ? 'last:pb-0'
                              : ''
                              } flex items-center gap-3 sm:gap-4`}
                          >
                            <div className="w-12 h-12 rounded border border-gray-200 bg-white flex items-center justify-center shrink-0 overflow-hidden p-1">
                              {item.medicine?.imageUrl || item.variant?.medicine?.images?.[0] ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={item.medicine?.imageUrl || item.variant?.medicine?.images?.[0]}
                                  alt={item.medicineName}
                                  className="w-full h-full object-contain"
                                />
                              ) : (
                                <div className="text-xs font-bold text-gray-300">RX</div>
                              )}
                            </div>

                            <div className="flex-1 min-w-0">
                              <h4 className="text-sm font-medium text-gray-900 line-clamp-1">
                                {item.medicineName}
                              </h4>
                              <div className="flex flex-wrap items-center gap-2 mt-0.5">
                                <span className="text-[11px] font-medium bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">
                                  {item.unitName}
                                </span>
                                <span className="text-xs text-gray-500">Quantity: {item.quantity}</span>
                                {item.sourceFacilityName && (
                                  <span className="text-[10px] text-slate-600 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
                                    Warehouse: {item.sourceFacilityName}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="text-right shrink-0">
                              <div className="text-sm font-semibold text-gray-900">
                                {formatCurrency(item.totalPrice)}
                              </div>
                              <div className="text-xs text-gray-400">
                                {formatCurrency(item.unitPrice)} / {item.unitName}
                              </div>
                            </div>
                          </div>
                        ))}

                        {/* Dropdown toggle if order contains more than 1 item */}
                        {orderItems.length > 1 && (
                          <div className="pt-2 flex items-center justify-between">
                            <button
                              type="button"
                              onClick={() => toggleOrderExpand(order.id)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[#004996] bg-blue-50/70 hover:bg-blue-100/70 border border-blue-200/60 rounded transition-colors cursor-pointer"
                            >
                              {isExpanded ? (
                                <>
                                  <span>Show less</span>
                                  <ChevronUp className="w-3.5 h-3.5" />
                                </>
                              ) : (
                                <>
                                  <span>+{orderItems.length - 1} more item{orderItems.length - 1 > 1 ? 's' : ''} (click to expand)</span>
                                  <ChevronDown className="w-3.5 h-3.5" />
                                </>
                              )}
                            </button>
                            <span className="text-[11px] text-gray-400">
                              {orderItems.length} products in this order
                            </span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-xs text-gray-400 italic">No line items in this order.</div>
                    )}
                  </div>

                  {/* Order Footer & Actions */}
                  <div className="p-3.5 sm:p-4 bg-gray-50/50 border-t border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="text-xs text-gray-600 space-y-1">
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-gray-400" />
                        <span className="truncate max-w-md">{order.shippingAddress || '—'}</span>
                      </div>
                      <div className="flex items-center gap-3 text-gray-500">
                        <span className="flex items-center gap-1">
                          <Phone className="w-3 h-3" />
                          {order.recipientPhone || '—'}
                        </span>
                        <span>•</span>
                        <span className="text-gray-700 font-medium">
                          {formatPaymentMethod(order.paymentMethod)}
                        </span>
                        <span>•</span>
                        <PaymentStatusBadge status={order.paymentStatus} />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 self-end sm:self-center">
                      <div className="text-right mr-2">
                        <span className="text-[11px] text-gray-400 block">Total:</span>
                        <span className="text-base font-bold text-gray-900">
                          {formatCurrency(order.totalAmount)}
                        </span>
                      </div>

                      {/* Cancel Order (if PENDING or WAITING_INTERNAL_TRANSFER) */}
                      {['PENDING', 'WAITING_INTERNAL_TRANSFER'].includes(formatOrderStatus(order.orderStatus)) && (
                        <Popconfirm
                          title="Cancel Order"
                          description="Are you sure you want to cancel this order? Reserved warehouse inventory will be released."
                          okText="Yes, Cancel"
                          cancelText="Keep Order"
                          okButtonProps={{ danger: true, loading: cancellingId === order.id }}
                          onConfirm={() => handleCancelOrder(order.id)}
                        >
                          <button
                            type="button"
                            className="px-3 py-1.5 bg-white hover:bg-red-50 text-red-700 border border-red-300 rounded-md text-xs font-medium transition-colors cursor-pointer"
                          >
                            Cancel
                          </button>
                        </Popconfirm>
                      )}

                      {/* Reorder */}
                      <button
                        type="button"
                        onClick={() => handleReorder(order)}
                        className="px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-gray-500" />
                        Reorder
                      </button>

                      {/* View Details */}
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedOrder(order);
                          setDetailModalOpen(true);
                        }}
                        className="px-3 py-1.5 bg-[#004996] hover:bg-[#004084] text-white rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Details
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Order Detail Modal */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-base font-semibold text-gray-900 pb-2 border-b border-gray-200">
            <Package className="w-4 h-4 text-[#004996]" />
            <span>Order Details: <span className="font-mono text-gray-900">{selectedOrder?.orderCode}</span></span>
          </div>
        }
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        footer={null}
        width={650}
        className="[&_.ant-modal-content]:!rounded-md"
      >
        {selectedOrder && (
          <div className="space-y-4 pt-2 text-xs sm:text-sm">
            {/* Header Status & Date */}
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-md border border-gray-200">
              <div>
                <span className="text-gray-500 text-xs block">Status</span>
                <div className="mt-1">
                  <OrderStatusBadge status={selectedOrder.orderStatus} />
                </div>
              </div>
              <div className="text-right">
                <span className="text-gray-500 text-xs block">Date Placed</span>
                <span className="font-medium text-gray-800">
                  {formatDateTime(selectedOrder.createdAt)}
                </span>
              </div>
            </div>

            {/* Recipient & Shipping Information */}
            <div className="border border-gray-200 rounded-md p-3.5 space-y-1.5">
              <h4 className="font-semibold text-gray-900 text-xs uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-gray-500" />
                Shipping Information
              </h4>
              <div className="text-gray-900 font-medium">{selectedOrder.recipientName || '—'}</div>
              <div className="text-gray-600">{selectedOrder.recipientPhone || '—'}</div>
              <div className="text-gray-600">{selectedOrder.shippingAddress || '—'}</div>
              {selectedOrder.note && (
                <div className="text-gray-500 italic pt-1 border-t border-gray-100">
                  Note: &quot;{selectedOrder.note}&quot;
                </div>
              )}
            </div>

            {/* Internal Transfers Information (if any) */}
            {((selectedOrder.internalTransfers && selectedOrder.internalTransfers.length > 0) ||
              formatOrderStatus(selectedOrder.orderStatus) === 'WAITING_INTERNAL_TRANSFER') && (
                <div className="border border-cyan-200 bg-cyan-50/60 rounded-md p-3 space-y-2 text-cyan-950">
                  <div className="font-semibold flex items-center justify-between text-xs text-cyan-800">
                    <div className="flex items-center gap-1.5">
                      <RotateCcw className="w-3.5 h-3.5" />
                      Internal Warehouse Consolidation
                    </div>
                    <span className="font-mono text-[11px] bg-cyan-100/80 px-1.5 py-0.5 rounded text-cyan-800">
                      Export Hub: {selectedOrder.exportFacility?.facilityName || 'Primary Warehouse'}
                    </span>
                  </div>
                  <p className="text-[11px] text-cyan-800 leading-relaxed">
                    Items are being transferred from partner warehouses to consolidate your order before final delivery.
                  </p>
                  {selectedOrder.internalTransfers && selectedOrder.internalTransfers.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      {selectedOrder.internalTransfers.map((tf) => (
                        <div
                          key={tf.id}
                          className="bg-white/80 border border-cyan-200/80 rounded p-2 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                        >
                          <div>
                            <div className="font-mono font-semibold text-slate-800">
                              {tf.transferCode}
                            </div>
                            <div className="text-[11px] text-slate-600 mt-0.5">
                              From: <strong className="text-slate-700">{tf.fromFacilityName || `Facility #${tf.fromFacilityId}`}</strong>
                              {' ➔ '}
                              To: <strong className="text-slate-700">{tf.toFacilityName || `Facility #${tf.toFacilityId}`}</strong>
                            </div>
                            <div className="text-[10px] text-slate-500 mt-0.5">
                              Distance: {tf.distanceKm} km • Est. transit: ~{tf.estimatedHours}h
                            </div>
                          </div>
                          <div className="text-right">
                            <span
                              className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${tf.status === 'RECEIVED'
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                  : tf.status === 'DISPATCHED'
                                    ? 'bg-blue-100 text-blue-800 border border-blue-200'
                                    : 'bg-amber-100 text-amber-800 border border-amber-200'
                                }`}
                            >
                              {tf.status === 'RECEIVED' ? 'Arrived at Hub' : tf.status === 'DISPATCHED' ? 'In Transfer' : 'Transfer Requested'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

            {/* Shipment / Tracking */}
            {(selectedOrder.shipments?.[0] || selectedOrder.shipment) && (() => {
              const sh = selectedOrder.shipments?.[0] || selectedOrder.shipment;
              return (
                <div className="border border-indigo-200 bg-indigo-50/60 rounded-md p-3 space-y-1 text-indigo-950">
                  <div className="font-semibold flex items-center gap-1.5 text-xs text-indigo-800">
                    <Truck className="w-3.5 h-3.5" />
                    Shipment Tracking
                  </div>
                  <div className="font-mono text-xs font-semibold">
                    Tracking Code: {sh?.trackingNumber || 'Pending'}
                  </div>
                  <div className="text-xs text-indigo-900">
                    Status: <strong>{sh?.shippingStatus || 'Pending'}</strong>
                    {sh?.shippedAt && (
                      <span> • Dispatched: {formatDateTime(sh.shippedAt)}</span>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Order Items Table */}
            {(() => {
              const modalItems = getOrderItems(selectedOrder);
              return (
                <div>
                  <h4 className="font-semibold text-gray-900 mb-2 text-xs uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-gray-500" />
                    Items ({modalItems.length})
                  </h4>
                  <div className="divide-y divide-gray-200 border border-gray-200 rounded-md overflow-hidden">
                    {modalItems.length > 0 ? (
                      modalItems.map((item) => (
                        <div key={item.id} className="p-3 bg-white flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded border border-gray-200 bg-white flex items-center justify-center shrink-0 overflow-hidden p-0.5">
                              {item.medicine?.imageUrl || item.variant?.medicine?.images?.[0] ? (
                                <img
                                  src={item.medicine?.imageUrl || item.variant?.medicine?.images?.[0]}
                                  alt={item.medicineName}
                                  className="w-full h-full object-contain"
                                />
                              ) : (
                                <div className="text-[10px] font-bold text-gray-300">RX</div>
                              )}
                            </div>
                            <div>
                              <div className="font-medium text-gray-900">{item.medicineName}</div>
                              <div className="text-xs text-gray-500 flex items-center gap-2 mt-0.5">
                                <span>{item.unitName} × {item.quantity} ({formatCurrency(item.unitPrice)} each)</span>
                                {item.sourceFacilityName && (
                                  <span className="text-[10px] text-slate-600 bg-slate-100 border border-slate-200 px-1 py-0.2 rounded">
                                    From: {item.sourceFacilityName}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="font-semibold text-gray-900">
                            {formatCurrency(item.totalPrice)}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="p-3 text-center text-gray-400">No items attached.</div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Financial Summary */}
            {(() => {
              const voucherDiscount =
                selectedOrder.voucherDiscount !== undefined
                  ? selectedOrder.voucherDiscount
                  : Math.max(0, (selectedOrder.discountAmount || 0) - (selectedOrder.usedPoints || 0));
              const pointsDiscount = selectedOrder.pointsDiscount ?? (selectedOrder.usedPoints || 0);

              return (
                <div className="border-t border-gray-200 pt-3 space-y-1.5 text-xs">
                  <div className="flex justify-between text-gray-600">
                    <span>Subtotal:</span>
                    <span className="font-medium text-gray-900">
                      {formatCurrency(selectedOrder.subtotalAmount)}
                    </span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>Shipping Fee:</span>
                    <span className="font-medium text-gray-900">
                      {selectedOrder.shippingFee === 0 ? 'FREE' : formatCurrency(selectedOrder.shippingFee)}
                    </span>
                  </div>
                  {voucherDiscount > 0 && (
                    <div className="flex justify-between text-[#004996]">
                      <span>Voucher Discount:</span>
                      <span className="font-medium">-{formatCurrency(voucherDiscount)}</span>
                    </div>
                  )}
                  {selectedOrder.usedPoints > 0 && (
                    <div className="flex justify-between text-amber-700">
                      <span>Points Redeemed ({selectedOrder.usedPoints} pts):</span>
                      <span className="font-medium">-{formatCurrency(pointsDiscount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-gray-900 font-semibold text-sm pt-2 border-t border-gray-200">
                    <span>Total:</span>
                    <span className="text-gray-900 text-base font-bold">
                      {formatCurrency(selectedOrder.totalAmount)}
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </Modal>
    </div>
  );
}

export default function CustomerOrdersPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#f7f8fa] flex items-center justify-center">
          <Spin size="large" />
        </div>
      }
    >
      <CustomerOrdersContent />
    </Suspense>
  );
}
