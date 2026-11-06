'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Table,
  Button,
  Input,
  Select,
  Tag,
  Modal,
  Rate,
  App,
  Image,
  Drawer,
  Timeline,
  Spin,
  Dropdown,
  Radio,
  Pagination,
} from 'antd';
import {
  SearchOutlined,
  ReloadOutlined,
  MoreOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  EyeInvisibleOutlined,
  DeleteOutlined,
  CommentOutlined,
  FlagOutlined,
  ArrowRightOutlined,
  PictureOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { reviewService, ReviewItem, ModerationAuditLog } from '@/services/review.service';
import { useAuth } from '@/store/useAuthStore';
import { cn } from '@/utils';

// Semantic status colors matching globals.css (:root variables)
const STATUS_CONFIG: Record<string, { text: string; label: string }> = {
  APPROVED: {
    text: 'text-[#15803d]',
    label: 'Approved',
  },
  PENDING: {
    text: 'text-[#b45309]',
    label: 'Pending',
  },
  SPAM: {
    text: 'text-[#b91c1c]',
    label: 'Spam',
  },
  HIDDEN: {
    text: 'text-gray-500',
    label: 'Hidden',
  },
};

// Friendly meta renderer for audit details
const renderAuditMetaDetails = (meta?: Record<string, any> | null) => {
  if (!meta || Object.keys(meta).length === 0) return null;

  const items: React.ReactNode[] = [];

  if (meta.previousStatus || meta.newStatus) {
    items.push(
      <div key="status-change" className="inline-flex items-center gap-1.5 text-xs text-gray-700">
        <span className="text-gray-500">Status:</span>
        {meta.previousStatus && (
          <>
            <span className="font-medium text-gray-600">{meta.previousStatus}</span>
            <span className="text-gray-400 text-xs">→</span>
          </>
        )}
        <span className="font-semibold text-gray-900">{meta.newStatus || meta.actionOnReview}</span>
      </div>
    );
  }

  if (meta.reportId) {
    items.push(
      <span key="report-id" className="inline-flex items-center text-xs text-gray-700">
        <span className="text-gray-500 mr-1">Report ID:</span>
        <span className="font-mono font-medium text-gray-900">#{meta.reportId}</span>
      </span>
    );
  }

  if (meta.actionOnReview && !meta.newStatus && !meta.previousStatus) {
    items.push(
      <span key="action-on-review" className="inline-flex items-center text-xs text-gray-700">
        <span className="text-gray-500 mr-1">Action:</span>
        <span className="font-medium text-gray-900">{meta.actionOnReview}</span>
      </span>
    );
  }

  if (meta.reason && meta.reason !== 'SPAM' && meta.reason !== meta.actionOnReview) {
    items.push(
      <span key="reason" className="inline-flex items-center text-xs text-gray-700">
        <span className="text-gray-500 mr-1">Reason:</span>
        <span className="font-medium text-gray-900">{meta.reason}</span>
      </span>
    );
  }

  if (meta.note) {
    items.push(
      <span key="note" className="inline-flex items-center text-xs text-gray-600 italic">
        &ldquo;{meta.note}&rdquo;
      </span>
    );
  }

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1">
      {items.map((item, idx) => (
        <React.Fragment key={idx}>
          {idx > 0 && <span className="text-gray-300">·</span>}
          {item}
        </React.Fragment>
      ))}
    </div>
  );
};

