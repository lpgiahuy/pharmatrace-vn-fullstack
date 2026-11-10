'use client';

import React, { useState, useEffect, useCallback, useMemo, useSyncExternalStore, Suspense } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  RotateCcw,
  RotateCw,
  CheckCircle2,
  Clock,
  XCircle,
  Copy,
  Check,
  Building2,
  CreditCard,
  Box,
  Filter,
  Search,
  X,
  AlertTriangle,
  AlertCircle,
  HelpCircle,
  FileText,
} from 'lucide-react';
import { App, Modal, Select, Spin, Tooltip } from 'antd';
import {
  orderService,
  Order,
  OrderStatus,
  formatOrderStatus,
  formatOrderStatusLabel,
  formatPaymentMethod,
  getOrderItems,
} from '@/services/order.service';
import { useCartStore } from '@/store/useCartStore';
import { useAuth } from '@/store/useAuthStore';
import { formatCurrency, formatDateTime } from '@/utils';
import { workflowErrorMessage } from '@/utils/workflow-error';

const STATUS_TABS: { key: string; label: string; status?: OrderStatus }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'PENDING', label: 'Pending', status: 'PENDING' },
  { key: 'WAITING_INTERNAL_TRANSFER', label: 'Consolidating', status: 'WAITING_INTERNAL_TRANSFER' },
  { key: 'PROCESSING', label: 'Processing', status: 'PROCESSING' },
  { key: 'PENDING_PICKUP', label: 'Awaiting Pickup', status: 'PENDING_PICKUP' },
  { key: 'PICKED_UP', label: 'Handed to Carrier', status: 'PICKED_UP' },
  { key: 'SHIPPING', label: 'In Transit', status: 'SHIPPING' },
  { key: 'COMPLETED', label: 'Completed', status: 'COMPLETED' },
  { key: 'CANCELLED', label: 'Cancelled', status: 'CANCELLED' },
];

const CANCELLATION_REASONS = [
  {
    value: 'CHANGED_MIND' as const,
    label: 'Changed my mind',
    sublabel: 'Tôi đổi ý / Không còn nhu cầu',
    description: 'No longer need this medication or decided to purchase later.',
    icon: RotateCcw,
  },
  {
    value: 'ADDRESS_CHANGE' as const,
    label: 'Change delivery address or phone',
    sublabel: 'Muốn thay đổi địa chỉ / số điện thoại nhận hàng',
    description: 'Need to update recipient contact number or shipping address.',
    icon: MapPin,
  },
  {
    value: 'OTHER' as const,
    label: 'Other reason',
    sublabel: 'Lý do khác (yêu cầu nhập chi tiết)',
    description: 'Provide specific feedback or explain your situation.',
    icon: FileText,
  },
];

const QUICK_CANCEL_CHIPS = [
  'Ordered wrong quantity or item',
  'Found alternative pharmacy nearby',
  'Estimated delivery time is too long',
  'Placed duplicate order by mistake',
];

function OrderStatusBadge({ status }: { status?: string }) {
  const norm = formatOrderStatus(status);
  const label = formatOrderStatusLabel(status);

  if (norm === 'COMPLETED') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
        {label}
      </span>
    );
  }
  if (norm === 'PROCESSING') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600">
        <Box className="w-3.5 h-3.5 text-blue-600" />
        {label}
      </span>
    );
  }
  if (norm === 'WAITING_INTERNAL_TRANSFER') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-700">
        <RotateCcw className="w-3.5 h-3.5 text-cyan-600" />
        Consolidating
      </span>
    );
  }
  if (norm === 'SHIPPING') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600">
        <Truck className="w-3.5 h-3.5 text-blue-600" />
        {label}
      </span>
    );
  }
  if (norm === 'CANCELLED') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-medical-red">
        <XCircle className="w-3.5 h-3.5 text-medical-red" />
        {label}
      </span>
    );
  }
  if (norm === 'PENDING') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-600">
        <Clock className="w-3.5 h-3.5 text-amber-600" />
        {label}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600">
      <Package className="w-3.5 h-3.5 text-slate-500" />
      {label}
    </span>
  );
}

function getCarrierStatusClass(status?: string): string {
  if (!status) return 'text-amber-600';
  const s = status.trim().toUpperCase();
  if (['DELIVERED', 'COMPLETED', 'SUCCESS'].includes(s)) {
    return 'text-emerald-600';
  }
  if (['SHIPPED', 'IN_TRANSIT', 'DISPATCHED', 'OUT_FOR_DELIVERY'].includes(s)) {
    return 'text-blue-600';
  }
  if (['PENDING', 'PENDING_PICKUP', 'PROCESSING', 'PACKING', 'WAITING_PICKUP'].includes(s)) {
    return 'text-amber-600';
  }
  if (['FAILED', 'CANCELLED', 'CANCELED', 'RETURNED', 'DELIVERY_FAILED'].includes(s)) {
    return 'text-medical-red';
  }
  return 'text-blue-600';
}

