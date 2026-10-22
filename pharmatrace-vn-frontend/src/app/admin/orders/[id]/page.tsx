'use client';

import React, { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  Button as AButton,
  Tag,
  App,
  Spin,
  Modal,
  Input,
} from 'antd';
import {
  ArrowLeftOutlined,
  ScanOutlined,
  SwapOutlined,
  CheckCircleOutlined,
  CheckCircleFilled,
  SendOutlined,
  ExclamationCircleOutlined,
  EnvironmentOutlined,
  RightOutlined,
  SafetyCertificateOutlined,
  FileImageOutlined,
  CloseCircleOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import { prescriptionService } from '@/services/prescription.service';
import {
  orderService,
  Order,
  getOrderItems,
  getOrderItemCount,
} from '@/services/order.service';
import { OrderStatusBadge } from '@/components/ui/Badge';
import { formatCurrency, formatDateTime } from '@/utils';
import { OrderPackingModal } from '@/components/shared/OrderPackingModal';
import styles from './page.module.css';

interface Props {
  params: Promise<{ id: string }>;
}

export default function AdminOrderDetailPage({ params }: Props) {
  const resolvedParams = use(params);
  const orderId = Number(resolvedParams.id);
  const router = useRouter();
  const { message, modal } = App.useApp();

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [fulfillOpen, setFulfillOpen] = useState(false);
  const [prescriptionImageUrl, setPrescriptionImageUrl] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [activeReviewId, setActiveReviewId] = useState<number | null>(null);

  useEffect(() => {
    if (order?.prescriptionReview?.id) {
      setActiveReviewId(order.prescriptionReview.id);
    }
  }, [order?.prescriptionReview?.id]);

  useEffect(() => () => {
    if (prescriptionImageUrl) URL.revokeObjectURL(prescriptionImageUrl);
  }, [prescriptionImageUrl]);

  useEffect(() => {
    if (!orderId) return;
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      void orderService.getAdminById(orderId)
        .then((data) => { if (active) setOrder(data); })
        .catch((err) => { if (active) message.error(err?.message || 'Failed to load order'); })
        .finally(() => { if (active) setLoading(false); });
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [orderId, message]);

  const handleShip = async () => {
    if (!order) return;
    setUpdating(true);
    try {
      await orderService.shipOrder(order.id);
      message.success('Delivery started.');
      const updated = await orderService.getAdminById(order.id);
      setOrder(updated);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to start delivery');
    } finally {
      setUpdating(false);
    }
  };

  const handleComplete = async () => {
    if (!order) return;
    setUpdating(true);
    try {
      await orderService.completeOrder(order.id);
      message.success('Order delivery confirmed complete.');
      const updated = await orderService.getAdminById(order.id);
      setOrder(updated);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to complete order');
    } finally {
      setUpdating(false);
    }
  };

  const handleDispatchTransfer = async (transferId: number) => {
    setUpdating(true);
    try {
      await orderService.dispatchInternalTransfer(transferId);
      message.success('Internal transfer marked as dispatched.');
      const updated = await orderService.getAdminById(orderId);
      setOrder(updated);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to dispatch transfer');
    } finally {
      setUpdating(false);
    }
  };

  const handleReceiveTransfer = async (transferId: number) => {
    setUpdating(true);
    try {
      await orderService.receiveInternalTransfer(transferId);
      message.success('Internal transfer received! Stock transferred to export hub.');
      const updated = await orderService.getAdminById(orderId);
      setOrder(updated);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to receive transfer');
    } finally {
      setUpdating(false);
    }
  };

  const handleRejectDamagedTransfer = (transferId: number) => {
    modal.confirm({
      title: 'Reject damaged shipment?',
      content: 'The damaged stock will be removed from available inventory. If the source has enough stock, a replacement transfer will be created automatically; otherwise the order will stay on hold for a manager to choose another warehouse or cancel it.',
      okText: 'Reject and replace',
      okButtonProps: { danger: true },
      async onOk() {
        setUpdating(true);
        try {
          await orderService.rejectDamagedInternalTransfer(transferId);
          message.success('Damaged shipment recorded. Check the transfer status for the next action.');
          setOrder(await orderService.getAdminById(orderId));
        } catch (err) {
          message.error(err instanceof Error ? err.message : 'Failed to replace damaged transfer');
        } finally {
          setUpdating(false);
        }
      },
    });
  };

  const handleOpenDetailModal = async () => {
    setDetailOpen(true);
    let reviewId = activeReviewId || order?.prescriptionReview?.id;

    if (!reviewId && order?.id) {
      try {
        const queueRes = await prescriptionService.queue();
        const found = queueRes.data.items.find((item) => item.orderId === order.id);
        if (found) {
          reviewId = found.id;
          setActiveReviewId(found.id);
        }
      } catch {
        // Fallback catch
      }
    }

    if (reviewId && !prescriptionImageUrl) {
      setImageLoading(true);
      try {
        const blob = await prescriptionService.adminImage(reviewId);
        setPrescriptionImageUrl(URL.createObjectURL(blob));
      } catch (err) {
        message.error(err instanceof Error ? err.message : 'Could not load prescription image');
      } finally {
        setImageLoading(false);
      }
    }
  };

  const handleApprovePrescription = async () => {
    const reviewId = activeReviewId || order?.prescriptionReview?.id;
    if (!reviewId) return;
    setReviewing(true);
    try {
      await prescriptionService.approve(reviewId);
      message.success('Prescription approved. Order is ready for packaging.');
      setDetailOpen(false);
      const updated = await orderService.getAdminById(orderId);
      setOrder(updated);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to approve prescription');
    } finally {
      setReviewing(false);
    }
  };

  const handleRejectPrescription = async () => {
    const reviewId = activeReviewId || order?.prescriptionReview?.id;
    if (!reviewId) return;
    if (!rejectReason.trim()) {
      message.error('Please enter a rejection reason.');
      return;
    }
    setReviewing(true);
    try {
      await prescriptionService.reject(reviewId, rejectReason.trim());
      message.success('Prescription rejected and order cancelled.');
      setRejectModalOpen(false);
      setDetailOpen(false);
      setRejectReason('');
      const updated = await orderService.getAdminById(orderId);
      setOrder(updated);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to reject prescription');
    } finally {
      setReviewing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spin size="large" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="text-slate-500 py-16 text-center space-y-3">
        <p>Order not found.</p>
        <AButton onClick={() => router.push('/admin/orders')}>
          Back to Orders
        </AButton>
      </div>
    );
  }

  const items = getOrderItems(order);
  const itemsCount = getOrderItemCount(order);
  const normStatus = (order.orderStatus || '').toUpperCase();
  const canPack = ['PENDING', 'PROCESSING'].includes(normStatus) && (!order.prescriptionReviewStatus || order.prescriptionReviewStatus === 'APPROVED');
  const rxItems = items.filter((item) => item.medicine?.isPrescription);
  const hasPrescription = Boolean(order.prescriptionReview || order.prescriptionId || order.prescriptionReviewStatus || rxItems.length > 0);
  const rxStatus = order.prescriptionReview?.status || order.prescriptionReviewStatus || (hasPrescription ? 'PENDING_APPROVAL' : null);

  return (
    <div className={styles.page}>
      <button className={styles.backLink} onClick={() => router.push('/admin/orders')}>
        <ArrowLeftOutlined aria-hidden /> Orders
      </button>
      <header className={styles.header}>
        <div>
          <div className={styles.titleRow}><h1>Order #{order.id}</h1><OrderStatusBadge status={order.orderStatus} /></div>
          <p className={styles.orderMeta}>{order.orderCode}<span>Placed {formatDateTime(order.createdAt)}</span></p>
        </div>
        <div className={styles.actions}>
          {canPack && <AButton type="primary" size="large" icon={<ScanOutlined aria-hidden />} onClick={() => setFulfillOpen(true)}>Pack & scan QR</AButton>}
          {(normStatus === 'PROCESSING' || normStatus === 'DADONGGOI') && <AButton size="large" loading={updating} onClick={handleShip}>Start delivery</AButton>}
          {(normStatus === 'SHIPPING' || normStatus === 'DANGGIAO') && <AButton type="primary" size="large" loading={updating} onClick={handleComplete}>Confirm delivery</AButton>}
        </div>
      </header>

      {normStatus === 'WAITING_INTERNAL_TRANSFER' && (
        <div className={styles.notice}>
          <ExclamationCircleOutlined aria-hidden />
          <div><strong>Waiting for warehouse transfer</strong><p>Items must arrive at {order.exportFacility?.facilityName || 'the export warehouse'} before packing can begin.</p></div>
        </div>
      )}

      <div className={styles.orderSheet}>
        <section className={styles.lineItems} aria-labelledby="order-items-heading">
          <div className={styles.sectionHeading}><h2 id="order-items-heading">Order items</h2><span>{itemsCount} item{itemsCount === 1 ? '' : 's'}</span></div>
          <div className={styles.itemList}>
            {items.map((item) => (
              <article key={item.id} className={styles.item}>
                <div className={styles.productImage}>
                  {item.medicine?.imageUrl ? <Image src={item.medicine.imageUrl} alt="" width={72} height={72} unoptimized /> : <span>No image</span>}
                </div>
                <div className={styles.productInfo}>
                  <h3>{item.medicineName}</h3>
                  {item.medicine?.isPrescription && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#004996]">
                      <span className="font-serif italic font-bold">℞</span> Prescription Medicine
                    </span>
                  )}
                  <p>{item.unitName || 'Unit'}<span>Quantity: {item.quantity}</span></p>
                  <p className={styles.warehouse}>{item.sourceFacilityName || order.exportFacility?.facilityName || 'Warehouse not assigned'}</p>
                  <span className={styles.unitPrice}>{formatCurrency(item.unitPrice)} each</span>
                </div>
                <strong className={styles.itemPrice}>{formatCurrency(item.totalPrice || item.unitPrice * item.quantity)}</strong>
              </article>
            ))}
          </div>
          <dl className={styles.totals}>
            <div><dt>Items subtotal</dt><dd>{formatCurrency(order.subtotalAmount)}</dd></div>
            <div><dt>Shipping</dt><dd>{formatCurrency(order.shippingFee)}</dd></div>
            {order.discountAmount > 0 && <div><dt>Discount</dt><dd>−{formatCurrency(order.discountAmount)}</dd></div>}
            {order.usedPoints > 0 && <div><dt>Points redeemed</dt><dd>−{formatCurrency(order.usedPoints)}</dd></div>}
            <div className={styles.total}><dt>Order total</dt><dd>{formatCurrency(order.totalAmount)}</dd></div>
          </dl>
        </section>

        <aside className={styles.delivery}>
          <section>
            <h2>Delivery details</h2>
            <p className={styles.recipient}>{order.recipientName || order.customer?.fullName || 'Customer'}</p>
            {(order.recipientPhone || order.customer?.phone) && <a href={`tel:${order.recipientPhone || order.customer?.phone}`}>{order.recipientPhone || order.customer?.phone}</a>}
            <p className={styles.address}>{order.shippingAddress || 'No delivery address'}</p>
            {order.customer?.email && <a className={styles.email} href={`mailto:${order.customer.email}`}>{order.customer.email}</a>}
          </section>
          <section>
            <h2>Payment</h2>
            <div className={styles.paymentRow}>
              <span className={styles.paymentMethod}>{order.paymentMethod?.replaceAll('_', ' ') || 'COD'}</span>
              <span
                className={
                  order.paymentStatus === 'PAID'
                    ? styles.paymentStatusPaid
                    : order.paymentStatus === 'REFUNDED'
                      ? styles.paymentStatusRefunded
                      : styles.paymentStatusAwaiting
                }
              >
                {order.paymentStatus === 'PAID' ? 'Paid' : order.paymentStatus === 'REFUNDED' ? 'Refunded' : 'Awaiting payment'}
              </span>
            </div>
          </section>
          <section>
            <h2>Dispatch warehouse</h2>
            <p>{order.exportFacility?.facilityName || items[0]?.sourceFacilityName || 'Not assigned'}</p>
          </section>
          {order.note && <section><h2>Order note</h2><p>{order.note}</p></section>}
        </aside>
      </div>

      {/* Dedicated Prescription Review Section */}
      {hasPrescription && (
        <section
          className={styles.prescriptionSection}
          aria-labelledby="prescription-review-heading"
        >
          <div className={styles.prescriptionHeader}>
            <div className={styles.prescriptionTitleGroup}>
              <h2 id="prescription-review-heading">
                <SafetyCertificateOutlined aria-hidden /> Prescription Review
              </h2>
            </div>
            <div>
              {rxStatus === 'APPROVED' && (
                <span className="inline-flex items-center text-xs font-semibold text-emerald-700 px-2.5 py-0.5">
                  Approved
                </span>
              )}
              {rxStatus === 'REJECTED' && (
                <span className="inline-flex items-center text-xs font-semibold text-rose-700 px-2.5 py-0.5">
                  Rejected
                </span>
              )}
              {rxStatus === 'PENDING_APPROVAL' && (
                <span className="inline-flex items-center text-xs font-semibold text-amber-700 px-2.5 py-0.5">
                  Pending Approval
                </span>
              )}
            </div>
          </div>

          <div className={styles.prescriptionBody}>
            {rxStatus === 'PENDING_APPROVAL' && (
              <p className={styles.prescriptionNoticeText}>
                This order contains prescription medication. A licensed pharmacist at this facility must inspect and verify the customer&apos;s uploaded prescription before warehouse packing and dispatch can proceed.
              </p>
            )}

            <div className={styles.prescriptionMetaBar}>
              <div className={styles.metaDocCol}>
                <span className={styles.metaLabel}>Prescription Document</span>
                <span className={styles.metaValue}>
                  #{order.prescriptionId || order.prescriptionReview?.prescriptionId || order.id} (Customer uploaded)
                </span>
              </div>

              <div className={styles.metaDrugsCol}>
                <span className={styles.metaLabel}>Regulated Drugs</span>
                <span className={styles.metaValue}>
                  {rxItems.map((i) => `${i.medicineName} (x${i.quantity})`).join(', ')}
                </span>
              </div>

              {order.prescriptionReview?.pharmacistName && (
                <div className={styles.metaReviewerCol}>
                  <span className={styles.metaLabel}>Verified Pharmacist</span>
                  <span className={styles.metaValue}>
                    {order.prescriptionReview.pharmacistName} · {formatDateTime(order.prescriptionReview.reviewedAt)}
                  </span>
                </div>
              )}

              {order.prescriptionReview?.note && (
                <div className={styles.metaNoteCol}>
                  <span className={styles.metaLabel}>
                    {rxStatus === 'REJECTED' ? 'Rejection Reason' : 'Review Note'}
                  </span>
                  <span className={rxStatus === 'REJECTED' ? styles.metaRejectValue : styles.metaValue}>
                    {order.prescriptionReview.note}
                  </span>
                </div>
              )}

              <div className={styles.metaActionCol}>
                <AButton
                  icon={<EyeOutlined />}
                  loading={imageLoading}
                  onClick={handleOpenDetailModal}
                  className="!text-xs !font-medium !text-slate-700 hover:!text-[#004996] hover:!border-[#004996] !rounded-[6px]"
                >
                  Detail
                </AButton>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Internal Warehouse Transfers */}
      {order.internalTransfers && order.internalTransfers.length > 0 && (
        <section className={styles.transfersSection} aria-labelledby="transfers-heading">
          <div className={styles.transfersHeader}>
            <div className={styles.transfersTitleGroup}>
              <h2 id="transfers-heading">
                <SwapOutlined aria-hidden /> Internal Warehouse Transfers
              </h2>
              <span className={styles.transfersCount}>
                {order.internalTransfers.length} {order.internalTransfers.length === 1 ? 'transfer' : 'transfers'}
              </span>
            </div>
            <div className={styles.consolidationHub}>
              <span>Consolidation Hub:</span>
              <strong>{order.exportFacility?.facilityName || 'Primary Hub'}</strong>
            </div>
          </div>

          <div className={styles.transferList}>
            {order.internalTransfers.map((tf) => {
              const status = tf.status;
              const statusClass =
                status === 'RECEIVED'
                  ? styles.statusReceived
                  : status === 'DISPATCHED'
                    ? styles.statusDispatched
                    : status === 'CANCELLED' || status === 'REPLACED' || status === 'REJECTED_UNFULFILLED'
                      ? styles.statusCancelled
                      : styles.statusRequested;

              const statusText =
                status === 'RECEIVED'
                  ? 'Received at Hub'
                  : status === 'DISPATCHED'
                    ? 'In Transit'
                    : status === 'CANCELLED'
                      ? 'Cancelled'
                      : status === 'REPLACED'
                        ? 'Damaged — replacement created'
                        : status === 'REJECTED_UNFULFILLED'
                          ? 'Damaged — manual action required'
                          : 'Awaiting Dispatch';

              return (
                <article key={tf.id} className={styles.transferCard}>
                  {/* Top Bar: Transfer Code & Status */}
                  <div className={styles.transferTopBar}>
                    <div className={styles.transferCodeGroup}>
                      <span className={styles.transferCode}>{tf.transferCode}</span>
                      {tf.createdAt && (
                        <span className={styles.transferTimestamp}>
                          Initiated {formatDateTime(tf.createdAt)}
                        </span>
                      )}
                    </div>
                    <div className={`${styles.statusPill} ${statusClass}`}>
                      {status === 'RECEIVED' && <CheckCircleFilled aria-hidden />}
                      <span>{statusText}</span>
                    </div>
                  </div>

                  {/* Route Stepper Layout */}
                  <div className={styles.routeLayout}>
                    <div className={styles.facilityBox}>
                      <span className={styles.facilityRole}>
                        <EnvironmentOutlined aria-hidden /> Origin Facility
                      </span>
                      <strong className={styles.facilityName}>
                        {tf.fromFacilityName || `Facility #${tf.fromFacilityId}`}
                      </strong>
                      <span className={styles.facilitySub}>Source inventory</span>
                    </div>

                    <div className={styles.routeVector}>
                      <div className={styles.routeGraphic}>
                        <div className={styles.routeTrackDot} />
                        <div className={styles.routeTrack} />
                        <RightOutlined className={styles.routeTrackArrow} aria-hidden />
                      </div>
                      <div className={styles.routeBadge}>
                        <span>{tf.distanceKm} km</span>
                        <span>•</span>
                        <span>Est. ~{tf.estimatedHours}h</span>
                      </div>
                    </div>

                    <div className={styles.facilityBoxRight}>
                      <span className={styles.facilityRole}>
                        <EnvironmentOutlined aria-hidden /> Destination Hub
                      </span>
                      <strong className={styles.facilityName}>
                        {tf.toFacilityName || `Facility #${tf.toFacilityId}`}
                      </strong>
                      <span className={styles.facilitySub}>Consolidation & packing</span>
                    </div>
                  </div>

                  {/* Transferred Items Manifest */}
                  {tf.items && tf.items.length > 0 && (
                    <div className={styles.itemsManifest}>
                      <div className={styles.manifestLabel}>Transferred Manifest ({tf.items.length})</div>
                      <div className={styles.manifestList}>
                        {tf.items.map((it, idx) => (
                          <div key={idx} className={styles.manifestRow}>
                            <span className={styles.manifestMedicine}>{it.medicineName}</span>
                            <span className={styles.manifestQuantity}>
                              {it.quantity} {it.unitName}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Actions / Verified Footer */}
                  <div className={styles.transferCardFooter}>
                    {status === 'RECEIVED' ? (
                      <div className={styles.verifiedMessage}>
                        <CheckCircleFilled aria-hidden />
                        <span>Transferred & verified into active export inventory</span>
                      </div>
                    ) : (
                      <span className={styles.transferTimestamp}>
                        {status === 'DISPATCHED'
                          ? 'Stock is currently in transit to consolidation hub'
                          : status === 'REPLACED'
                            ? 'Replacement transfer is listed below'
                            : status === 'REJECTED_UNFULFILLED'
                              ? 'Source is out of stock; choose another warehouse or cancel the order'
                              : status === 'CANCELLED'
                                ? 'Transfer cancelled; order remains on hold'
                                : 'Awaiting dispatch confirmation from source facility'}
                      </span>
                    )}

                    <div className={styles.actionButtonGroup}>
                      {status === 'REQUESTED' && (
                        <AButton
                          type="primary"
                          icon={<SendOutlined aria-hidden />}
                          loading={updating}
                          onClick={() => handleDispatchTransfer(tf.id)}
                        >
                          Dispatch Transfer
                        </AButton>
                      )}
                      {status === 'DISPATCHED' && (
                        <>
                          <AButton
                            danger
                            loading={updating}
                            onClick={() => handleRejectDamagedTransfer(tf.id)}
                          >
                            Reject Damaged
                          </AButton>
                          <AButton
                            type="primary"
                            icon={<CheckCircleOutlined aria-hidden />}
                            loading={updating}
                            onClick={() => handleReceiveTransfer(tf.id)}
                            style={{ background: '#059669', borderColor: '#059669' }}
                          >
                            Receive & Verify at Hub
                          </AButton>
                        </>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}


      <OrderPackingModal
        open={fulfillOpen}
        onClose={() => setFulfillOpen(false)}
        orderId={order.id}
        orderData={order}
        onSuccess={async () => {
          const updated = await orderService.getAdminById(order.id);
          setOrder(updated);
        }}
      />

      {/* Prescription Detail Modal with Image & Review Actions */}
      <Modal
        title={
          <div className="flex items-center justify-between pr-6">
            <span className="font-semibold text-base text-slate-900">
              Prescription Details · Order #{order.id}
            </span>
            <div>
              {rxStatus === 'APPROVED' && (
                <span className="inline-flex items-center text-xs font-semibold text-emerald-700 px-2.5 py-0.5">
                  Approved
                </span>
              )}
              {rxStatus === 'REJECTED' && (
                <span className="inline-flex items-center text-xs font-semibold text-rose-700 px-2.5 py-0.5">
                  Rejected
                </span>
              )}
              {rxStatus === 'PENDING_APPROVAL' && (
                <span className="inline-flex items-center text-xs font-semibold text-amber-700 px-2.5 py-0.5">
                  Pending Approval
                </span>
              )}
            </div>
          </div>
        }
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={[
          ...(rxStatus === 'PENDING_APPROVAL'
            ? [
              <AButton
                key="reject"
                danger
                icon={<CloseCircleOutlined />}
                loading={reviewing}
                onClick={() => {
                  setRejectReason('');
                  setRejectModalOpen(true);
                }}
              >
                Reject
              </AButton>,
              <AButton
                key="approve"
                type="primary"
                icon={<CheckCircleOutlined />}
                loading={reviewing}
                onClick={handleApprovePrescription}
                style={{ background: '#059669', borderColor: '#059669' }}
              >
                Approve
              </AButton>,
            ]
            : []),
        ]}
        width={880}
        destroyOnHidden
      >
        <div className="space-y-4 py-1">
          {rxItems.length > 0 && (
            <div className="border border-slate-200 rounded-[6px] p-3 bg-slate-50/50">
              <span className="text-xs font-semibold text-slate-700 block mb-2">Prescription Items to verify:</span>
              <div className="space-y-1.5">
                {rxItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between text-xs py-1 border-b border-slate-200/60 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="font-serif italic font-bold text-sm text-[#004996]">℞</span>
                      <span className="font-medium text-slate-900">{item.medicineName}</span>
                    </div>
                    <span className="text-slate-600 font-mono">
                      Quantity: {item.quantity} {item.unitName || 'Unit'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <span className="text-xs font-semibold text-slate-700 block mb-2">Uploaded Prescription Image:</span>
            {imageLoading ? (
              <div className="flex items-center justify-center py-20 border border-slate-200 rounded-[6px]">
                <Spin description="Loading prescription image..." />
              </div>
            ) : prescriptionImageUrl ? (
              <div className="flex justify-center p-3 bg-slate-50 border border-slate-200 rounded-[6px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={prescriptionImageUrl}
                  alt="Customer prescription"
                  className="max-h-[60vh] w-auto max-w-full object-contain rounded"
                />
              </div>
            ) : (
              <div className="text-center py-12 text-slate-400 border border-dashed border-slate-200 rounded-[6px] text-xs">
                No prescription image available.
              </div>
            )}
          </div>

          {order.prescriptionReview && (order.prescriptionReview.pharmacistName || order.prescriptionReview.note) && (
            <div className="border border-slate-200 rounded-[6px] p-3 text-xs text-slate-600 space-y-1 bg-transparent">
              {order.prescriptionReview.pharmacistName && (
                <div>Pharmacist: <strong className="text-slate-800">{order.prescriptionReview.pharmacistName}</strong></div>
              )}
              {order.prescriptionReview.reviewedAt && (
                <div>Reviewed at: <strong className="text-slate-800">{formatDateTime(order.prescriptionReview.reviewedAt)}</strong></div>
              )}
              {order.prescriptionReview.note && (
                <div className="mt-1 pt-1 border-t border-slate-200">
                  <strong>{rxStatus === 'REJECTED' ? 'Rejection Reason:' : 'Note:'}</strong> {order.prescriptionReview.note}
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* Rejection Reason Modal */}
      <Modal
        title="Reject Prescription & Cancel Order"
        open={rejectModalOpen}
        onCancel={() => setRejectModalOpen(false)}
        onOk={handleRejectPrescription}
        okText="Confirm Rejection"
        okButtonProps={{ danger: true, loading: reviewing }}
        cancelButtonProps={{ disabled: reviewing }}
        destroyOnHidden
      >
        <div className="space-y-3 py-2">
          <p className="text-sm text-slate-600">
            Rejecting the prescription will automatically <strong>cancel order #{order.id}</strong> and release reserved stock.
            Please specify the reason below (e.g. illegible doctor signature, expired date, wrong medication):
          </p>
          <Input.TextArea
            rows={3}
            placeholder="Reason for rejection (required)..."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
        </div>
      </Modal>
    </div>
  );
}
