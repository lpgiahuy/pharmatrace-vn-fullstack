import type { ReactNode } from 'react';
import { Button, Empty, Pagination, Spin } from 'antd';
import { EyeOutlined } from '@ant-design/icons';

export interface RecordCardData {
  key: string | number;
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  fields: Array<{ label: string; value: ReactNode; wide?: boolean }>;
  actionLabel?: string;
  actionLoading?: boolean;
  onAction: () => void;
}

interface RecordCardsProps<T> {
  items: T[];
  loading: boolean;
  emptyText: string;
  toCard: (item: T) => RecordCardData;
  page: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

/** Phone-sized replacement for a wide table: one card per record. Hidden from 768px up. */
export function RecordCards<T>({ items, loading, emptyText, toCard, page, total, pageSize, onPageChange }: RecordCardsProps<T>) {
  if (loading && !items.length) {
    return <div className="md:hidden flex justify-center rounded-md border border-gray-200 bg-white py-12"><Spin /></div>;
  }
  if (!items.length) {
    return <div className="md:hidden rounded-md border border-gray-200 bg-white py-8">
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
    </div>;
  }
  return <div className="md:hidden space-y-2.5">
    {items.map(item => {
      const card = toCard(item);
      return <article key={card.key} className="rounded-md border border-gray-200 bg-white p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="break-all font-mono text-sm font-semibold text-slate-900">{card.title}</div>
            {card.subtitle && <div className="mt-0.5 text-xs text-slate-500">{card.subtitle}</div>}
          </div>
          {card.badge && <div className="shrink-0">{card.badge}</div>}
        </div>
        <dl className="m-0 mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          {card.fields.map(field => <div key={field.label} className={field.wide ? 'col-span-2' : ''}>
            <dt className="text-slate-500">{field.label}</dt>
            <dd className="m-0 mt-0.5 break-words text-slate-800">{field.value}</dd>
          </div>)}
        </dl>
        <Button block className="mt-3" icon={<EyeOutlined />} loading={card.actionLoading} onClick={card.onAction}>
          {card.actionLabel || 'Details'}
        </Button>
      </article>;
    })}
    {total > pageSize && <div className="flex justify-center rounded-md border border-gray-200 bg-white py-2.5">
      <Pagination simple current={page} total={total} pageSize={pageSize} onChange={onPageChange} showSizeChanger={false} />
    </div>}
  </div>;
}
