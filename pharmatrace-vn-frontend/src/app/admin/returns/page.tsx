'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PlusOutlined } from '@ant-design/icons';
import { Button, Empty, Input, Select, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { returnService, type ReturnRequest, type ReturnStatus } from '@/services/return.service';
import { ErrorSummary, METHOD_LABELS, RESOLUTION_LABELS, ReturnStatusBadge, STATUS_META, returnErrors } from '@/components/returns/ReturnParts';
import { formatDateTime } from '@/utils';

const PAGE_SIZE = 20;
const CHANNELS = { ONLINE: 'Online', COUNTER: 'Counter', PHONE: 'Phone' } as const;

const columns: ColumnsType<ReturnRequest> = [
  { title: 'Request', dataIndex: 'code', render: (code: string, row) => <Link href={`/admin/returns/${row.id}`} className="font-mono font-semibold text-[#004996] hover:underline">{code}</Link> },
  { title: 'Status', dataIndex: 'status', render: (status: ReturnStatus) => <ReturnStatusBadge status={status} /> },
  { title: 'Outcome', dataIndex: 'resolution', render: (value: ReturnRequest['resolution']) => RESOLUTION_LABELS[value] },
  { title: 'Return method', dataIndex: 'return_method', render: (value: ReturnRequest['return_method']) => METHOD_LABELS[value] },
  { title: 'Channel', dataIndex: 'channel', render: (value: ReturnRequest['channel']) => CHANNELS[value] },
  { title: 'Created', dataIndex: 'created_at', render: (value: string) => <span className="tabular-nums">{formatDateTime(value)}</span> },
];

export default function AdminReturnsPage() {
  const [status, setStatus] = useState<ReturnStatus>();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ReturnRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    returnService.list('admin', { page, limit: PAGE_SIZE, status, q: search || undefined })
      .then(res => { if (active) { setRows(res.data); setTotal(res.pagination.total); setErrors([]); } })
      .catch(error => { if (active) setErrors(returnErrors(error, 'We could not load return requests. Please try again.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, status, search]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-lg font-bold text-slate-900">Returns &amp; exchanges</h1>
          <p className="m-0 text-xs text-slate-500">Review requests, receive goods, inspect them and settle refunds or exchanges.</p>
        </div>
        <Link href="/admin/returns/new"><Button type="primary" icon={<PlusOutlined />}>New return at counter</Button></Link>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Input.Search
          allowClear
          placeholder="Search by request or order code"
          aria-label="Search returns"
          className="w-full sm:w-72"
          onSearch={value => { setLoading(true); setPage(1); setSearch(value.trim()); }}
        />
        <Select<ReturnStatus>
          allowClear
          placeholder="All statuses"
          aria-label="Filter by status"
          className="w-52"
          value={status}
          onChange={value => { setLoading(true); setPage(1); setStatus(value); }}
          options={(Object.keys(STATUS_META) as ReturnStatus[]).map(key => ({ value: key, label: STATUS_META[key].label }))}
        />
      </div>

      <ErrorSummary messages={errors} />

      <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
        <Table
          rowKey="id"
          dataSource={rows}
          columns={columns}
          loading={loading}
          size="middle"
          scroll={{ x: 760 }}
          pagination={{
            placement: ['bottomEnd'],
            current: page,
            pageSize: PAGE_SIZE,
            total,
            showSizeChanger: false,
            onChange: (value) => {
              setLoading(true);
              setPage(value);
            },
            itemRender: (_page, type, originalElement) => {
              if (type === 'prev') {
                return <span className="px-1 text-slate-600 text-xs font-medium">&lt; Previous</span>;
              }
              if (type === 'next') {
                return <span className="px-1 text-[#004996] text-xs font-medium">Next &gt;</span>;
              }
              return originalElement;
            },
          }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No return requests match these filters" /> }}
        />
      </div>
    </div>
  );
}
