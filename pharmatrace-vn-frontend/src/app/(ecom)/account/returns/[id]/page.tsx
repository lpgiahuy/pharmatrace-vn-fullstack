'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronRight, ImagePlus } from 'lucide-react';
import { App, Modal, Popconfirm, Spin } from 'antd';
import { returnService, type ReturnDetail, type ReturnMethod } from '@/services/return.service';
import {
  CustomerGate, ErrorSummary, METHOD_LABELS, PAYMENT_METHOD_LABELS, reasonText, RESOLUTION_LABELS,
  ReturnHandover, ReturnPhotos, ReturnProgress, ReturnStatusBadge, ReturnTimeline, returnErrors,
} from '@/components/returns/ReturnParts';
import { PickupAddressField } from '@/components/returns/PickupAddressField';
import { NeedsInfoReply } from '@/components/returns/NeedsInfoReply';
import { formatCurrency, formatDateTime } from '@/utils';

const CANCELLABLE = ['REQUESTED', 'NEEDS_INFO', 'APPROVED'];
const PHOTO_STATUSES = ['REQUESTED', 'NEEDS_INFO'];

function Outcome({ detail }: { detail: ReturnDetail }) {
  const { refund } = detail;
  if (refund) {
    return (
      <p className="m-0 text-sm text-slate-700">
        {refund.executed_at
          ? <>Refunded <strong>{formatCurrency(refund.refund_amount)}</strong> by {PAYMENT_METHOD_LABELS[refund.payment_method]} on {formatDateTime(refund.executed_at)}.</>
          : <>Refund of <strong>{formatCurrency(refund.refund_amount)}</strong> approved. The payout is being processed.</>}
      </p>
    );
  }
  if (detail.replacement_order_id) return <p className="m-0 text-sm text-slate-700">Your replacement order has been created and will be delivered to you.</p>;
  if (detail.status === 'CLOSED' && detail.resolution === 'REFUND') {
    return <p className="m-0 text-sm text-slate-700">No refund was issued because the returned goods did not pass the pharmacy&apos;s inspection.</p>;
  }
  return null;
}