function OrderTrackingTimeline({ status, cancellationReason }: { status?: string; cancellationReason?: string | null }) {
  const norm = formatOrderStatus(status);

  if (norm === 'CANCELLED') {
    return (
      <div className="p-4 rounded-md bg-red-50 border border-red-200 flex items-start gap-3 text-red-800">
        <XCircle className="w-5 h-5 text-medical-red shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="text-sm font-bold text-red-900">Order Cancelled</div>
          <div className="text-xs text-red-700 leading-relaxed">
            This order was cancelled and any allocated inventory has been released back to stock.
          </div>
          {cancellationReason && (
            <div className="text-xs text-red-900 pt-1.5 border-t border-red-200/80 font-medium">
              <span className="font-semibold text-red-950">Cancellation reason:</span>{' '}
              <span className="italic">{cancellationReason}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  const steps = [
    { key: 'PENDING', label: 'Order Placed', desc: 'Received' },
    { key: 'PROCESSING', label: 'Packing', desc: norm === 'WAITING_INTERNAL_TRANSFER' ? 'Consolidating' : 'Warehouse' },
    { key: 'PENDING_PICKUP', label: 'Awaiting Pickup', desc: 'Packed' },
    { key: 'PICKED_UP', label: 'Handed to Carrier', desc: 'Picked up' },
    { key: 'SHIPPING', label: 'In Transit', desc: 'On the way' },
    { key: 'COMPLETED', label: 'Delivered', desc: 'Complete' },
  ];

  let currentStepIndex = 0;
  if (norm === 'WAITING_INTERNAL_TRANSFER' || norm === 'PROCESSING') currentStepIndex = 1;
  else if (norm === 'PENDING_PICKUP') currentStepIndex = 2;
  else if (norm === 'PICKED_UP') currentStepIndex = 3;
  else if (norm === 'SHIPPING') currentStepIndex = 4;
  else if (norm === 'COMPLETED') currentStepIndex = 5;

  return (
    <div className="py-2 px-1">
      <div className="relative flex items-center justify-between">
        <div className="absolute top-4 left-6 right-6 h-0.5 bg-slate-200 z-0">
          <div
            className="h-full bg-[#004996] transition-all duration-300"
            style={{ width: `${(currentStepIndex / (steps.length - 1)) * 100}%` }}
          />
        </div>

        {steps.map((st, idx) => {
          const isCompletedOrder = norm === 'COMPLETED';
          const isDone = isCompletedOrder ? true : idx < currentStepIndex;
          const isCurrent = !isCompletedOrder && idx === currentStepIndex;

          return (
            <div key={st.key} className="flex flex-col items-center relative z-10">
              <div className="relative flex items-center justify-center">
                {isCurrent && (
                  <>
                    <span className="absolute w-8 h-8 rounded-full bg-[#004996] animate-ripple pointer-events-none" />
                    <span className="absolute w-8 h-8 rounded-full bg-[#004996] animate-ripple-delayed pointer-events-none" />
                  </>
                )}
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold relative z-10 transition-all ${isDone
                    ? 'bg-[#004996] text-white shadow-xs'
                    : isCurrent
                      ? 'bg-[#004996] text-white ring-4 ring-blue-100 shadow-sm'
                      : 'bg-white border-2 border-slate-300 text-slate-400'
                    }`}
                >
                  {isDone ? <Check className="w-4 h-4" /> : idx + 1}
                </div>
              </div>
              <div className="text-center mt-2">
                <div
                  className={`text-xs font-semibold ${isDone || isCurrent ? 'text-slate-900' : 'text-slate-400'
                    }`}
                >
                  {st.label}
                </div>
                <div className="text-[10px] text-slate-500 hidden sm:block">{st.desc}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CustomerOrdersContent() {
  const router = useRouter();
  const { message } = App.useApp();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const addItemToCart = useCartStore((s) => s.addItem);

  const mounted = useSyncExternalStore(
    () => () => { },
    () => true,
    () => false
  );

  const [activeTab, setActiveTab] = useState('ALL');
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [loadingDetailId, setLoadingDetailId] = useState<number | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [cancelReason, setCancelReason] = useState<'' | 'CHANGED_MIND' | 'ADDRESS_CHANGE' | 'OTHER'>('');
  const [cancelDetails, setCancelDetails] = useState('');
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [orderToCancel, setOrderToCancel] = useState<Order | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const openCancelModal = (order: Order) => {
    setOrderToCancel(order);
    setCancelReason('');
    setCancelDetails('');
    setCancelError(null);
    setCancelModalOpen(true);
  };

  const closeCancelModal = () => {
    if (cancellingId !== null) return;
    setCancelModalOpen(false);
    setOrderToCancel(null);
    setCancelReason('');
    setCancelDetails('');
    setCancelError(null);
  };
  const [expandedOrders, setExpandedOrders] = useState<Record<number, boolean>>({});
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const toggleOrderExpand = (orderId: number) => {
    setExpandedOrders((prev) => ({
      ...prev,
      [orderId]: !prev[orderId],
    }));
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(text);
    message.success(`${label} copied to clipboard`);
    setTimeout(() => {
      setCopiedCode((curr) => (curr === text ? null : curr));
    }, 2000);
  };

  const reloadOrders = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const activeStatus = STATUS_TABS.find((t) => t.key === activeTab)?.status;
      const res = await orderService.getMyOrders({
        status: activeStatus,
        limit: 50,
      });
      if (res?.data) {
        setOrders(res.data);
      }
    } catch (err: unknown) {
      const msg = workflowErrorMessage(err, 'Failed to load order history.');
      message.error(msg);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, activeTab, message]);

  useEffect(() => {
    if (!mounted || authLoading || !isAuthenticated) return;
    let ignore = false;

    const run = async () => {
      try {
        const activeStatus = STATUS_TABS.find((t) => t.key === activeTab)?.status;
        const res = await orderService.getMyOrders({
          status: activeStatus,
          limit: 50,
        });
        if (!ignore && res?.data) {
          setOrders(res.data);
        }
      } catch (err: unknown) {
        if (!ignore) {
          const msg = workflowErrorMessage(err, 'Failed to load order history.');
          message.error(msg);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };

    run();

    return () => {
      ignore = true;
    };
  }, [mounted, authLoading, isAuthenticated, activeTab, message]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: orders.length };
    orders.forEach((o) => {
      const norm = formatOrderStatus(o.orderStatus);
      counts[norm] = (counts[norm] || 0) + 1;
    });
    return counts;
  }, [orders]);

  const displayedOrders = useMemo(() => {
    if (!searchQuery.trim()) return orders;
    const q = searchQuery.trim().toLowerCase();
    return orders.filter((o) => {
      const matchCode = o.orderCode?.toLowerCase().includes(q);
      const matchShipment = (o.shipments?.[0]?.trackingNumber || o.shipment?.trackingNumber)?.toLowerCase().includes(q);
      const matchAddress = o.shippingAddress?.toLowerCase().includes(q);
      const matchItems = getOrderItems(o).some((it) => it.medicineName?.toLowerCase().includes(q));
      return matchCode || matchShipment || matchAddress || matchItems;
    });
  }, [orders, searchQuery]);

  const handleCancelOrder = async (targetOrderId?: number) => {
    const orderId = targetOrderId ?? orderToCancel?.id;
    if (!orderId) return;

    if (!cancelReason) {
      setCancelError('Please select a reason for cancellation.');
      message.error('Please select a cancellation reason.');
      return;
    }
    if (cancelReason === 'OTHER' && !cancelDetails.trim()) {
      setCancelError('Please provide details explaining your cancellation reason.');
      message.error('Choose a reason and provide details when selecting Other.');
      return;
    }

    setCancellingId(orderId);
    setCancelError(null);
    try {
      const res = await orderService.cancelMyOrder(
        orderId,
        cancelReason,
        cancelReason === 'OTHER' ? cancelDetails.trim() : cancelDetails.trim() || undefined
      );
      if (res?.success) {
        message.success('Order cancelled successfully.');
        closeCancelModal();
        reloadOrders();
        if (selectedOrder?.id === orderId) {
          setDetailModalOpen(false);
          setSelectedOrder(null);
        }
      } else {
        message.error(res?.message || 'Failed to cancel order.');
      }
    } catch (err: unknown) {
      const msg = workflowErrorMessage(err, 'Failed to cancel order.');
      message.error(msg);
      // The order may have changed since this screen loaded (for example it was packed); show its current state.
      closeCancelModal();
      reloadOrders();
      if (selectedOrder?.id === orderId) {
        setDetailModalOpen(false);
        setSelectedOrder(null);
      }
    } finally {
      setCancellingId(null);
    }
  };

  const handleReorder = (order: Order) => {
    if (formatOrderStatus(order.orderStatus) !== 'COMPLETED') {
      message.warning('You can only reorder items after your order has been delivered.');
      return;
    }
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
      <div className="py-24 flex items-center justify-center">
        <Spin size="large" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="w-full py-16 px-4">
        <div className="max-w-md mx-auto bg-white rounded-md p-8 border border-slate-200 shadow-sm text-center">
          <div className="w-12 h-12 rounded-md bg-blue-50 text-[#004996] flex items-center justify-center mx-auto mb-4 border border-blue-100">
            <User className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2 tracking-tight">Sign In Required</h2>
          <p className="text-slate-500 text-sm mb-6 leading-relaxed">
            Please sign in to view your orders, live delivery tracking, and purchase invoices.
          </p>
          <Link
            href="/login?redirect=/account/orders"
            className="inline-flex items-center justify-center w-full py-2.5 px-5 bg-[#004996] hover:bg-[#003875] text-white text-sm font-semibold rounded-md transition-colors shadow-xs"
          >
            Sign In to Continue
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full pb-16">
      <nav aria-label="Breadcrumb" className="mb-4">
        <div className="flex items-center text-xs sm:text-sm text-slate-500">
          <Link href="/" className="hover:text-slate-900 transition-colors font-medium">
            Home
          </Link>
          <ChevronRight className="w-3.5 h-3.5 mx-2 text-slate-400" />
          <span className="text-slate-900 font-semibold">My Orders</span>
        </div>
      </nav>

      <header className="mb-4 flex items-center justify-between gap-3 pb-3 border-b border-slate-200">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            My Orders
          </h1>
        </div>

        <div>
          <Link
            href="/cart"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-md text-xs font-semibold transition-colors shadow-xs"
          >
            <ShoppingBag className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#004996]" />
            Shopping Cart
          </Link>
        </div>
      </header>

      <div className="mb-4 flex items-center gap-2 sm:gap-3 pb-3 border-b border-slate-200">
        <div className="relative flex-1 min-w-0 sm:max-w-md">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 sm:left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search orders..."
            className="w-full pl-8 sm:pl-9 pr-7 sm:pr-8 h-9 text-xs sm:text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-[#004996] focus:border-[#004996] transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="shrink-0 w-42.5 sm:w-48">
          <Select
            value={activeTab}
            onChange={(val) => {
              setActiveTab(val);
              setLoading(true);
            }}
            labelRender={({ label }) => (
              <span className="flex items-center gap-1.5 text-xs">
                <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="font-semibold text-slate-900 truncate">{label}</span>
              </span>
            )}
            className="w-full h-9! [&_.ant-select-selector]:rounded-md! [&_.ant-select-selector]:border-slate-300! [&_.ant-select-selector]:min-h-9! [&_.ant-select-selector]:ps-2.5! [&_.ant-select-selector]:pe-5! [&_.ant-select-arrow]:right-2! [&_.ant-select-selection-item]:text-xs! [&_.ant-select-selection-item]:font-semibold!"
            popupMatchSelectWidth={false}
            options={STATUS_TABS.map((tab) => {
              const count = tab.status ? statusCounts[tab.status] : statusCounts.ALL;
              return {
                value: tab.key,
                label: `${tab.label}${typeof count === 'number' ? ` (${count})` : ''}`,
              };
            })}
          />
        </div>
      </div>

      {loading ? (
        <div className="py-24 text-center">
          <Spin size="large" />
          <p className="text-slate-400 text-xs mt-3 font-medium">Loading your orders...</p>
        </div>
      ) : orders.length === 0 ? (
        <div className="w-full bg-white rounded-md border border-slate-200 p-12 sm:p-16 text-center shadow-xs">
          <div className="w-12 h-12 rounded-md bg-slate-50 text-slate-400 border border-slate-200 flex items-center justify-center mx-auto mb-4">
            <ShoppingBag className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-900 mb-1">No Orders Found</h3>
          <p className="text-slate-500 text-xs sm:text-sm mb-6 leading-relaxed max-w-md mx-auto">
            {activeTab === 'ALL'
              ? 'You have not placed any orders yet. Discover our genuine verified healthcare products.'
              : `You currently have no orders matching the "${STATUS_TABS.find((t) => t.key === activeTab)?.label}" status.`}
          </p>
          <Link
            href="/products"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#004996] hover:bg-[#003875] text-white text-xs sm:text-sm font-semibold rounded-md transition-colors shadow-xs"
          >
            Explore Healthcare Catalog
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      ) : displayedOrders.length === 0 ? (
        <div className="w-full bg-white rounded-md border border-slate-200 p-10 sm:p-14 text-center shadow-xs">
          <h3 className="text-sm font-bold text-slate-900 mb-1">No Matching Orders</h3>
          <p className="text-slate-500 text-xs mb-4">
            No orders match your search &ldquo;{searchQuery}&rdquo;.
          </p>
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="px-4 py-1.5 text-xs font-semibold text-[#004996] bg-blue-50 hover:bg-blue-100 rounded-md transition-colors cursor-pointer"
          >
            Clear Search
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {displayedOrders.map((order) => {
            const shipment = order.shipments?.[0] || order.shipment;
            const orderItems = getOrderItems(order);
            const isExpanded = !!expandedOrders[order.id];
            const displayedItems = isExpanded ? orderItems : orderItems.slice(0, 1);

            return (
              <div
                key={order.id}
                className="bg-white rounded-md border border-slate-200 overflow-hidden shadow-xs hover:border-slate-300 transition-all"
              >
                <div className="p-4 bg-slate-50/70 border-b border-slate-200">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 text-xs min-w-0">
                      <div className="flex items-center gap-1.5 font-mono font-bold text-slate-900 text-xs sm:text-sm">
                        <Package className="w-3.5 h-3.5 text-[#004996] shrink-0" />
                        <span>{order.orderCode}</span>
                        <Tooltip title="Copy order code">
                          <button
                            type="button"
                            onClick={() => copyToClipboard(order.orderCode, 'Order code')}
                            className="text-slate-400 hover:text-slate-600 ml-0.5 cursor-pointer"
                          >
                            {copiedCode === order.orderCode ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </Tooltip>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-500">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{formatDateTime(order.createdAt)}</span>
                        </div>

                        {shipment?.trackingNumber && (
                          <div className="flex items-center gap-1.5 text-slate-600 font-mono">
                            <span className="text-slate-300 hidden sm:inline">•</span>
                            <Truck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span>{shipment.trackingNumber}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0 pt-0.5 text-right">
                      <OrderStatusBadge status={order.orderStatus} />
                    </div>
                  </div>
                </div>

                {order.prescriptionReviewStatus === 'PENDING_APPROVAL' && (
                  <div className="border-b border-blue-100 bg-blue-50 px-4 py-3 text-sm text-[#004996]">This order is waiting for a pharmacist at the preparing facility to review your prescription.</div>
                )}
                {order.prescriptionReviewStatus === 'REJECTED' && (
                  <div className="border-b border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">The prescription was rejected and this order was cancelled. <Link href="/account/prescriptions" className="font-semibold underline">View the review</Link>.</div>
                )}

                {formatOrderStatus(order.orderStatus) === 'WAITING_INTERNAL_TRANSFER' && (
                  <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex items-center gap-2.5 text-xs text-slate-700">
                    <RotateCw className="w-4 h-4 text-[#004996] shrink-0 animate-spin" />
                    <div className="flex-1 leading-relaxed">
                      <strong className="text-slate-900 font-semibold">Warehouse Consolidation in Progress:</strong>{' '}
                      Medications are transferring to <strong className="text-slate-900">{order.exportFacility?.facilityName || 'Primary Hub'}</strong> to combine your items into a single dispatch.
                    </div>
                  </div>
                )}

                <div className="p-4 sm:p-5 divide-y divide-slate-100">
                  {orderItems.length > 0 ? (
                    <>
                      {displayedItems.map((item, idx) => (
                        <div
                          key={item.id || idx}
                          className={`py-3 first:pt-0 ${orderItems.length === 1 || (!isExpanded && idx === 0) ? 'last:pb-0' : ''
                            } flex items-start sm:items-center justify-between gap-4`}
                        >
                          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                            <div className="w-14 h-14 rounded-sm border border-slate-200 bg-slate-50/50 flex items-center justify-center shrink-0 overflow-hidden p-1.5">
                              {item.medicine?.imageUrl || item.variant?.medicine?.images?.[0] ? (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img
                                  src={item.medicine?.imageUrl || item.variant?.medicine?.images?.[0]}
                                  alt={item.medicineName}
                                  className="w-full h-full object-contain"
                                />
                              ) : (
                                <Package className="w-6 h-6 text-slate-300" />
                              )}
                            </div>

                            <div className="min-w-0">
                              <h4 className="text-sm font-semibold text-slate-900 line-clamp-1">
                                {item.medicineName}
                              </h4>
                              <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-500">
                                <span className="font-semibold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-sm border border-slate-200">
                                  {item.unitName}
                                </span>
                                <span>Quantity: {item.quantity}</span>
                              </div>
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <div className="text-sm font-bold text-slate-900">
                              {formatCurrency(item.totalPrice)}
                            </div>
                            <div className="text-xs text-slate-400 mt-0.5">
                              {formatCurrency(item.unitPrice)} / {item.unitName}
                            </div>
                          </div>
                        </div>
                      ))}

                      {orderItems.length > 1 && (
                        <div className="pt-3 flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => toggleOrderExpand(order.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#004996] bg-blue-50/80 hover:bg-blue-100 rounded-sm transition-colors cursor-pointer"
                          >
                            {isExpanded ? (
                              <>
                                <span>Show fewer items</span>
                                <ChevronUp className="w-3.5 h-3.5" />
                              </>
                            ) : (
                              <>
                                <span>View all {orderItems.length} items</span>
                                <ChevronDown className="w-3.5 h-3.5" />
                              </>
                            )}
                          </button>
                          <span className="text-xs text-slate-400 font-medium">
                            {orderItems.length} products total
                          </span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-xs text-slate-400 italic py-2">No product line items recorded.</div>
                  )}
                </div>

                <div className="p-4 bg-slate-50/50 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="text-xs text-slate-600 space-y-1">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="font-medium text-slate-700 truncate max-w-md">
                        {order.shippingAddress || 'Standard Shipping Address'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-slate-500">
                      <span className="flex items-center gap-1">
                        <Phone className="w-3 h-3 text-slate-400" />
                        {order.recipientPhone || '—'}
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <CreditCard className="w-3 h-3 text-slate-400" />
                        {formatPaymentMethod(order.paymentMethod)}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between sm:justify-end gap-4 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-200">
                    <div className="text-left sm:text-right">
                      <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">
                        Order Total
                      </span>
                      <span className="text-lg font-bold text-slate-900">
                        {formatCurrency(order.totalAmount)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">

                      <button
                        type="button"
                        disabled={loadingDetailId !== null}
                        aria-busy={loadingDetailId === order.id}
                        onClick={async () => {
                          setLoadingDetailId(order.id);
                          try {
                            const response = await orderService.getMyOrderById(order.id);
                            setSelectedOrder(response.data);
                            setDetailModalOpen(true);
                          } catch (err: unknown) {
                            const msg = workflowErrorMessage(err, 'Unable to load order details.');
                            message.error(msg);
                          } finally {
                            setLoadingDetailId(null);
                          }
                        }}
                        className="px-3.5 py-1.5 sm:px-4 sm:py-2 bg-transparent hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                      >
                        <Eye className="w-3.5 h-3.5 text-slate-500" />
                        <span>{loadingDetailId === order.id ? 'Loading...' : 'View Details'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        title={
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 pr-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-sm bg-blue-50 text-[#004996] flex items-center justify-center border border-blue-100">
                <Package className="w-4 h-4" />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <span>Order: {selectedOrder?.orderCode}</span>
                  {selectedOrder?.orderCode && (
                    <button
                      type="button"
                      onClick={() => copyToClipboard(selectedOrder.orderCode, 'Order code')}
                      className="text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      {copiedCode === selectedOrder.orderCode ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>
                <div className="text-xs text-slate-500">
                  Placed on {selectedOrder?.createdAt ? formatDateTime(selectedOrder.createdAt) : '—'}
                </div>
              </div>
            </div>

            <div>
              {selectedOrder && <OrderStatusBadge status={selectedOrder.orderStatus} />}
            </div>
          </div>
        }
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        footer={null}
        width={760}
        style={{ top: 24 }}
        className="[&_.ant-modal-content]:rounded-md! [&_.ant-modal-content]:p-6!"
      >
        {selectedOrder && (
          <div className="space-y-6 pt-3 text-slate-700 max-h-[calc(85vh-90px)] overflow-y-auto pr-1">
            {selectedOrder.prescriptionReviewStatus === 'PENDING_APPROVAL' && (
              <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-xs sm:text-sm text-[#004996]">
                This order is waiting for a pharmacist at the preparing facility to review your prescription.
              </div>
            )}
            {selectedOrder.prescriptionReviewStatus === 'REJECTED' && (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-xs sm:text-sm text-red-800">
                The prescription was rejected and this order was cancelled.{' '}
                <Link href="/account/prescriptions" className="font-semibold underline">
                  View the review
                </Link>
                .
              </div>
            )}

            <OrderTrackingTimeline
              status={selectedOrder.orderStatus}
              cancellationReason={selectedOrder.cancellationReason}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-50/70 border border-slate-200 rounded-md p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-900 uppercase tracking-wider">
                  <MapPin className="w-4 h-4 text-[#004996]" />
                  <span>Delivery Address</span>
                </div>
                <div className="text-sm font-bold text-slate-900">{selectedOrder.recipientName || 'Customer'}</div>
                <div className="text-xs text-slate-600 flex items-center gap-1.5">
                  <Phone className="w-3 h-3 text-slate-400" />
                  <span>{selectedOrder.recipientPhone || 'No phone provided'}</span>
                </div>
                <div className="text-xs text-slate-600 leading-relaxed pt-1">
                  {selectedOrder.shippingAddress || 'Address on file'}
                </div>
                {selectedOrder.note && selectedOrder.note !== selectedOrder.cancellationReason && (
                  <div className="text-xs text-slate-600 pt-2 border-t border-slate-200">
                    <span className="font-semibold text-slate-700">Customer Note:</span> &ldquo;{selectedOrder.note}&rdquo;
                  </div>
                )}
              </div>

              <div className="bg-slate-50/70 border border-slate-200 rounded-md p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-900 uppercase tracking-wider">
                  <Truck className="w-4 h-4 text-[#004996]" />
                  <span>Shipment & Logistics</span>
                </div>
                {(() => {
                  const sh = selectedOrder.shipments?.[0] || selectedOrder.shipment;
                  return (
                    <div className="space-y-2.5 text-xs pt-0.5">
                      <div className="flex items-start gap-2">
                        <span className="text-slate-500 w-28 shrink-0 whitespace-nowrap">Tracking Code:</span>
                        <span className="font-mono font-semibold text-slate-900 break-all">
                          {sh?.trackingNumber || 'Awaiting assignment'}
                        </span>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="text-slate-500 w-28 shrink-0 whitespace-nowrap">Fulfillment Hub:</span>
                        <span className="font-medium text-slate-800 leading-snug">
                          {selectedOrder.exportFacility?.facilityName || 'Primary Regional Hub'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 w-28 shrink-0 whitespace-nowrap">Carrier Status:</span>
                        <span className={`font-bold ${getCarrierStatusClass(sh?.shippingStatus)}`}>
                          {sh?.shippingStatus || 'In Processing'}
                        </span>
                      </div>
                      {sh?.shippedAt && (
                        <div className="flex items-start gap-2">
                          <span className="text-slate-500 w-28 shrink-0 whitespace-nowrap">Dispatched At:</span>
                          <span className="text-slate-700">{formatDateTime(sh.shippedAt)}</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>

            {((selectedOrder.internalTransfers && selectedOrder.internalTransfers.length > 0) ||
              formatOrderStatus(selectedOrder.orderStatus) === 'WAITING_INTERNAL_TRANSFER') && (
                <div className="space-y-2.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                    <div>
                      <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-[#004996]" />
                        <span>Internal Warehouse Transfers</span>
                      </h4>
                      <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                        Your order is being consolidated from partner facilities before shipping to ensure safe delivery in one package.
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 shrink-0 self-start sm:self-center">
                      <span className="text-slate-400">Target Hub:</span>
                      <span className="font-semibold text-slate-800">
                        {selectedOrder.exportFacility?.facilityName || 'Central Hub'}
                      </span>
                    </div>
                  </div>

                  <div className="border border-slate-200 rounded-md overflow-hidden divide-y divide-slate-100 bg-white shadow-xs">
                    {selectedOrder.internalTransfers && selectedOrder.internalTransfers.length > 0 ? (
                      selectedOrder.internalTransfers.map((tf) => (
                        <div
                          key={tf.id}
                          className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                        >
                          <div className="space-y-1.5 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono font-semibold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded text-[11px] border border-slate-200/80">
                                {tf.transferCode}
                              </span>
                              <div className="flex items-center gap-1.5 text-xs text-slate-700">
                                <span className="text-slate-400">From</span>
                                <strong className="font-semibold text-slate-900">
                                  {tf.fromFacilityName || `Facility #${tf.fromFacilityId}`}
                                </strong>
                                <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                <span className="text-slate-400">To</span>
                                <strong className="font-semibold text-slate-900">
                                  {tf.toFacilityName || `Facility #${tf.toFacilityId}`}
                                </strong>
                              </div>
                            </div>
                            <div className="flex items-center gap-3 text-[11px] text-slate-400">
                              <span>Distance: <span className="text-slate-600 font-medium">{tf.distanceKm} km</span></span>
                              <span>•</span>
                              <span>Est. transit: <span className="text-slate-600 font-medium">~{tf.estimatedHours}h</span></span>
                            </div>
                          </div>

                          <div className="shrink-0 self-start sm:self-center">
                            <span
                              className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                                tf.status === 'RECEIVED'
                                  ? 'text-emerald-700'
                                  : tf.status === 'DISPATCHED'
                                    ? 'text-blue-700'
                                    : 'text-amber-800'
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  tf.status === 'RECEIVED'
                                    ? 'bg-emerald-500'
                                    : tf.status === 'DISPATCHED'
                                      ? 'bg-blue-500'
                                      : 'bg-amber-500'
                                }`}
                              />
                              {tf.status === 'RECEIVED'
                                ? 'Consolidated at Hub'
                                : tf.status === 'DISPATCHED'
                                  ? 'In Transfer'
                                  : 'Transfer Pending'}
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="p-3.5 text-xs text-slate-500 bg-slate-50/50">
                        Consolidation dispatch schedules are being prepared.
                      </div>
                    )}
                  </div>
                </div>
              )}

            {(() => {
              const modalItems = getOrderItems(selectedOrder);
              return (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                      <Package className="w-4 h-4 text-[#004996]" />
                      <span>Items in this Order ({modalItems.length})</span>
                    </h4>
                  </div>
                  <div className="border border-slate-200 rounded-md overflow-hidden divide-y divide-slate-100">
                    {modalItems.map((item) => (
                      <div key={item.id} className="p-3.5 bg-white flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-12 h-12 rounded-sm border border-slate-200 bg-slate-50 flex items-center justify-center shrink-0 overflow-hidden p-1">
                            {item.medicine?.imageUrl || item.variant?.medicine?.images?.[0] ? (
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img
                                src={item.medicine?.imageUrl || item.variant?.medicine?.images?.[0]}
                                alt={item.medicineName}
                                className="w-full h-full object-contain"
                              />
                            ) : (
                              <Package className="w-5 h-5 text-slate-300" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-900 truncate">
                              {item.medicineName}
                            </div>
                            <div className="text-xs text-slate-500 flex flex-wrap items-center gap-2 mt-0.5">
                              <span className="font-medium bg-slate-100 text-slate-700 px-1.5 py-0.2 rounded-sm text-[11px]">
                                {item.unitName}
                              </span>
                              <span>× {item.quantity}</span>
                              <span>({formatCurrency(item.unitPrice)} each)</span>
                            </div>
                          </div>
                        </div>
                        <div className="text-sm font-bold text-slate-900 shrink-0 text-right">
                          {formatCurrency(item.totalPrice)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {(() => {
              const voucherDiscount =
                selectedOrder.voucherDiscount !== undefined
                  ? selectedOrder.voucherDiscount
                  : Math.max(0, (selectedOrder.discountAmount || 0) - (selectedOrder.usedPoints || 0));
              const pointsDiscount = selectedOrder.pointsDiscount ?? (selectedOrder.usedPoints || 0);

              return (
                <div className="bg-slate-50/70 border border-slate-200 rounded-md p-4 space-y-2 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Subtotal:</span>
                    <span className="font-semibold text-slate-900">
                      {formatCurrency(selectedOrder.subtotalAmount)}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Shipping Fee:</span>
                    <span className="font-semibold text-slate-900">
                      {selectedOrder.shippingFee === 0 ? 'FREE' : formatCurrency(selectedOrder.shippingFee)}
                    </span>
                  </div>
                  {voucherDiscount > 0 && (
                    <div className="flex justify-between text-[#004996] font-medium">
                      <span>Voucher Discount:</span>
                      <span>-{formatCurrency(voucherDiscount)}</span>
                    </div>
                  )}
                  {selectedOrder.usedPoints > 0 && (
                    <div className="flex justify-between text-amber-800 font-medium">
                      <span>Loyalty Points Redeemed ({selectedOrder.usedPoints} pts):</span>
                      <span>-{formatCurrency(pointsDiscount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-baseline pt-3 border-t border-slate-200">
                    <div>
                      <span className="text-xs font-bold text-slate-900 block">Total Amount</span>
                      <span className="text-[11px] text-slate-400">
                        {formatPaymentMethod(selectedOrder.paymentMethod)}
                      </span>
                    </div>
                    <span className="text-xl font-bold text-slate-900">
                      {formatCurrency(selectedOrder.totalAmount)}
                    </span>
                  </div>
                </div>
              );
            })()}

            <div className="pt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200">
              <div>
                <button
                  type="button"
                  onClick={() => setDetailModalOpen(false)}
                  className="px-4 py-2 bg-[#F3F4F6] hover:bg-surface-border text-[#374151] rounded-md text-xs font-semibold transition-colors cursor-pointer border border-surface-border"
                >
                  Close
                </button>
              </div>

              <div className="flex items-center gap-2.5">
                {['PENDING', 'WAITING_INTERNAL_TRANSFER', 'PROCESSING'].includes(formatOrderStatus(selectedOrder.orderStatus)) && !selectedOrder.shipment && (
                  <button
                    type="button"
                    onClick={() => openCancelModal(selectedOrder)}
                    className="px-4 py-2 bg-medical-red hover:bg-[#DC2626] text-white rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <XCircle className="w-3.5 h-3.5 text-white" />
                    <span>Cancel Order</span>
                  </button>
                )}

                {formatOrderStatus(selectedOrder.orderStatus) === 'COMPLETED' && (
                  <button
                    type="button"
                    onClick={() => handleReorder(selectedOrder)}
                    className="px-4 py-2 bg-[#004996] hover:bg-[#003875] text-white rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-white" />
                    Reorder
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Cancel Order Modal */}
      <Modal
        open={cancelModalOpen}
        onCancel={closeCancelModal}
        footer={null}
        width={540}
        centered
        destroyOnHidden
        className="[&_.ant-modal-content]:p-0! [&_.ant-modal-content]:overflow-hidden! [&_.ant-modal-content]:rounded-2xl!"
      >
        {orderToCancel && (
          <div className="flex flex-col">
            {/* Modal Header */}
            <div className="px-6 pt-5 pb-4 border-b border-slate-100 flex items-start justify-between bg-linear-to-b from-red-50/50 via-white to-white">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-100/70 border border-red-200/80 flex items-center justify-center text-medical-red shrink-0 shadow-2xs">
                  <AlertTriangle className="w-5 h-5 text-medical-red" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 leading-snug">
                    Cancel Order
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                      {orderToCancel.orderCode}
                    </span>
                    <span>•</span>
                    <span>Placed {formatDateTime(orderToCancel.createdAt)}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeCancelModal}
                disabled={cancellingId !== null}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-40 cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5 max-h-[calc(85vh-140px)] overflow-y-auto">
              {/* Warning Notice Banner */}
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 flex items-start gap-3">
                <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-900 leading-relaxed">
                  <span className="font-bold">Cancellation is final and cannot be undone.</span> Once cancelled, reserved pharmaceutical stock ({formatCurrency(orderToCancel.totalAmount)}) will be immediately restored to pharmacy inventory.
                </div>
              </div>

              {/* Reasons Selection List */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2.5">
                  Select a reason for cancellation <span className="text-medical-red">*</span>
                </label>
                <div className="space-y-2.5">
                  {CANCELLATION_REASONS.map((reason) => {
                    const isSelected = cancelReason === reason.value;
                    const IconComp = reason.icon;
                    return (
                      <div
                        key={reason.value}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setCancelReason(reason.value);
                          setCancelError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setCancelReason(reason.value);
                            setCancelError(null);
                          }
                        }}
                        className={`w-full flex items-start gap-3.5 p-3.5 rounded-xl border text-left cursor-pointer transition-all duration-150 ${
                          isSelected
                            ? 'border-medical-red bg-red-50/30 ring-1 ring-medical-red/20 shadow-2xs'
                            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60'
                        }`}
                      >
                        <div className="mt-0.5 shrink-0">
                          <div
                            className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                              isSelected ? 'border-medical-red bg-white' : 'border-slate-300 bg-white'
                            }`}
                          >
                            {isSelected && <div className="w-2 h-2 rounded-full bg-medical-red" />}
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <IconComp className={`w-4 h-4 ${isSelected ? 'text-medical-red' : 'text-slate-500'}`} />
                            <span className={`text-sm font-semibold ${isSelected ? 'text-slate-900' : 'text-slate-800'}`}>
                              {reason.label}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-1 leading-normal">
                            {reason.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Other Details Field (Required when OTHER is selected) */}
              {cancelReason === 'OTHER' && (
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <label htmlFor="cancel-other-details" className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                      <span>Detailed Reason</span>
                      <span className="text-medical-red">*</span>
                    </label>
                    <span
                      className={`text-[11px] font-mono font-medium ${
                        cancelDetails.length >= 480
                          ? 'text-medical-red font-bold'
                          : cancelDetails.length >= 400
                          ? 'text-amber-600'
                          : 'text-slate-400'
                      }`}
                    >
                      {cancelDetails.length}/500
                    </span>
                  </div>

                  <textarea
                    id="cancel-other-details"
                    value={cancelDetails}
                    onChange={(e) => {
                      setCancelDetails(e.target.value.slice(0, 500));
                      if (cancelError) setCancelError(null);
                    }}
                    rows={3}
                    maxLength={500}
                    placeholder="Please specify why you are cancelling this order (required)..."
                    className={`w-full rounded-xl border p-3 text-sm text-slate-800 placeholder:text-slate-400 bg-white transition-all resize-y min-h-24 outline-none ${
                      cancelError && !cancelDetails.trim()
                        ? 'border-red-400 ring-2 ring-red-200'
                        : 'border-slate-300 focus:border-medical-red focus:ring-3 focus:ring-medical-red/15'
                    }`}
                  />

                  {/* Quick suggestion chips */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span className="text-[11px] text-slate-400 flex items-center gap-1 mr-0.5">
                      <HelpCircle className="w-3 h-3 text-slate-400" />
                      Quick suggestions:
                    </span>
                    {QUICK_CANCEL_CHIPS.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => {
                          setCancelDetails((prev) => {
                            if (!prev.trim()) return chip;
                            if (prev.includes(chip)) return prev;
                            return `${prev.trim()}; ${chip}`.slice(0, 500);
                          });
                          if (cancelError) setCancelError(null);
                        }}
                        className="text-[11px] px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-md transition-colors cursor-pointer border border-slate-200"
                      >
                        + {chip}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Inline Error Message */}
              {cancelError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-medical-red shrink-0" />
                  <span>{cancelError}</span>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 bg-slate-50/80 border-t border-slate-200 flex items-center justify-end gap-3">
              <button
                type="button"
                disabled={cancellingId !== null}
                onClick={closeCancelModal}
                className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-md transition-colors cursor-pointer border border-slate-300 bg-white disabled:opacity-50"
              >
                Keep Order
              </button>
              <button
                type="button"
                disabled={cancellingId !== null || !cancelReason || (cancelReason === 'OTHER' && !cancelDetails.trim())}
                onClick={() => handleCancelOrder()}
                className="px-4 py-2 bg-medical-red hover:bg-[#DC2626] text-white rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {cancellingId !== null ? (
                  <>
                    <RotateCw className="w-3.5 h-3.5 animate-spin text-white" />
                    <span>Cancelling Order...</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-3.5 h-3.5 text-white" />
                    <span>Yes, Cancel Order</span>
                  </>
                )}
              </button>
            </div>
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
        <div className="py-24 flex items-center justify-center">
          <Spin size="large" />
        </div>
      }
    >
      <CustomerOrdersContent />
    </Suspense>
  );
}
