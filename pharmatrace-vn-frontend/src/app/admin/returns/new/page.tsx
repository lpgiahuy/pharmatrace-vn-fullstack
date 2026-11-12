'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Input, Radio } from 'antd';
import { returnService, type ReturnEligibility } from '@/services/return.service';
import { ReturnForm } from '@/components/returns/ReturnForm';
import { ErrorSummary, returnErrors } from '@/components/returns/ReturnParts';
import { formatDateTime } from '@/utils';

const BLOCKERS = {
  RMA_ORDER_NOT_DELIVERED: 'This order has not been delivered yet.',
  RMA_RETURN_WINDOW_EXPIRED: 'This order is past the 7-day return window.',
  RMA_OPEN_REQUEST_EXISTS: 'This order already has a return request in progress.',
} as const;

export default function NewCounterReturnPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [looking, setLooking] = useState(false);
  const [eligibility, setEligibility] = useState<ReturnEligibility>();
  const [errors, setErrors] = useState<string[]>([]);
  const [channel, setChannel] = useState<'COUNTER' | 'PHONE'>('COUNTER');

  async function lookup() {
    if (!code.trim()) return setErrors(['Enter the order code printed on the customer’s receipt.']);
    setLooking(true);
    setEligibility(undefined);
    try {
      setEligibility((await returnService.lookup(code.trim())).data);
      setErrors([]);
    } catch (error) {
      setErrors(returnErrors(error, 'We could not look up this order. Please try again.'));
    } finally {
      setLooking(false);
    }
  }

  const blocker = eligibility?.blocker ? BLOCKERS[eligibility.blocker] : undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <Link href="/admin/returns" className="text-xs font-semibold text-[#004996] hover:underline">← Returns &amp; exchanges</Link>
        <h1 className="m-0 mt-1 text-lg font-bold text-slate-900">New return at counter</h1>
        <p className="m-0 text-xs text-slate-500">Record a return for a customer who is at the counter or on the phone.</p>
      </header>

      <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void lookup(); }}>
        <div className="min-w-0 flex-1">
          <label htmlFor="order-code" className="mb-1 block text-xs font-medium text-slate-700">Order code</label>
          <Input id="order-code" size="large" value={code} onChange={event => setCode(event.target.value)} placeholder="ORD-…" allowClear />
        </div>
        <Button htmlType="submit" type="primary" size="large" loading={looking}>Look up order</Button>
      </form>

      {!eligibility && <ErrorSummary messages={errors} />}

      {eligibility && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
            <p className="m-0 text-sm text-slate-600">
              Order <span className="font-mono font-semibold text-slate-900">{eligibility.orderCode}</span>
              {eligibility.deadline && !blocker && <> · return by {formatDateTime(eligibility.deadline)}</>}
            </p>
            <Radio.Group value={channel} onChange={event => setChannel(event.target.value)} optionType="button" options={[{ value: 'COUNTER', label: 'At counter' }, { value: 'PHONE', label: 'By phone' }]} />
          </div>

          {blocker ? (
            <div role="status" className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="m-0">{blocker}</p>
              {eligibility.openRequest && <Link href={`/admin/returns/${eligibility.openRequest.id}`} className="mt-2 inline-block font-semibold text-[#004996] hover:underline">Open request {eligibility.openRequest.code}</Link>}
            </div>
          ) : (
            <ReturnForm
              key={`${eligibility.orderId}-${channel}`}
              eligibility={eligibility}
              scope="admin"
              channel={channel}
              defaultMethod="STORE_DROP_OFF"
              onCreated={id => router.push(`/admin/returns/${id}`)}
            />
          )}
        </>
      )}
    </div>
  );
}
