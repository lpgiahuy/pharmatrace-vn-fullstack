'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ImagePlusIcon } from 'lucide-react';
import { App, Spin } from 'antd';
import { returnService, type ReturnDetail } from '@/services/return.service';
import { ReturnActions } from '@/components/returns/ReturnActions';
import {
  ErrorSummary, METHOD_LABELS, PAYMENT_METHOD_LABELS, reasonText, RESOLUTION_LABELS,
  ReturnHandover, ReturnPhotos, ReturnProgress, ReturnStatusBadge, ReturnTimeline, returnErrors,
} from '@/components/returns/ReturnParts';
import { useAuthStore } from '@/store/useAuthStore';
import { useHydrated } from '@/hooks/useHydrated';
import { formatCurrency, formatDateTime } from '@/utils';

const PHOTO_STATUSES = ['REQUESTED', 'NEEDS_INFO', 'APPROVED', 'RECEIVED'];

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <h2 className="m-0 mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </section>
  );
}

export default function AdminReturnDetailPage() {
  const { message } = App.useApp();
  const id = Number(useParams<{ id: string }>().id);
  const hydrated = useHydrated();
  const getUser = useAuthStore(state => state.getUser);
  const role = hydrated ? String(getUser()?.role ?? '').toUpperCase().replace(/[\s_-]/g, '') : '';
  const [detail, setDetail] = useState<ReturnDetail>();
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    returnService.detail('admin', id)
      .then(res => { if (active) { setDetail(res.data); setErrors([]); } })
      .catch(error => { if (active) setErrors(returnErrors(error, 'We could not load this request. Please try again.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, version]);

  async function addPhoto(file: File) {
    try {
      await returnService.upload('admin', id, file);
      message.success('Photo added.');
      setVersion(value => value + 1);
    } catch (error) {
      setErrors(returnErrors(error, 'The photo could not be uploaded.'));
    }
  }

  if (loading) return <div className="flex justify-center py-24"><Spin size="large" /></div>;
  if (!detail) {
    return <div className="space-y-3"><ErrorSummary messages={errors} /><Link href="/admin/returns" className="text-sm font-semibold text-[#004996] hover:underline">Back to returns</Link></div>;
  }

  const { refund } = detail;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/returns" className="text-xs font-semibold text-[#004996] hover:underline">← Returns &amp; exchanges</Link>
          <h1 className="m-0 mt-1 font-mono text-lg font-bold text-slate-900">{detail.code}</h1>
          <p className="m-0 text-xs text-slate-500">
            {RESOLUTION_LABELS[detail.resolution]} · {METHOD_LABELS[detail.return_method]} · {detail.channel.toLowerCase()} ·
            {' '}<Link href={`/admin/orders/${detail.order_id}`} className="font-mono font-semibold text-[#004996] hover:underline">Order {detail.order_code ?? `#${detail.order_id}`}</Link> · {formatDateTime(detail.created_at)}
          </p>
        </div>
        <ReturnStatusBadge status={detail.status} />
      </header>

      <ErrorSummary messages={errors} />
      <ReturnActions detail={detail} role={role} onChanged={() => setVersion(value => value + 1)} />
      <ReturnProgress status={detail.status} />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card title="Items">
            <ul className="m-0 list-none divide-y divide-slate-200 p-0">
              {detail.lines.map(line => (
                <li key={line.order_item_id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="m-0 text-sm font-semibold text-slate-900">{line.medicine_name} <span className="font-normal text-slate-500">({line.unit_name})</span></p>
                      <p className="m-0 text-xs text-slate-500">
                        {reasonText(line)}
                        {line.restricted && <span className="ml-1 font-semibold text-amber-800">· prescription / special storage</span>}
                      </p>
                    </div>
                    <p className="m-0 text-xs tabular-nums text-slate-600">
                      Requested {line.quantity}
                      {line.approved_quantity !== null && <> · approved {line.approved_quantity}</>}
                      {line.received_quantity !== null && <> · received {line.received_quantity}</>}
                      {line.pass_quantity !== null && <> · passed {line.pass_quantity} / failed {line.fail_quantity}</>}
                      {!!line.mismatch_quantity && <span className="font-semibold text-red-700"> · {line.mismatch_quantity} not our product</span>}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            {detail.description && <p className="m-0 mt-3 border-l-2 border-slate-300 pl-2.5 text-xs text-slate-600">Customer note: {detail.description}</p>}
            {detail.staff_note && <p className="m-0 mt-2 border-l-2 border-slate-300 pl-2.5 text-xs text-slate-600">Staff note: {detail.staff_note}</p>}
          </Card>

          <Card title="History">
            <ReturnTimeline events={detail.events} showStaff />
          </Card>
        </div>

        <div className="space-y-4">
          <ReturnHandover detail={detail} />

          {(refund || detail.replacement_order_id) && (
            <Card title="Resolution">
              {detail.replacement_order_id && (
                <p className="m-0 text-sm text-slate-700">Replacement order <Link href={`/admin/orders/${detail.replacement_order_id}`} className="font-mono font-semibold text-[#004996] hover:underline">#{detail.replacement_order_id}</Link></p>
              )}
              {refund && (
                <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-slate-500">Goods value</dt><dd className="m-0 text-right tabular-nums">{formatCurrency(refund.goods_value)}</dd>
                  <dt className="text-slate-500">Return fee</dt><dd className="m-0 text-right tabular-nums">−{formatCurrency(refund.customer_fee)}</dd>
                  <dt className="font-semibold text-slate-900">Refund</dt><dd className="m-0 text-right font-semibold tabular-nums">{formatCurrency(refund.refund_amount)}</dd>
                  <dt className="text-slate-500">Method</dt><dd className="m-0 text-right">{PAYMENT_METHOD_LABELS[refund.payment_method]}</dd>
                  {refund.payment_reference && <><dt className="text-slate-500">Reference</dt><dd className="m-0 break-all text-right font-mono text-xs">{refund.payment_reference}</dd></>}
                  <dt className="text-slate-500">Paid out</dt><dd className="m-0 text-right">{refund.executed_at ? formatDateTime(refund.executed_at) : 'Pending'}</dd>
                </dl>
              )}
            </Card>
          )}

          <Card title="Photos">
            <ReturnPhotos scope="admin" detail={detail} />
            {PHOTO_STATUSES.includes(detail.status) && (
              <label className="mt-3 inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:border-[#004996] hover:text-[#004996] focus-within:outline-2 focus-within:outline-[#004996]">
                <ImagePlusIcon className="h-4 w-4" aria-hidden />
                Add photo
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={event => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void addPhoto(file);
                }} />
              </label>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