function ReturnDetailView({ id }: { id: number }) {
  const { message } = App.useApp();
  const [detail, setDetail] = useState<ReturnDetail>();
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [methodOpen, setMethodOpen] = useState(false);
  const [method, setMethod] = useState<ReturnMethod>('CARRIER_PICKUP');
  const [address, setAddress] = useState('');

  const [version, setVersion] = useState(0);
  const reload = () => setVersion(value => value + 1);

  useEffect(() => {
    let active = true;
    returnService.detail('customer', id)
      .then(res => { if (active) { setDetail(res.data); setErrors([]); } })
      .catch(error => { if (active) setErrors(returnErrors(error, 'We could not load this request. Please try again.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, version]);

  async function run(task: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await task();
      message.success(success);
      setMethodOpen(false);
      reload();
    } catch (error) {
      setErrors(returnErrors(error, 'That did not work. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="flex min-h-[40vh] items-center justify-center"><Spin size="large" /></div>;
  if (!detail) {
    return <div className="space-y-4"><ErrorSummary messages={errors} /><Link href="/account/returns" className="text-sm font-semibold text-[#004996] hover:underline">Back to my returns</Link></div>;
  }

  const canCancel = CANCELLABLE.includes(detail.status) && !detail.replacement_order_id;
  const canChangeMethod = ['REQUESTED', 'APPROVED'].includes(detail.status) && !detail.handover.trackingNumber;

  return (
    <div className="w-full pb-16">
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center text-xs text-slate-500 sm:text-sm">
        <Link href="/account/returns" className="font-medium transition-colors hover:text-slate-900">My returns</Link>
        <ChevronRight className="mx-2 h-3.5 w-3.5 text-slate-400" aria-hidden />
        <span className="font-mono font-semibold text-slate-900">{detail.code}</span>
      </nav>

      <header className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h1 className="m-0 font-mono text-xl font-bold text-slate-900">{detail.code}</h1>
          <p className="m-0 mt-0.5 text-sm text-slate-500">
            {RESOLUTION_LABELS[detail.resolution]} · {METHOD_LABELS[detail.return_method]}
            {detail.order_code && <> · Order <span className="font-mono">{detail.order_code}</span></>} · {formatDateTime(detail.created_at)}
          </p>
        </div>
        <ReturnStatusBadge status={detail.status} />
      </header>

      <div className="space-y-5">
        <ErrorSummary messages={errors} />
        <ReturnProgress status={detail.status} audience="customer" />

        {detail.status === 'NEEDS_INFO' && (
          <NeedsInfoReply detail={detail} busy={busy} onSubmit={run} />
        )}

        {detail.status === 'REJECTED' && (
          <section role="status" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
            <h2 className="m-0 text-sm font-semibold">
              {detail.events.some(event => event.action === 'RECEIPT_REJECTED')
                ? 'The goods we received did not match your request'
                : 'This request was not approved'}
            </h2>
            {detail.staff_note && <p className="m-0 mt-1">{detail.staff_note}</p>}
            {detail.events.some(event => event.action === 'RECEIPT_REJECTED') && (
              <p className="m-0 mt-1">No refund or replacement will be issued. Contact the pharmacy to arrange collection of the parcel.</p>
            )}
          </section>
        )}

        <ReturnHandover detail={detail} />
        <Outcome detail={detail} />

        <section aria-labelledby="items-title">
          <h2 id="items-title" className="m-0 mb-2 text-sm font-bold text-slate-900">Items</h2>
          <ul className="m-0 list-none divide-y divide-slate-200 rounded-md border border-slate-200 bg-white p-0">
            {detail.lines.map(line => (
              <li key={line.order_item_id} className="flex flex-wrap items-start justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="m-0 text-sm font-semibold text-slate-900">{line.medicine_name}</p>
                  <p className="m-0 text-xs text-slate-500">{line.unit_name} · {reasonText(line)}</p>
                </div>
                <p className="m-0 text-xs text-slate-600">
                  Requested {line.quantity}
                  {line.approved_quantity !== null && <> · approved {line.approved_quantity}</>}
                  {line.received_quantity !== null && <> · received {line.received_quantity}</>}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="photos-title">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 id="photos-title" className="m-0 text-sm font-bold text-slate-900">Photos</h2>
            {PHOTO_STATUSES.includes(detail.status) && (
              <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:border-[#004996] hover:text-[#004996] focus-within:outline-2 focus-within:outline-[#004996]">
                <ImagePlus className="h-4 w-4" aria-hidden />
                Add photo
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={event => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void run(() => returnService.upload('customer', id, file), 'Photo added.');
                }} />
              </label>
            )}
          </div>
          <ReturnPhotos scope="customer" detail={detail} />
        </section>

        <section aria-labelledby="history-title">
          <h2 id="history-title" className="m-0 mb-3 text-sm font-bold text-slate-900">History</h2>
          <ReturnTimeline events={detail.events} showStaff={false} />
        </section>

        {(canCancel || canChangeMethod) && (
          <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
            {canChangeMethod && (
              <button type="button" onClick={() => { setMethod(detail.return_method === 'CARRIER_PICKUP' ? 'STORE_DROP_OFF' : 'CARRIER_PICKUP'); setAddress(''); setMethodOpen(true); }} className="min-h-[44px] cursor-pointer rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50">
                Change how I return the goods
              </button>
            )}
            {canCancel && (
              <Popconfirm title="Cancel this return request?" description="You can create a new request later while the order is still within the return window." okText="Cancel request" cancelText="Keep it" okButtonProps={{ danger: true }} onConfirm={() => run(() => returnService.act('customer', id, 'cancel'), 'Request cancelled.')}>
                <button type="button" disabled={busy} className="min-h-[44px] cursor-pointer rounded-md border border-red-300 bg-white px-4 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60">
                  Cancel request
                </button>
              </Popconfirm>
            )}
          </div>
        )}
      </div>

      <Modal title="Change how I return the goods" open={methodOpen} onCancel={() => setMethodOpen(false)} okText="Save" confirmLoading={busy} onOk={() => run(() => returnService.changeMethod(id, { returnMethod: method, pickupAddress: method === 'CARRIER_PICKUP' ? address.trim() || undefined : undefined }), 'Return method updated.')}>
        <p className="mt-0 text-sm text-slate-700">Switch to <strong>{METHOD_LABELS[method]}</strong>?</p>
        {method === 'CARRIER_PICKUP' && (
          <PickupAddressField id="new-address" value={address} onChange={setAddress} />
        )}
      </Modal>
    </div>
  );
}

export default function ReturnDetailPage() {
  const id = Number(useParams<{ id: string }>().id);
  return <CustomerGate redirect={`/account/returns/${id}`}><ReturnDetailView id={id} /></CustomerGate>;
}
