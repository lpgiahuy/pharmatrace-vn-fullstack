'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, PackageOpen } from 'lucide-react';
import { Pagination, Select, Spin } from 'antd';
import { returnService, type ReturnRequest, type ReturnStatus } from '@/services/return.service';
import { CustomerGate, ErrorSummary, METHOD_LABELS, RESOLUTION_LABELS, ReturnStatusBadge, STATUS_META, returnErrors } from '@/components/returns/ReturnParts';
import { formatDateTime } from '@/utils';

const PAGE_SIZE = 10;

function ReturnList() {
  const [status, setStatus] = useState<ReturnStatus>();
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ReturnRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    returnService.list('customer', { page, limit: PAGE_SIZE, status })
      .then(res => { if (active) { setRows(res.data); setTotal(res.pagination.total); setErrors([]); } })
      .catch(error => { if (active) setErrors(returnErrors(error, 'We could not load your returns. Please try again.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, status]);

  return (
    <div className="w-full pb-16">
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center text-xs text-slate-500 sm:text-sm">
        <Link href="/account" className="font-medium transition-colors hover:text-slate-900">Account</Link>
        <ChevronRight className="mx-2 h-3.5 w-3.5 text-slate-400" aria-hidden />
        <span className="font-semibold text-slate-900">My returns</span>
      </nav>

      <header className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h1 className="m-0 text-xl font-bold text-slate-900">My returns</h1>
          <p className="m-0 mt-0.5 text-sm text-slate-500">Return or exchange items from delivered orders within 7 days.</p>
        </div>
        <Select<ReturnStatus>
          allowClear
          placeholder="All statuses"
          aria-label="Filter by status"
          className="w-48"
          value={status}
          onChange={value => { setLoading(true); setPage(1); setStatus(value); }}
          options={(Object.keys(STATUS_META) as ReturnStatus[]).map(key => ({ value: key, label: STATUS_META[key].label }))}
        />
      </header>

      <ErrorSummary messages={errors} />

      {loading ? (
        <div className="flex justify-center py-16"><Spin /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-white p-12 text-center shadow-xs">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-400"><PackageOpen className="h-6 w-6" aria-hidden /></span>
          <h2 className="m-0 text-base font-semibold text-slate-900">{status ? 'No returns with this status' : 'No returns yet'}</h2>
          <p className="mx-auto mb-5 mt-1 max-w-sm text-sm text-slate-500">Open a delivered order and choose “Return items” to start a return or exchange.</p>
          <Link href="/account/orders" className="inline-flex items-center rounded-md bg-[#004996] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#003875]">View my orders</Link>
        </div>
      ) : (
        <>
          <ul className="m-0 list-none space-y-3 p-0">
            {rows.map(row => (
              <li key={row.id}>
                <Link href={`/account/returns/${row.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-white p-4 shadow-xs transition-colors hover:border-slate-300">
                  <div className="min-w-0">
                    <p className="m-0 font-mono text-sm font-semibold text-slate-900">{row.code}</p>
                    <p className="m-0 mt-0.5 text-xs text-slate-500">
                      {RESOLUTION_LABELS[row.resolution]} · {METHOD_LABELS[row.return_method]} · {formatDateTime(row.created_at)}
                    </p>
                  </div>
                  <span className="flex items-center gap-2">
                    <ReturnStatusBadge status={row.status} />
                    <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {total > PAGE_SIZE && (
            <div className="mt-4 flex justify-end">
              <Pagination
                current={page}
                pageSize={PAGE_SIZE}
                total={total}
                showSizeChanger={false}
                onChange={value => { setLoading(true); setPage(value); }}
                itemRender={(_page, type, originalElement) => {
                  if (type === 'prev') {
                    return <span className="px-1 text-slate-600 text-xs font-medium">&lt; Previous</span>;
                  }
                  if (type === 'next') {
                    return <span className="px-1 text-[#004996] text-xs font-medium">Next &gt;</span>;
                  }
                  return originalElement;
                }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function ReturnsPage() {
  return <CustomerGate redirect="/account/returns"><ReturnList /></CustomerGate>;
}
