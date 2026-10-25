'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Table,
  Button,
  Select,
  Modal,
  Input,
  App,
  Tabs,
  Radio,
  Badge,
  Spin,
  Pagination,
} from 'antd';
import {
  ReloadOutlined,
  SafetyCertificateOutlined,
  HistoryOutlined,
  WarningOutlined,
  ArrowLeftOutlined,
  UserOutlined,
  IdcardOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import {
  reviewService,
  ModerationReport,
  ModerationAuditLog,
} from '@/services/review.service';
import { useAuth } from '@/store/useAuthStore';
import Link from 'next/link';

// Friendly metadata renderer replacing raw JSON dumps
const renderAuditMetaDetails = (meta?: Record<string, any> | null) => {
  if (!meta || Object.keys(meta).length === 0) return null;

  const items: React.ReactNode[] = [];

  // Status transitions
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

  // Report resolution details
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
        <span className="text-gray-500 mr-1">Resolution:</span>
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

export default function AdminModerationPage() {
  const { message } = App.useApp();
  const { user } = useAuth();

  // Active Tab: 'reports' | 'audit'
  const [activeTab, setActiveTab] = useState('reports');

  // Reports state
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsTotal, setReportsTotal] = useState(0);
  const [reportsPage, setReportsPage] = useState(1);
  const [reportsPageSize, setReportsPageSize] = useState(10);
  const [reportStatusFilter, setReportStatusFilter] = useState('PENDING');
  const [reportReasonFilter, setReportReasonFilter] = useState<string | undefined>(undefined);

  // Detail modal state
  const [detailReport, setDetailReport] = useState<ModerationReport | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  // Resolution modal state
  const [resolvingReport, setResolvingReport] = useState<ModerationReport | null>(null);
  const [isResolveModalOpen, setIsResolveModalOpen] = useState(false);
  const [resolverNote, setResolverNote] = useState('');
  const [actionOnReview, setActionOnReview] = useState<'HIDE' | 'SPAM' | 'APPROVE' | 'KEEP'>('HIDE');
  const [submittingResolution, setSubmittingResolution] = useState(false);

  // Dismiss modal state
  const [dismissingReport, setDismissingReport] = useState<ModerationReport | null>(null);
  const [isDismissModalOpen, setIsDismissModalOpen] = useState(false);
  const [dismissNote, setDismissNote] = useState('');
  const [submittingDismiss, setSubmittingDismiss] = useState(false);

  // Audit logs state
  const [auditLogs, setAuditLogs] = useState<ModerationAuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(1);
  const [auditPageSize, setAuditPageSize] = useState(20);
  const [auditActionFilter, setAuditActionFilter] = useState<string | undefined>(undefined);

  // Fetch Reports
  const fetchReports = useCallback(async () => {
    setReportsLoading(true);
    try {
      const res = await reviewService.getAdminReports({
        page: reportsPage,
        limit: reportsPageSize,
        status: reportStatusFilter !== 'ALL' ? reportStatusFilter : undefined,
        reason: reportReasonFilter || undefined,
      });
      if (res && res.data) {
        setReports(res.data);
        setReportsTotal(res.pagination?.total || 0);

        setDetailReport((prev) => {
          if (!prev) return null;
          return res.data.find((r) => r.id === prev.id) || prev;
        });
      }
    } catch {
      message.error('Failed to load moderation reports');
    } finally {
      setReportsLoading(false);
    }
  }, [reportsPage, reportsPageSize, reportStatusFilter, reportReasonFilter]);

  // Fetch Audit Logs
  const fetchAuditLogs = useCallback(async () => {
    setAuditLoading(true);
    try {
      const res = await reviewService.getAdminAuditLogs({
        page: auditPage,
        limit: auditPageSize,
        action: auditActionFilter || undefined,
      });
      if (res && res.data) {
        setAuditLogs(res.data);
        setAuditTotal(res.pagination?.total || 0);
      }
    } catch {
      message.error('Failed to load audit logs');
    } finally {
      setAuditLoading(false);
    }
  }, [auditPage, auditPageSize, auditActionFilter]);

  useEffect(() => {
    if (activeTab === 'reports') {
      fetchReports();
    } else {
      fetchAuditLogs();
    }
  }, [activeTab, fetchReports, fetchAuditLogs]);

  const handleOpenDetailModal = (report: ModerationReport) => {
    setDetailReport(report);
    setIsDetailModalOpen(true);
  };

  const handleOpenResolveModal = (report: ModerationReport) => {
    setResolvingReport(report);
    setResolverNote('');
    setActionOnReview('KEEP');
    setIsResolveModalOpen(true);
  };

  const handleSubmitResolve = async () => {
    if (!resolvingReport) return;
    setSubmittingResolution(true);
    try {
      await reviewService.resolveAdminReport(resolvingReport.id, {
        note: resolverNote.trim() || undefined,
        actionOnReview,
      });
      message.success(`Report #${resolvingReport.id} resolved successfully`);
      setIsResolveModalOpen(false);
      setResolvingReport(null);
      setIsDetailModalOpen(false);
      fetchReports();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Failed to resolve report';
      message.error(msg);
    } finally {
      setSubmittingResolution(false);
    }
  };

  const handleOpenDismissModal = (report: ModerationReport) => {
    setDismissingReport(report);
    setDismissNote('');
    setIsDismissModalOpen(true);
  };

  const handleSubmitDismiss = async () => {
    if (!dismissingReport) return;
    setSubmittingDismiss(true);
    try {
      await reviewService.dismissAdminReport(dismissingReport.id, {
        note: dismissNote.trim() || undefined,
      });
      message.success(`Report #${dismissingReport.id} dismissed`);
      setIsDismissModalOpen(false);
      setDismissingReport(null);
      setIsDetailModalOpen(false);
      fetchReports();
    } catch {
      message.error('Failed to dismiss report');
    } finally {
      setSubmittingDismiss(false);
    }
  };

  const renderReporterBadge = (record: ModerationReport) => {
    const isStaff = Boolean(record.reporter_employee || record.reporter_employee_id);
    const staff = record.reporter_employee;
    const customer = record.reporter_customer;

    if (isStaff) {
      return (
        <div className="text-xs space-y-0.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold text-[#004996] flex items-center gap-1">
              <IdcardOutlined /> Staff ({staff?.role || 'EMPLOYEE'})
            </span>
          </div>
          <p className="font-medium text-gray-900 m-0 leading-tight">
            {staff?.full_name || 'Staff Member'}
          </p>
          <span className="text-xs text-gray-500 font-mono block">
            {new Date(record.created_at).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            })}
          </span>
        </div>
      );
    }

    return (
      <div className="text-xs space-y-0.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-semibold text-[#15803d] flex items-center gap-1">
            <UserOutlined /> Customer
          </span>
        </div>
        <p className="font-medium text-gray-900 m-0 leading-tight">
          {customer?.full_name || 'Customer'}
        </p>
        <span className="text-xs text-gray-500 font-mono block">
          {new Date(record.created_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })}
        </span>
      </div>
    );
  };

  // Compact Streamlined Columns
  const reportColumns = [
    {
      title: 'Reported Review',
      key: 'review',
      render: (_: any, record: ModerationReport) => (
        <div
          className="space-y-0.5 max-w-sm cursor-pointer group"
          onClick={() => handleOpenDetailModal(record)}
        >
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-gray-900 group-hover:text-[#004996] transition-colors truncate">
              {record.reviews?.medicines?.medicine_name || `Review #${record.review_id}`}
            </span>
            <span className="text-xs text-gray-500 font-mono shrink-0">
              {record.reviews?.rating_stars || 5}/5
            </span>
          </div>
          <p className="text-xs text-gray-600 m-0 line-clamp-1 italic">
            &ldquo;{record.reviews?.comment || 'No comment text'}&rdquo;
          </p>
        </div>
      ),
    },
    {
      title: 'Violation Reason',
      key: 'reason',
      width: 170,
      render: (_: any, record: ModerationReport) => (
        <div className="space-y-0.5">
          <span className="text-xs font-bold text-[#b91c1c] block">
            {record.reason}
          </span>
          {record.description && (
            <p className="text-xs text-gray-500 m-0 truncate max-w-[150px]">
              {record.description}
            </p>
          )}
        </div>
      ),
    },
    {
      title: 'Reporter',
      key: 'reporter',
      width: 170,
      render: (_: any, record: ModerationReport) => renderReporterBadge(record),
    },
    {
      title: 'Status',
      key: 'status',
      width: 110,
      render: (_: any, record: ModerationReport) => {
        let statusClass = 'text-[#b45309] font-semibold text-sm';
        if (record.status === 'RESOLVED') statusClass = 'text-[#15803d] font-semibold text-sm';
        if (record.status === 'DISMISSED') statusClass = 'text-gray-500 font-semibold text-sm';
        return (
          <span className={statusClass}>
            {record.status}
          </span>
        );
      },
    },
    {
      title: 'Action',
      key: 'actions',
      width: 100,
      align: 'right' as const,
      render: (_: any, record: ModerationReport) => (
        <Button
          size="small"
          onClick={() => handleOpenDetailModal(record)}
          className="text-xs px-2.5 text-gray-700 hover:text-gray-900 border-gray-300"
        >
          Details
        </Button>
      ),
    },
  ];

  const auditColumns = [
    {
      title: 'Action',
      key: 'action',
      width: 170,
      render: (_: any, record: ModerationAuditLog) => (
        <span className="font-mono text-xs font-semibold text-gray-800">
          {record.action}
        </span>
      ),
    },
    {
      title: 'Target Review',
      key: 'review',
      render: (_: any, record: ModerationAuditLog) => (
        <div className="text-xs space-y-0.5">
          {record.review_id ? (
            <>
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-gray-800">
                  Review #{record.review_id}
                </span>
                {record.reviews?.medicines?.medicine_name && (
                  <span className="text-gray-500 truncate">
                    ({record.reviews.medicines.medicine_name})
                  </span>
                )}
              </div>
              {record.reviews?.comment && (
                <p className="text-gray-600 m-0 line-clamp-1 italic">
                  &ldquo;{record.reviews.comment}&rdquo;
                </p>
              )}
            </>
          ) : (
            <span className="text-gray-400">N/A</span>
          )}
        </div>
      ),
    },
    {
      title: 'Actor',
      key: 'actor',
      width: 170,
      render: (_: any, record: ModerationAuditLog) => (
        <div className="text-xs space-y-0.5">
          <span className="font-medium text-gray-800 block">
            {record.performed_by_employee?.full_name ||
              record.performed_by_customer?.full_name ||
              'System'}
          </span>
          <span className="text-[10px] text-gray-400 font-mono">
            {record.performed_by_role || 'SYSTEM'}
          </span>
        </div>
      ),
    },
    {
      title: 'Reason / Details',
      key: 'reason',
      render: (_: any, record: ModerationAuditLog) => (
        <div className="text-xs space-y-1 max-w-md">
          <p className="m-0 text-gray-800 font-normal">{record.reason || 'No description'}</p>
          {renderAuditMetaDetails(record.meta)}
        </div>
      ),
    },
    {
      title: 'Timestamp',
      key: 'timestamp',
      width: 150,
      render: (_: any, record: ModerationAuditLog) => (
        <span className="text-xs text-gray-400 font-mono">
          {new Date(record.created_at).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <SafetyCertificateOutlined className="text-lg text-[#004996]" />
            <h1 className="text-xl font-bold text-gray-900 m-0">
              Content Moderation & Reports Center
            </h1>
          </div>
          <p className="text-sm text-gray-500 mt-1 m-0">
            6-Layer moderation system: anti-spam rules, AI signals, violation reports, and audit trail.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/admin/reviews">
            <Button size="middle" className="text-sm text-gray-700">
              <ArrowLeftOutlined className="text-xs" /> Back to Reviews
            </Button>
          </Link>
          <Button
            size="middle"
            icon={<ReloadOutlined className="text-xs" />}
            onClick={() => (activeTab === 'reports' ? fetchReports() : fetchAuditLogs())}
            loading={reportsLoading || auditLoading}
            className="text-sm text-gray-700"
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key)}
        items={[
          {
            key: 'reports',
            label: (
              <span className="flex items-center gap-1.5 font-medium text-sm">
                <WarningOutlined />
                <span>Flagged Reports</span>
                {reportsTotal > 0 && reportStatusFilter === 'PENDING' && (
                  <Badge count={reportsTotal} className="ml-1" />
                )}
              </span>
            ),
            children: (
              <div className="space-y-3">
                {/* Reports Toolbar */}
                <div className="bg-white p-3 rounded-lg border border-gray-200 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <Select
                      size="middle"
                      value={reportStatusFilter}
                      onChange={(val) => {
                        setReportStatusFilter(val);
                        setReportsPage(1);
                      }}
                      className="w-40"
                      options={[
                        { value: 'PENDING', label: 'Status: Pending' },
                        { value: 'RESOLVED', label: 'Status: Resolved' },
                        { value: 'DISMISSED', label: 'Status: Dismissed' },
                        { value: 'ALL', label: 'All' },
                      ]}
                    />

                    <Select
                      size="middle"
                      value={reportReasonFilter}
                      onChange={(val) => {
                        setReportReasonFilter(val);
                        setReportsPage(1);
                      }}
                      allowClear
                      placeholder="All Reasons"
                      className="w-44"
                      options={[
                        { value: 'SPAM', label: 'Spam' },
                        { value: 'HARASSMENT', label: 'Harassment' },
                        { value: 'MISINFORMATION', label: 'Misinformation' },
                        { value: 'INAPPROPRIATE', label: 'Inappropriate' },
                        { value: 'OTHER', label: 'Other' },
                      ]}
                    />
                  </div>

                  <span className="text-xs text-gray-500 font-medium ml-auto">
                    Total {reportsTotal} report{reportsTotal === 1 ? '' : 's'}
                  </span>
                </div>

                {/* Desktop & Tablet Table (>= 768px) */}
                <div className="hidden md:block bg-white rounded-lg border border-gray-200 overflow-hidden">
                  <Table
                    rowKey="id"
                    columns={reportColumns}
                    dataSource={reports}
                    loading={reportsLoading}
                    pagination={false}
                    size="middle"
                  />
                  {/* Pagination Footer */}
                  <div className="p-4 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3">
                    <span className="text-sm text-gray-500">
                      Showing {reportsTotal > 0 ? (reportsPage - 1) * reportsPageSize + 1 : 0} -{' '}
                      {Math.min(reportsPage * reportsPageSize, reportsTotal)} of {reportsTotal} reports
                    </span>
                    <Pagination
                      className="custom-pagination"
                      current={reportsPage}
                      pageSize={reportsPageSize}
                      total={Math.max(reportsTotal, 1)}
                      onChange={(p, ps) => {
                        setReportsPage(p);
                        if (ps && ps !== reportsPageSize) setReportsPageSize(ps);
                      }}
                      showSizeChanger={false}
                      itemRender={(_page, type, originalElement) => {
                        if (type === 'prev') {
                          return <span className="px-1 text-[#004996] text-sm font-medium hover:underline cursor-pointer select-none">&lt; Prev</span>;
                        }
                        if (type === 'next') {
                          return <span className="px-1 text-[#004996] text-sm font-medium hover:underline cursor-pointer select-none">Next &gt;</span>;
                        }
                        return originalElement;
                      }}
                    />
                  </div>
                </div>

                {/* Mobile Vertical Report List (< 768px) */}
                <div className="block md:hidden bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
                  {reportsLoading ? (
                    <div className="py-12 text-center text-gray-500 text-sm">
                      <Spin className="mr-2" /> Loading reports...
                    </div>
                  ) : reports.length === 0 ? (
                    <div className="py-12 text-center text-gray-500 text-sm">
                      No moderation reports found.
                    </div>
                  ) : (
                    reports.map((record) => {
                      const isPending = record.status === 'PENDING';
                      let statusClass = 'text-[#b45309] font-semibold text-xs';
                      if (record.status === 'RESOLVED') statusClass = 'text-[#15803d] font-semibold text-xs';
                      if (record.status === 'DISMISSED') statusClass = 'text-gray-500 font-semibold text-xs';

                      return (
                        <div key={record.id} className="p-3.5 space-y-2 text-sm">
                          {/* 1. Header: Product & Star Rating & Review Status */}
                          <div className="flex items-center justify-between gap-2">
                            <span
                              onClick={() => handleOpenDetailModal(record)}
                              className="font-semibold text-sm text-gray-900 line-clamp-1 cursor-pointer hover:text-[#004996]"
                            >
                              {record.reviews?.medicines?.medicine_name || `Review #${record.review_id}`}
                            </span>
                            <span className={statusClass}>
                              {record.status}
                            </span>
                          </div>

                          {/* 2. Reason & Description */}
                          <div className="space-y-0.5">
                            <span className="text-xs font-bold text-[#b91c1c] block">
                              Reason: {record.reason}
                            </span>
                            {record.description && (
                              <p className="text-xs text-gray-600 m-0 italic line-clamp-2">
                                &ldquo;{record.description}&rdquo;
                              </p>
                            )}
                          </div>

                          {/* 3. Reported Review Text preview */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 text-xs text-gray-500">
                              <span className="font-mono font-medium text-gray-900">
                                {record.reviews?.rating_stars || 5}/5
                              </span>
                              <span>·</span>
                              <span>
                                by {record.reviews?.customers?.full_name || 'Customer'}
                              </span>
                            </div>
                            <p className="text-sm text-gray-700 m-0 line-clamp-2 leading-relaxed">
                              {record.reviews?.comment || 'No comment text'}
                            </p>
                          </div>

                          {/* 4. Reporter Details */}
                          <div className="pt-1">{renderReporterBadge(record)}</div>

                          {/* 5. Actions Row */}
                          <div className="flex items-center justify-end pt-2 border-t border-gray-100">
                            <Button
                              size="small"
                              onClick={() => handleOpenDetailModal(record)}
                              className="text-xs px-2.5 text-gray-700 hover:text-gray-900 border-gray-300"
                            >
                              Details
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}

                  {/* Mobile Pagination */}
                  {reportsTotal > 0 && (
                    <div className="p-4 flex flex-col items-center justify-between gap-3 border-t border-gray-100">
                      <span className="text-xs text-gray-500">
                        Showing {(reportsPage - 1) * reportsPageSize + 1} -{' '}
                        {Math.min(reportsPage * reportsPageSize, reportsTotal)} of {reportsTotal} reports
                      </span>
                      <Pagination
                        className="custom-pagination"
                        current={reportsPage}
                        pageSize={reportsPageSize}
                        total={Math.max(reportsTotal, 1)}
                        onChange={(p, ps) => {
                          setReportsPage(p);
                          if (ps && ps !== reportsPageSize) setReportsPageSize(ps);
                        }}
                        showSizeChanger={false}
                        itemRender={(_page, type, originalElement) => {
                          if (type === 'prev') {
                            return <span className="px-1 text-[#004996] text-sm font-medium hover:underline cursor-pointer select-none">&lt; Prev</span>;
                          }
                          if (type === 'next') {
                            return <span className="px-1 text-[#004996] text-sm font-medium hover:underline cursor-pointer select-none">Next &gt;</span>;
                          }
                          return originalElement;
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            ),
          },
          {
            key: 'audit',
            label: (
              <span className="flex items-center gap-1.5 font-medium text-sm">
                <HistoryOutlined />
                <span>Moderation Audit Trail</span>
              </span>
            ),
            children: (
              <div className="space-y-3">
                {/* Audit Toolbar */}
                <div className="bg-white p-3 rounded-lg border border-gray-200 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <Select
                      size="middle"
                      value={auditActionFilter}
                      onChange={(val) => {
                        setAuditActionFilter(val);
                        setAuditPage(1);
                      }}
                      allowClear
                      placeholder="Filter by Action"
                      className="w-64"
                      options={[
                        { value: 'AUTO_APPROVE', label: 'Action: AUTO_APPROVE' },
                        { value: 'AUTO_FLAG_PENDING', label: 'Action: AUTO_FLAG_PENDING' },
                        { value: 'AUTO_FLAG_SPAM', label: 'Action: AUTO_FLAG_SPAM' },
                        { value: 'USER_REPORT', label: 'Action: USER_REPORT' },
                        { value: 'STAFF_REPORT', label: 'Action: STAFF_REPORT' },
                        { value: 'RESOLVE_REPORT', label: 'Action: RESOLVE_REPORT' },
                        { value: 'DISMISS_REPORT', label: 'Action: DISMISS_REPORT' },
                        { value: 'ADMIN_STATUS_APPROVED', label: 'Action: ADMIN_STATUS_APPROVED' },
                        { value: 'ADMIN_STATUS_HIDDEN', label: 'Action: ADMIN_STATUS_HIDDEN' },
                        { value: 'ADMIN_STATUS_SPAM', label: 'Action: ADMIN_STATUS_SPAM' },
                        { value: 'ADMIN_REPLY', label: 'Action: ADMIN_REPLY' },
                        { value: 'ADMIN_DELETE', label: 'Action: ADMIN_DELETE' },
                      ]}
                    />
                  </div>

                  <span className="text-xs text-gray-500 font-medium ml-auto">
                    Total {auditTotal} activity log{auditTotal === 1 ? '' : 's'}
                  </span>
                </div>

                {/* Desktop & Tablet Table (>= 768px) */}
                <div className="hidden md:block bg-white rounded-lg border border-gray-200 overflow-hidden">
                  <Table
                    rowKey="id"
                    columns={auditColumns}
                    dataSource={auditLogs}
                    loading={auditLoading}
                    pagination={false}
                    size="middle"
                  />
                  {/* Pagination Footer */}
                  <div className="p-4 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3">
                    <span className="text-sm text-gray-500">
                      Showing {auditTotal > 0 ? (auditPage - 1) * auditPageSize + 1 : 0} -{' '}
                      {Math.min(auditPage * auditPageSize, auditTotal)} of {auditTotal} audit entries
                    </span>
                    <Pagination
                      className="custom-pagination"
                      current={auditPage}
                      pageSize={auditPageSize}
                      total={Math.max(auditTotal, 1)}
                      onChange={(p, ps) => {
                        setAuditPage(p);
                        if (ps && ps !== auditPageSize) setAuditPageSize(ps);
                      }}
                      showSizeChanger={false}
                      itemRender={(_page, type, originalElement) => {
                        if (type === 'prev') {
                          return <span className="px-1 text-[#004996] text-sm font-medium hover:underline cursor-pointer select-none">&lt; Prev</span>;
                        }
                        if (type === 'next') {
                          return <span className="px-1 text-[#004996] text-sm font-medium hover:underline cursor-pointer select-none">Next &gt;</span>;
                        }
                        return originalElement;
                      }}
                    />
                  </div>
                </div>

                {/* Mobile Vertical Audit List (< 768px) */}
                <div className="block md:hidden bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
                  {auditLoading ? (
                    <div className="py-12 text-center text-gray-500 text-sm">
                      <Spin className="mr-2" /> Loading audit log...
                    </div>
                  ) : auditLogs.length === 0 ? (
                    <div className="py-12 text-center text-gray-500 text-sm">
                      No audit logs found.
                    </div>
                  ) : (
                    auditLogs.map((log) => (
                      <div key={log.id} className="p-3.5 space-y-1.5 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-semibold text-gray-800">
                            {log.action}
                          </span>
                          <span className="text-xs text-gray-400 font-mono">
                            {new Date(log.created_at).toLocaleString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>

                        {log.review_id && (
                          <div className="text-gray-600">
                            <span className="font-medium text-gray-900">Review #{log.review_id}</span>
                            {log.reviews?.medicines?.medicine_name && (
                              <span> ({log.reviews.medicines.medicine_name})</span>
                            )}
                          </div>
                        )}

                        <p className="text-gray-800 m-0 leading-relaxed font-normal">
                          {log.reason || 'No description'}
                        </p>

                        {renderAuditMetaDetails(log.meta)}

                        <div className="text-xs text-gray-400 pt-0.5">
                          Actor: {log.performed_by_employee?.full_name || log.performed_by_customer?.full_name || 'System'} ({log.performed_by_role || 'SYSTEM'})
                        </div>
                      </div>
                    ))
                  )}

                  {/* Mobile Pagination */}
                  {auditTotal > 0 && (
                    <div className="p-4 flex flex-col items-center justify-between gap-3 border-t border-gray-100">
                      <span className="text-xs text-gray-500">
                        Showing {(auditPage - 1) * auditPageSize + 1} -{' '}
                        {Math.min(auditPage * auditPageSize, auditTotal)} of {auditTotal} audit entries
                      </span>
                      <Pagination
                        className="custom-pagination"
                        current={auditPage}
                        pageSize={auditPageSize}
                        total={Math.max(auditTotal, 1)}
                        onChange={(p, ps) => {
                          setAuditPage(p);
                          if (ps && ps !== auditPageSize) setAuditPageSize(ps);
                        }}
                        showSizeChanger={false}
                        itemRender={(_page, type, originalElement) => {
                          if (type === 'prev') {
                            return <span className="px-1 text-[#004996] text-sm font-medium hover:underline cursor-pointer select-none">&lt; Prev</span>;
                          }
                          if (type === 'next') {
                            return <span className="px-1 text-[#004996] text-sm font-medium hover:underline cursor-pointer select-none">Next &gt;</span>;
                          }
                          return originalElement;
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            ),
          },
        ]}
      />

      {/* Report Detail Modal */}
      <Modal
        title={
          detailReport && (
            <div className="flex items-center justify-between pr-6 text-base font-bold text-gray-900">
              <span>Report #{detailReport.id} Details</span>
              <span
                className={`text-xs font-semibold ${detailReport.status === 'RESOLVED'
                  ? 'text-[#15803d]'
                  : detailReport.status === 'DISMISSED'
                    ? 'text-gray-500'
                    : 'text-[#b45309]'
                  }`}
              >
                {detailReport.status}
              </span>
            </div>
          )
        }
        open={isDetailModalOpen}
        onCancel={() => {
          setIsDetailModalOpen(false);
          setDetailReport(null);
        }}
        width={560}
        footer={
          detailReport && (
            <div className="flex items-center justify-between pt-2">
              <Button onClick={() => setIsDetailModalOpen(false)} className="text-sm">
                Close
              </Button>
              {detailReport.status === 'PENDING' && (
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => {
                      handleOpenDismissModal(detailReport);
                    }}
                    className="text-sm text-gray-700"
                  >
                    Dismiss Report
                  </Button>
                  <Button
                    type="primary"
                    onClick={() => {
                      handleOpenResolveModal(detailReport);
                    }}
                    className="text-sm font-medium !bg-[#004996] hover:!bg-[#004084]"
                  >
                    Resolve Report
                  </Button>
                </div>
              )}
            </div>
          )
        }
      >
        {detailReport && (
          <div className="space-y-5 py-2 text-sm text-gray-800 divide-y divide-gray-100">
            {/* Section 1: Reported Review */}
            <div className="space-y-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">
                Target Review
              </span>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-sm text-gray-900 m-0">
                    {detailReport.reviews?.medicines?.medicine_name || `Medicine #${detailReport.review_id}`}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                    <span className="font-mono font-medium text-gray-900">
                      Rating: {detailReport.reviews?.rating_stars || 5}/5
                    </span>
                    <span>·</span>
                    <span>Author: {detailReport.reviews?.customers?.full_name || 'Anonymous Customer'}</span>
                    <span>·</span>
                    <span className="font-medium text-gray-700">Status: {detailReport.reviews?.status || 'APPROVED'}</span>
                  </div>
                </div>
              </div>
              <p className="text-sm text-gray-800 m-0 leading-relaxed italic bg-gray-50/80 p-3 rounded border border-gray-100">
                &ldquo;{detailReport.reviews?.comment || 'No comment text provided'}&rdquo;
              </p>
            </div>

            {/* Section 2: Violation Info */}
            <div className="pt-4 space-y-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">
                Violation Reason & Explanation
              </span>
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-[#b91c1c]">
                  Reason: {detailReport.reason}
                </span>
                <span className="text-xs text-gray-400 font-mono">
                  {new Date(detailReport.created_at).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              {detailReport.description ? (
                <p className="text-sm text-gray-700 m-0 leading-relaxed font-normal">
                  {detailReport.description}
                </p>
              ) : (
                <p className="text-xs text-gray-400 m-0 italic">No additional note provided by reporter.</p>
              )}
            </div>

            {/* Section 3: Reporter Info */}
            <div className="pt-4 space-y-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">
                Reporter Information
              </span>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-xs text-gray-500 block">Reporter</span>
                  <span className="font-medium text-gray-900">
                    {detailReport.reporter_employee?.full_name || detailReport.reporter_customer?.full_name || 'Anonymous'}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">Role</span>
                  <span className="font-medium text-gray-800">
                    {detailReport.reporter_employee ? `Staff (${detailReport.reporter_employee.role || 'EMPLOYEE'})` : 'Customer'}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">Email</span>
                  <span className="text-gray-700 font-mono text-xs">
                    {detailReport.reporter_employee?.email || detailReport.reporter_customer?.email || 'N/A'}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">Report ID</span>
                  <span className="text-gray-700 font-mono text-xs">
                    #{detailReport.id}
                  </span>
                </div>
              </div>
            </div>

            {/* Section 4: Resolution Details (if completed) */}
            {detailReport.status !== 'PENDING' && (
              <div className="pt-4 space-y-2">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">
                  Resolution Decision
                </span>
                <div className="space-y-1 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-900">
                      Outcome: {detailReport.status}
                    </span>
                    {detailReport.resolved_at && (
                      <span className="text-xs text-gray-400 font-mono">
                        {new Date(detailReport.resolved_at).toLocaleString()}
                      </span>
                    )}
                  </div>
                  {detailReport.resolver_note && (
                    <p className="text-xs text-gray-600 m-0 italic pt-1">
                      Note: &ldquo;{detailReport.resolver_note}&rdquo;
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Resolve Report Modal */}
      <Modal
        title="Resolve Moderation Report"
        open={isResolveModalOpen}
        onOk={handleSubmitResolve}
        onCancel={() => {
          setIsResolveModalOpen(false);
          setResolvingReport(null);
        }}
        confirmLoading={submittingResolution}
        okText="Confirm Resolution"
        cancelText="Cancel"
        okButtonProps={{ style: { backgroundColor: '#004996' } }}
      >
        {resolvingReport && (
          <div className="space-y-4 py-2 text-sm text-gray-800">
            <div className="space-y-1.5 pb-3 border-b border-gray-100">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="font-semibold text-gray-900 block">
                  Report Reason:{' '}
                  <span className="text-[#b91c1c] font-bold">
                    {resolvingReport.reason}
                  </span>
                </span>
                <span className="text-xs text-gray-500">
                  Target Review Status:{' '}
                  <span
                    className={`font-semibold ${resolvingReport.reviews?.status === 'APPROVED'
                        ? 'text-[#15803d]'
                        : resolvingReport.reviews?.status === 'HIDDEN'
                          ? 'text-gray-500'
                          : 'text-[#b45309]'
                      }`}
                  >
                    {resolvingReport.reviews?.status || 'APPROVED'}
                  </span>
                </span>
              </div>
              <p className="text-gray-600 m-0 italic">&ldquo;{resolvingReport.reviews?.comment}&rdquo;</p>
            </div>

            <div>
              <label className="font-medium text-gray-900 block mb-2">
                Action to apply on target review:
              </label>
              <Radio.Group
                value={actionOnReview}
                onChange={(e) => setActionOnReview(e.target.value)}
                className="w-full"
              >
                <div className="flex flex-col gap-2.5">
                  <Radio value="APPROVE" className="!flex items-center text-sm text-gray-800">
                    Approve Review (Publish on storefront)
                  </Radio>
                  <Radio value="KEEP" className="!flex items-center text-sm text-gray-800">
                    Keep Current Review Status ({resolvingReport.reviews?.status || 'APPROVED'})
                  </Radio>
                  <Radio value="HIDE" className="!flex items-center text-sm text-gray-800">
                    Hide Review (Unpublish from storefront)
                  </Radio>
                  <Radio value="SPAM" className="!flex items-center text-sm text-gray-800">
                    Mark as Spam
                  </Radio>
                </div>
              </Radio.Group>
            </div>

            <div>
              <label className="font-medium text-gray-900 block mb-1.5">
                Resolution Note (Saved to audit trail):
              </label>
              <Input.TextArea
                rows={3}
                value={resolverNote}
                onChange={(e) => setResolverNote(e.target.value)}
                placeholder="Reason for decision..."
                className="text-sm text-gray-800"
              />
            </div>
          </div>
        )}
      </Modal>

      {/* Dismiss Report Modal */}
      <Modal
        title="Dismiss Moderation Report"
        open={isDismissModalOpen}
        onOk={handleSubmitDismiss}
        onCancel={() => {
          setIsDismissModalOpen(false);
          setDismissingReport(null);
        }}
        confirmLoading={submittingDismiss}
        okText="Dismiss Report"
        cancelText="Cancel"
      >
        {dismissingReport && (
          <div className="space-y-3 py-2 text-sm">
            <p className="text-gray-700 m-0">
              Are you sure you want to dismiss this report? The review will remain unchanged and the report will be marked as dismissed.
            </p>

            <div>
              <label className="font-medium text-gray-800 block mb-1">
                Dismissal Note:
              </label>
              <Input.TextArea
                rows={3}
                value={dismissNote}
                onChange={(e) => setDismissNote(e.target.value)}
                placeholder="e.g. Content does not violate terms..."
                className="text-sm"
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