export default function AdminReviewsPage() {
  const { message, modal } = App.useApp();
  const { user } = useAuth();

  // Review list state
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  // Filters & Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [status, setStatus] = useState<string>('ALL');
  const [rating, setRating] = useState<number | undefined>(undefined);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  // Review Detail Drawer state
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);
  const [selectedReview, setSelectedReview] = useState<ReviewItem | null>(null);
  const [auditLogs, setAuditLogs] = useState<ModerationAuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  // Reply state in drawer
  const [replyText, setReplyText] = useState('');
  const [submittingReply, setSubmittingReply] = useState(false);

  // Staff Report Modal state
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reviewToReport, setReviewToReport] = useState<ReviewItem | null>(null);
  const [reportReason, setReportReason] = useState('SPAM');
  const [reportDescription, setReportDescription] = useState('');
  const [submittingReport, setSubmittingReport] = useState(false);

  // Fetch reviews from backend
  const fetchReviews = useCallback(async () => {
    setLoading(true);
    try {
      const res = await reviewService.getAllReviewsForAdmin({
        page,
        limit: pageSize,
        status: status !== 'ALL' ? status : undefined,
        rating,
        search: search.trim() || undefined,
      });
      if (res && res.data) {
        setReviews(res.data);
        setTotal(res.pagination?.total || 0);

        // Update selected review in drawer if currently opened
        setSelectedReview((prev) => {
          if (!prev) return null;
          return res.data.find((r) => r.id === prev.id) || prev;
        });
      }
    } catch {
      message.error('Failed to load reviews');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, status, rating, search]);

  useEffect(() => {
    // Cancel pending work when dependencies change or the component unmounts.
    const timer = setTimeout(() => {
      fetchReviews();
    }, 0);
    return () => clearTimeout(timer);
  }, [page, pageSize, status, rating, search]);

  // Open Detail Drawer
  const handleOpenDetail = async (record: ReviewItem) => {
    setSelectedReview(record);
    setReplyText(record.adminReply || '');
    setDetailDrawerOpen(true);

    // Fetch audit history for this review
    setAuditLoading(true);
    try {
      const auditRes = await reviewService.getAdminAuditLogs({ reviewId: record.id });
      if (auditRes && auditRes.data) {
        setAuditLogs(auditRes.data);
      }
    } catch {
      setAuditLogs([]);
    } finally {
      setAuditLoading(false);
    }
  };

  // Status Change handler
  const handleStatusChange = async (
    id: number,
    newStatus: 'APPROVED' | 'PENDING' | 'HIDDEN' | 'SPAM',
  ) => {
    try {
      await reviewService.updateReviewStatus(id, newStatus);
      message.success(`Status updated to ${newStatus}`);
      fetchReviews();
    } catch {
      message.error('Failed to update review status');
    }
  };

  // Delete review handler
  const handleDelete = (id: number) => {
    modal.confirm({
      title: 'Delete Review',
      content: `Are you sure you want to permanently delete review #${id}? This action cannot be undone.`,
      okText: 'Delete',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          await reviewService.deleteReview(id);
          message.success('Review deleted successfully');
          if (selectedReview?.id === id) {
            setDetailDrawerOpen(false);
            setSelectedReview(null);
          }
          fetchReviews();
        } catch {
          message.error('Failed to delete review');
        }
      },
    });
  };

  // Save Pharmacist / Admin Reply
  const handleSaveReply = async () => {
    if (!selectedReview) return;
    if (!replyText.trim()) {
      message.warning('Please enter reply content');
      return;
    }

    setSubmittingReply(true);
    try {
      await reviewService.replyToReview(
        selectedReview.id,
        replyText.trim(),
        user?.fullName || user?.name || undefined,
      );
      message.success('Reply saved successfully');
      fetchReviews();
    } catch {
      message.error('Failed to save reply');
    } finally {
      setSubmittingReply(false);
    }
  };

  // Open Staff Report Modal
  const handleOpenReportModal = (record: ReviewItem) => {
    setReviewToReport(record);
    setReportReason('SPAM');
    setReportDescription('');
    setReportModalOpen(true);
  };

  // Submit Staff Report
  const handleSubmitReport = async () => {
    if (!reviewToReport) return;
    setSubmittingReport(true);
    try {
      await reviewService.reportReview(reviewToReport.id, {
        reason: reportReason,
        description: reportDescription.trim() || undefined,
      });
      message.success('Report submitted to Moderation Center');
      setReportModalOpen(false);
      setReviewToReport(null);
      fetchReviews();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Failed to submit report';
      message.error(msg);
    } finally {
      setSubmittingReport(false);
    }
  };

  // Table Columns Definition
  const columns = [
    {
      title: 'Product',
      key: 'product',
      width: 240,
      render: (_: any, record: ReviewItem) => (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={record.medicine?.imageUrl || '/favicon.ico'}
            alt=""
            className="w-11 h-11 object-contain rounded border border-gray-200 bg-white p-0.5 shrink-0"
          />
          <div className="min-w-0">
            <p className="font-medium text-sm text-gray-900 line-clamp-1 m-0 leading-snug">
              {record.medicine?.medicineName || 'Product'}
            </p>
            <span className="text-xs text-gray-500 font-mono">
              ID: #{record.medicine?.id || record.productId}
            </span>
          </div>
        </div>
      ),
    },
    {
      title: 'Customer',
      key: 'customer',
      width: 180,
      render: (_: any, record: ReviewItem) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <span className="font-medium text-sm text-gray-900 truncate">
              {record.customer?.fullName || record.customerName || 'Customer'}
            </span>
            {record.isVerifiedPurchase && (
              <span title="Verified Purchase" className="text-gray-400 text-xs shrink-0">
                ✓
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 m-0 truncate">
            {record.customer?.email || record.customer?.phone || 'Verified'}
          </p>
        </div>
      ),
    },
    {
      title: 'Rating',
      key: 'rating',
      width: 90,
      render: (_: any, record: ReviewItem) => (
        <span className="text-sm font-medium text-gray-900 font-mono">
          {record.ratingStars}/5
        </span>
      ),
    },
    {
      title: 'Review',
      key: 'review',
      render: (_: any, record: ReviewItem) => (
        <div className="space-y-1 py-1 max-w-xl">
          <p
            onClick={() => handleOpenDetail(record)}
            className="text-sm text-gray-900 m-0 line-clamp-2 leading-relaxed font-normal cursor-pointer hover:text-[#004996]"
          >
            &ldquo;{record.comment}&rdquo;
          </p>

          {/* Sub-meta: Photos / Replied / Reported flags */}
          <div className="flex items-center gap-3 text-xs text-gray-500">
            {record.images && record.images.length > 0 && (
              <span className="flex items-center gap-1 text-gray-600">
                <PictureOutlined />
                <span>{record.images.length} photo{record.images.length > 1 ? 's' : ''}</span>
              </span>
            )}

            {record.adminReply && (
              <span className="text-[#004996] font-medium">
                ✓ Replied
              </span>
            )}

            {record.reports && record.reports.length > 0 && (() => {
              const pendingReports = record.reports.filter((r: any) => r.status === 'PENDING');
              if (pendingReports.length > 0) {
                return (
                  <span
                    onClick={() => handleOpenDetail(record)}
                    className="text-[#b91c1c] font-medium cursor-pointer hover:underline flex items-center gap-1"
                  >
                    <WarningOutlined />
                    <span>{pendingReports.length} pending report{pendingReports.length > 1 ? 's' : ''}</span>
                  </span>
                );
              }
              return (
                <span
                  onClick={() => handleOpenDetail(record)}
                  className="text-gray-400 font-medium cursor-pointer hover:underline flex items-center gap-1"
                >
                  <span>✓ {record.reports.length} resolved</span>
                </span>
              );
            })()}
          </div>
        </div>
      ),
    },
    {
      title: 'Submitted',
      key: 'date',
      width: 120,
      render: (_: any, record: ReviewItem) => (
        <span className="text-sm text-gray-600">
          {new Date(record.createdAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </span>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      width: 110,
      render: (_: any, record: ReviewItem) => {
        const badge = STATUS_CONFIG[record.status || 'APPROVED'] || STATUS_CONFIG.APPROVED;
        return (
          <span className={`text-sm font-semibold ${badge.text}`}>
            {badge.label}
          </span>
        );
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 140,
      render: (_: any, record: ReviewItem) => {
        const isPending = record.status === 'PENDING';

        return (
          <div className="flex items-center gap-2">
            <Button
              size="middle"
              type="text"
              onClick={() => handleOpenDetail(record)}
              className="text-sm px-2 text-gray-700 hover:text-gray-900"
            >
              View
            </Button>

            {isPending && (
              <>
                <Button
                  size="middle"
                  type="primary"
                  onClick={() => handleStatusChange(record.id, 'APPROVED')}
                  className="text-sm px-3 !bg-[#004996]"
                >
                  Approve
                </Button>

                <Dropdown
                  menu={{
                    items: [
                      {
                        key: 'reject_spam',
                        label: 'Mark as Spam',
                        onClick: () => handleStatusChange(record.id, 'SPAM'),
                      },
                      {
                        key: 'reject_hide',
                        label: 'Hide Review',
                        onClick: () => handleStatusChange(record.id, 'HIDDEN'),
                      },
                      {
                        key: 'delete',
                        label: 'Delete',
                        danger: true,
                        onClick: () => handleDelete(record.id),
                      },
                    ],
                  }}
                  trigger={['click']}
                  placement="bottomRight"
                >
                  <Button size="middle" danger className="text-sm px-2">
                    Reject ▾
                  </Button>
                </Dropdown>
              </>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      {/* Enterprise Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 m-0">
            Review Moderation
          </h1>
          <p className="text-sm text-gray-500 mt-1 m-0">
            Manage product reviews, evaluate flagged submissions, and post pharmacist replies.
          </p>
        </div>

        <Link href="/admin/moderation">
          <Button size="middle" className="text-sm text-gray-700">
            Moderation & Reports Center <ArrowRightOutlined className="text-xs" />
          </Button>
        </Link>
      </div>

      {/* Enterprise Filter Toolbar */}
      <div className="bg-white p-3 rounded-lg border border-gray-200 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
          {/* Search Input */}
          <div className="w-full sm:w-72">
            <Input
              placeholder="Search product, customer, review..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onPressEnter={() => {
                setSearch(searchInput);
                setPage(1);
              }}
              prefix={<SearchOutlined className="text-gray-400 text-sm" />}
              allowClear
              onClear={() => {
                setSearchInput('');
                setSearch('');
                setPage(1);
              }}
              size="middle"
            />
          </div>

          {/* Status, Rating Filters & Refresh Button (Inline) */}
          <div className="flex items-center gap-2.5 shrink-0">
            <Select
              size="middle"
              value={status}
              onChange={(val) => {
                setStatus(val);
                setPage(1);
              }}
              className="w-36"
              options={[
                { value: 'ALL', label: 'All' },
                { value: 'APPROVED', label: 'Approved' },
                { value: 'PENDING', label: 'Pending' },
                { value: 'SPAM', label: 'Spam' },
                { value: 'HIDDEN', label: 'Hidden' },
              ]}
            />

            <Select
              size="middle"
              value={rating ?? 'ALL'}
              onChange={(val) => {
                setRating(val === 'ALL' ? undefined : Number(val));
                setPage(1);
              }}
              className="w-32"
              options={[
                { value: 'ALL', label: 'All Ratings' },
                { value: 5, label: '5 Stars' },
                { value: 4, label: '4 Stars' },
                { value: 3, label: '3 Stars' },
                { value: 2, label: '2 Stars' },
                { value: 1, label: '1 Star' },
              ]}
            />

            <Button
              size="middle"
              icon={<ReloadOutlined className="text-sm" />}
              onClick={() => fetchReviews()}
              loading={loading}
              className="text-gray-700 shrink-0"
              title="Refresh"
              aria-label="Refresh"
            />
          </div>
        </div>
      </div>

      {/* Desktop & Tablet Table (>= 768px) */}
      <div className="hidden md:block bg-white rounded-lg border border-gray-200 overflow-hidden">
        <Table
          rowKey="id"
          columns={columns}
          dataSource={reviews}
          loading={loading}
          pagination={false}
          size="middle"
        />

        {/* Pagination Footer */}
        <div className="p-4 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span className="text-sm text-gray-500">
            Showing {total > 0 ? (page - 1) * pageSize + 1 : 0} -{' '}
            {Math.min(page * pageSize, total)} of {total} reviews
          </span>
          <Pagination
            className="ml-auto"
            current={page}
            pageSize={pageSize}
            total={total}
            onChange={(p, ps) => {
              setPage(p);
              if (ps && ps !== pageSize) setPageSize(ps);
            }}
            showSizeChanger={false}
            size="small"
            itemRender={(_page, type, originalElement) => {
              if (type === 'prev') {
                return <span className="px-1 text-gray-600 text-xs font-medium">&lt; Prev</span>;
              }
              if (type === 'next') {
                return <span className="px-1 text-[#004996] text-xs font-medium">Next &gt;</span>;
              }
              return originalElement;
            }}
          />
        </div>
      </div>

      {/* Mobile Vertical Review List (< 768px) */}
      <div className="block md:hidden bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
        {loading ? (
          <div className="py-12 text-center text-gray-500 text-sm">
            <Spin className="mr-2" /> Loading reviews...
          </div>
        ) : reviews.length === 0 ? (
          <div className="py-12 text-center text-gray-500 text-sm">
            No reviews found.
          </div>
        ) : (
          reviews.map((record) => {
            const statusBadge =
              STATUS_CONFIG[record.status || 'APPROVED'] || STATUS_CONFIG.APPROVED;
            const isPending = record.status === 'PENDING';

            return (
              <div key={record.id} className="p-3.5 space-y-2.5 text-sm">
                {/* 1. Product thumbnail + Product name + ID + Action dropdown */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={record.medicine?.imageUrl || '/favicon.ico'}
                      alt=""
                      className="w-10 h-10 object-contain rounded border border-gray-200 bg-white p-0.5 shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="font-medium text-sm text-gray-900 line-clamp-1 m-0 leading-tight">
                        {record.medicine?.medicineName || 'Product'}
                      </p>
                      <span className="text-xs text-gray-500 font-mono">
                        ID: #{record.medicine?.id || record.productId}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 2. Customer row */}
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <span className="font-medium text-gray-900 truncate max-w-[160px]">
                    {record.customer?.fullName || record.customerName || 'Customer'}
                  </span>
                  {record.isVerifiedPurchase && (
                    <span title="Verified Purchase" className="text-gray-400">
                      ✓
                    </span>
                  )}
                  <span className="text-gray-300">·</span>
                  <span className="text-gray-500 truncate flex-1">
                    {record.customer?.email || record.customer?.phone || 'Verified'}
                  </span>
                </div>

                {/* 3. Compact metadata row: Rating · Date · Status */}
                <div className="flex items-center gap-2.5 text-xs text-gray-600 flex-wrap">
                  <span className="font-mono font-medium text-gray-900">{record.ratingStars}/5</span>
                  <span className="text-gray-300">·</span>
                  <span className="text-gray-600">
                    {new Date(record.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                  <span className="text-gray-300">·</span>
                  <span className={`font-semibold ${statusBadge.text}`}>
                    {statusBadge.label}
                  </span>
                </div>

                {/* 4. Review content preview (2 lines clamp) */}
                <p
                  onClick={() => handleOpenDetail(record)}
                  className="text-sm text-gray-900 m-0 line-clamp-2 leading-relaxed font-normal cursor-pointer hover:text-[#004996]"
                >
                  &ldquo;{record.comment}&rdquo;
                </p>

                {/* 5. Sub-indicators & Action */}
                <div className="flex items-center justify-between pt-1.5 border-t border-gray-100">
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    {record.images && record.images.length > 0 && (
                      <span className="flex items-center gap-1 text-gray-600">
                        <PictureOutlined />
                        <span>{record.images.length}</span>
                      </span>
                    )}

                    {record.adminReply && (
                      <span className="text-[#004996] font-medium">
                        ✓ Replied
                      </span>
                    )}

                    {record.reports && record.reports.length > 0 && (() => {
                      const pendingReports = record.reports.filter((r: any) => r.status === 'PENDING');
                      if (pendingReports.length > 0) {
                        return (
                          <span
                            onClick={() => handleOpenDetail(record)}
                            className="text-[#b91c1c] font-medium cursor-pointer hover:underline flex items-center gap-1"
                          >
                            <WarningOutlined />
                            <span>{pendingReports.length} pending report{pendingReports.length > 1 ? 's' : ''}</span>
                          </span>
                        );
                      }
                      return (
                        <span
                          onClick={() => handleOpenDetail(record)}
                          className="text-gray-400 font-medium cursor-pointer hover:underline flex items-center gap-1"
                        >
                          <span>✓ {record.reports.length} resolved</span>
                        </span>
                      );
                    })()}
                  </div>

                  <div className="flex items-center gap-2">
                    {isPending && (
                      <Button
                        size="small"
                        type="primary"
                        onClick={() => handleStatusChange(record.id, 'APPROVED')}
                        className="text-xs px-2.5 !bg-[#004996]"
                      >
                        Approve
                      </Button>
                    )}
                    <Button
                      size="small"
                      onClick={() => handleOpenDetail(record)}
                      className="text-xs text-gray-700"
                    >
                      View
                    </Button>
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* Mobile Pagination */}
        {total > 0 && (
          <div className="p-4 flex flex-col sm:flex-row items-end sm:items-center justify-between gap-3 border-t border-gray-100">
            <span className="text-xs text-gray-500 self-start sm:self-auto">
              Showing {(page - 1) * pageSize + 1} -{' '}
              {Math.min(page * pageSize, total)} of {total} reviews
            </span>
            <Pagination
              className="ml-auto"
              current={page}
              pageSize={pageSize}
              total={total}
              onChange={(p, ps) => {
                setPage(p);
                if (ps && ps !== pageSize) setPageSize(ps);
              }}
              showSizeChanger={false}
              size="small"
              itemRender={(_page, type, originalElement) => {
                if (type === 'prev') {
                  return <span className="px-1 text-gray-600 text-xs font-medium">&lt; Prev</span>;
                }
                if (type === 'next') {
                  return <span className="px-1 text-[#004996] text-xs font-medium">Next &gt;</span>;
                }
                return originalElement;
              }}
            />
          </div>
        )}
      </div>

      {/* Review Detail Side Drawer */}
      <Drawer
        title={
          selectedReview ? (
            <div className="flex items-center justify-between pr-4">
              <span className="font-semibold text-base text-gray-900">
                Review #{selectedReview.id} Details
              </span>
              {(() => {
                const badge =
                  STATUS_CONFIG[selectedReview.status || 'APPROVED'] || STATUS_CONFIG.APPROVED;
                return (
                  <span className={`text-sm font-semibold ${badge.text}`}>
                    {badge.label}
                  </span>
                );
              })()}
            </div>
          ) : (
            'Review Details'
          )
        }
        open={detailDrawerOpen}
        onClose={() => {
          setDetailDrawerOpen(false);
          setSelectedReview(null);
        }}
        styles={{ wrapper: { width: 540 } }}
        footer={
          selectedReview && (
            <div className="flex items-center justify-between gap-2 py-1.5">
              <Button
                danger
                size="middle"
                onClick={() => handleDelete(selectedReview.id)}
                className="text-sm font-medium"
              >
                Delete
              </Button>

              <div className="flex items-center gap-2">
                {selectedReview.status !== 'SPAM' && (
                  <Button
                    size="middle"
                    onClick={() => handleStatusChange(selectedReview.id, 'SPAM')}
                    className="text-sm font-medium"
                  >
                    Mark as Spam
                  </Button>
                )}
                {selectedReview.status !== 'HIDDEN' && (
                  <Button
                    size="middle"
                    onClick={() => handleStatusChange(selectedReview.id, 'HIDDEN')}
                    className="text-sm font-medium"
                  >
                    Hide
                  </Button>
                )}
                {selectedReview.status !== 'APPROVED' && (
                  <Button
                    type="primary"
                    size="middle"
                    onClick={() => handleStatusChange(selectedReview.id, 'APPROVED')}
                    className="!bg-[#004996] text-sm font-medium"
                  >
                    Approve Review
                  </Button>
                )}
              </div>
            </div>
          )
        }
      >
        {selectedReview && (
          <div className="space-y-6 text-sm text-gray-800 divide-y divide-gray-100">
            {/* Section 1: Product Information */}
            <div className="space-y-3">
              <span className="text-sm font-semibold text-gray-900 block">
                Product Information
              </span>
              <div className="flex items-center gap-3.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={selectedReview.medicine?.imageUrl || '/favicon.ico'}
                  alt=""
                  className="w-14 h-14 object-contain rounded border border-gray-200 bg-white p-1 shrink-0"
                />
                <div>
                  <p className="font-semibold text-sm text-gray-900 m-0">
                    {selectedReview.medicine?.medicineName || 'Product'}
                  </p>
                  <p className="text-xs text-gray-500 font-mono m-0 mt-1">
                    Product ID: #{selectedReview.medicine?.id || selectedReview.productId}
                  </p>
                </div>
              </div>
            </div>

            {/* Section 2: Customer & Review Meta */}
            <div className="pt-5 space-y-3">
              <span className="text-sm font-semibold text-gray-900 block">
                Submission Information
              </span>
              <div className="grid grid-cols-2 gap-3.5 text-sm">
                <div>
                  <span className="text-gray-500 block text-xs mb-0.5">Customer</span>
                  <span className="font-medium text-gray-900">
                    {selectedReview.customer?.fullName || selectedReview.customerName || 'Anonymous'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500 block text-xs mb-0.5">Email / Phone</span>
                  <span className="text-gray-700 font-mono">
                    {selectedReview.customer?.email || selectedReview.customer?.phone || 'N/A'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500 block text-xs mb-0.5">Rating</span>
                  <div className="flex items-center gap-1.5">
                    <Rate
                      disabled
                      value={selectedReview.ratingStars}
                      className="!text-sm !text-amber-500"
                    />
                    <span className="font-medium text-gray-900">{selectedReview.ratingStars} / 5</span>
                  </div>
                </div>
                <div>
                  <span className="text-gray-500 block text-xs mb-0.5">Date Submitted</span>
                  <span className="text-gray-700">
                    {new Date(selectedReview.createdAt).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </div>
            </div>

            {/* Section 3: Full Review Content & Photos */}
            <div className="pt-5 space-y-3">
              <span className="text-sm font-semibold text-gray-900 block">
                Review Content
              </span>
              <p className="text-sm text-gray-900 m-0 leading-relaxed font-normal">
                {selectedReview.comment}
              </p>

              {/* Uploaded Photos */}
              {selectedReview.images && selectedReview.images.length > 0 && (
                <div className="pt-2">
                  <span className="text-xs text-gray-600 block mb-2">
                    Attached Customer Photos ({selectedReview.images.length}):
                  </span>
                  <div className="flex gap-2.5 flex-wrap">
                    <Image.PreviewGroup>
                      {selectedReview.images.map((img, i) => (
                        <Image
                          key={i}
                          src={img}
                          alt=""
                          width={72}
                          height={72}
                          className="rounded object-cover border border-gray-200"
                        />
                      ))}
                    </Image.PreviewGroup>
                  </div>
                </div>
              )}
            </div>

            {/* Section 4: Pharmacist / Admin Reply */}
            <div className="pt-5 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-sm font-semibold text-gray-900">
                  Pharmacist Reply
                </span>
                {selectedReview.repliedAt && (
                  <span className="text-xs text-gray-500">
                    {selectedReview.repliedByName && (
                      <span className="font-medium text-gray-700 mr-1.5">
                        By {selectedReview.repliedByName}
                      </span>
                    )}
                    <span className="font-mono">
                      {new Date(selectedReview.repliedAt).toLocaleDateString()}
                    </span>
                  </span>
                )}
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-600 font-medium block mb-1">
                    Responding as
                  </label>
                  <div className="text-sm font-medium text-gray-800 bg-gray-50 border border-gray-200 rounded-md px-3 py-2 flex items-center justify-between">
                    <span className="font-semibold text-gray-900">
                      {user?.fullName || user?.name || 'PharmaTrace Pharmacist'}
                    </span>
                    <span className="text-xs text-gray-500 px-2 py-0.5 rounded font-normal">
                      {user?.role || 'Staff'}
                    </span>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-600 font-medium block mb-1">
                    Response Content
                  </label>
                  <Input.TextArea
                    rows={3}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Enter professional medical guidance or customer response..."
                    className="text-sm"
                  />
                </div>
                <div className="flex justify-end">
                  <Button
                    size="middle"
                    type="primary"
                    onClick={handleSaveReply}
                    loading={submittingReply}
                    className="!bg-[#004996] text-sm font-medium"
                  >
                    Save Reply
                  </Button>
                </div>
              </div>
            </div>

            {/* Section 5: Reports (if any) */}
            {selectedReview.reports && selectedReview.reports.length > 0 && (() => {
              const pendingCount = selectedReview.reports.filter((r: any) => r.status === 'PENDING').length;
              const resolvedCount = selectedReview.reports.filter(
                (r: any) => r.status !== 'PENDING' && r.status !== 'DISMISSED',
              ).length;
              const dismissedCount = selectedReview.reports.filter((r: any) => r.status === 'DISMISSED').length;

              return (
                <div className="pt-5 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="text-sm font-semibold text-gray-900 block">
                      User Reports ({selectedReview.reports.length})
                    </span>
                    <div className="flex items-center gap-3 text-xs font-semibold">
                      {pendingCount > 0 && (
                        <span className="text-[#b91c1c] flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#b91c1c]" />
                          {pendingCount} Pending
                        </span>
                      )}
                      {resolvedCount > 0 && (
                        <span className="text-[#15803d] flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#15803d]" />
                          {resolvedCount} Resolved
                        </span>
                      )}
                      {dismissedCount > 0 && (
                        <span className="text-gray-500 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                          {dismissedCount} Dismissed
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2 divide-y divide-gray-100">
                    {selectedReview.reports.map((rep: any) => {
                      const isPending = rep.status === 'PENDING';
                      const isDismissed = rep.status === 'DISMISSED';

                      return (
                        <div
                          key={rep.id}
                          className="text-sm pt-2 first:pt-0 space-y-1"
                        >
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  'font-bold text-sm',
                                  isPending ? 'text-[#b91c1c]' : 'text-gray-900',
                                )}
                              >
                                {rep.reason}
                              </span>
                              <span
                                className={cn(
                                  'text-[10px] font-semibold px-1.5 py-0.5 rounded',
                                  isPending
                                    ? 'bg-[#b91c1c] text-white'
                                    : isDismissed
                                      ? 'bg-gray-100 text-gray-700'
                                      : 'bg-[#15803d] text-white',
                                )}
                              >
                                {rep.status || 'PENDING'}
                              </span>
                            </div>
                            <span className="text-xs text-gray-500 font-mono">
                              {new Date(rep.created_at).toLocaleString()}
                            </span>
                          </div>
                          {rep.description && (
                            <p className="m-0 text-gray-600 italic text-xs pt-0.5">
                              &ldquo;{rep.description}&rdquo;
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Section 6: Moderation History & Audit Trail */}
            <div className="pt-5 space-y-3">
              <span className="text-sm font-semibold text-gray-900 block">
                Moderation Activity Log
              </span>
              {auditLoading ? (
                <div className="py-4 text-center"><Spin /></div>
              ) : auditLogs.length === 0 ? (
                <p className="text-gray-500 text-sm m-0">No recorded audit history for this review.</p>
              ) : (
                <Timeline
                  className="pt-2"
                  items={auditLogs.map((log) => ({
                    content: (
                      <div className="text-sm space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-semibold text-gray-800">
                            {log.action}
                          </span>
                          <span className="text-xs text-gray-500 font-mono">
                            {new Date(log.created_at).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-gray-900 m-0 font-normal leading-relaxed">{log.reason || 'Action performed'}</p>
                        {renderAuditMetaDetails(log.meta)}
                        <span className="text-xs text-gray-500 block pt-0.5">
                          By: {log.performed_by_employee?.full_name || log.performed_by_customer?.full_name || 'System'} ({log.performed_by_role || 'SYSTEM'})
                        </span>
                      </div>
                    ),
                  }))}
                />
              )}
            </div>
          </div>
        )}
      </Drawer>

      {/* Staff Report Modal */}
      <Modal
        title="Report Review Violation"
        open={reportModalOpen}
        onOk={handleSubmitReport}
        onCancel={() => {
          setReportModalOpen(false);
          setReviewToReport(null);
        }}
        confirmLoading={submittingReport}
        okText="Submit Report"
        cancelText="Cancel"
        okButtonProps={{ style: { backgroundColor: '#004996' } }}
      >
        {reviewToReport && (
          <div className="space-y-4 py-2 text-sm">
            <div className="space-y-1.5 pb-2.5 border-b border-gray-100">
              <span className="font-medium text-gray-900 block">
                Review #{reviewToReport.id} by {reviewToReport.customer?.fullName || reviewToReport.customerName}
              </span>
              <p className="text-gray-700 m-0 italic leading-relaxed">&ldquo;{reviewToReport.comment}&rdquo;</p>
            </div>

            <div>
              <label className="font-medium text-gray-800 block mb-2">
                Violation Reason
              </label>
              <Radio.Group
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
                className="flex flex-col gap-2"
              >
                <Radio value="SPAM">Spam / Promotion / Bot comment</Radio>
                <Radio value="HARASSMENT">Harassment / Profanity</Radio>
                <Radio value="MISINFORMATION">Dangerous Medical Misinformation</Radio>
                <Radio value="INAPPROPRIATE">Inappropriate or Vulgar Content</Radio>
                <Radio value="OTHER">Other Policy Violation</Radio>
              </Radio.Group>
            </div>

            <div>
              <label className="font-medium text-gray-800 block mb-1.5">
                Staff Note (Optional)
              </label>
              <Input.TextArea
                rows={3}
                value={reportDescription}
                onChange={(e) => setReportDescription(e.target.value)}
                placeholder="Reason for flagging..."
                className="text-sm"
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
