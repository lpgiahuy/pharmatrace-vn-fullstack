'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { Spin } from 'antd';
import { returnService, type ReturnEligibility } from '@/services/return.service';
import { ReturnForm } from '@/components/returns/ReturnForm';
import { CustomerGate, ErrorSummary, returnErrors } from '@/components/returns/ReturnParts';
import { formatDateTime } from '@/utils';

const BLOCKERS = {
  RMA_ORDER_NOT_DELIVERED: 'This order has not been delivered yet, so it cannot be returned.',
  RMA_RETURN_WINDOW_EXPIRED: 'This order is past the 7-day return window counted from delivery.',
  RMA_OPEN_REQUEST_EXISTS: 'This order already has a return request in progress.',
} as const;

function NewReturn() {
  const router = useRouter();
  const orderId = Number(useSearchParams().get('orderId'));
  const validId = Number.isInteger(orderId) && orderId > 0;
  const [eligibility, setEligibility] = useState<ReturnEligibility>();
  const [loading, setLoading] = useState(validId);
  const [errors, setErrors] = useState<string[]>(validId ? [] : ['Choose an order from your order history first.']);

  useEffect(() => {
    if (!validId) return;
    let active = true;
    returnService.eligibility(orderId)
      .then(res => { if (active) setEligibility(res.data); })
      .catch(error => { if (active) setErrors(returnErrors(error, 'We could not load this order. Please try again.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [orderId, validId]);

  if (loading) return <div className="flex min-h-[40vh] items-center justify-center"><Spin size="large" /></div>;

  const blocker = eligibility?.blocker ? BLOCKERS[eligibility.blocker] : undefined;

  return (
    <div className="w-full pb-16">
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center text-xs text-slate-500 sm:text-sm">
        <Link href="/account/returns" className="font-medium transition-colors hover:text-slate-900">My returns</Link>
        <ChevronRight className="mx-2 h-3.5 w-3.5 text-slate-400" aria-hidden />
        <span className="font-semibold text-slate-900">New return</span>
      </nav>

      <header className="mb-4 border-b border-slate-200 pb-3">
        <h1 className="m-0 text-xl font-bold text-slate-900">Return or exchange items</h1>
        {eligibility && (
          <p className="m-0 mt-0.5 text-sm text-slate-500">
            Order <span className="font-mono font-semibold text-slate-700">{eligibility.orderCode}</span>
            {eligibility.deadline && !blocker && <> · return by {formatDateTime(eligibility.deadline)}</>}
          </p>
        )}
      </header>

      {!eligibility && <ErrorSummary messages={errors} />}

      {blocker && (
        <div role="status" className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="m-0">{blocker}</p>
          {eligibility?.openRequest && (
            <Link href={`/account/returns/${eligibility.openRequest.id}`} className="mt-2 inline-block font-semibold text-[#004996] underline-offset-2 hover:underline">
              View request {eligibility.openRequest.code}
            </Link>
          )}
        </div>
      )}

      {eligibility && !blocker && (
        <ReturnForm eligibility={eligibility} scope="customer" onCreated={id => router.push(`/account/returns/${id}`)} />
      )}
    </div>
  );
}

export default function NewReturnPage() {
  return (
    <CustomerGate redirect="/account/returns">
      <Suspense fallback={<div className="flex min-h-[40vh] items-center justify-center"><Spin size="large" /></div>}>
        <NewReturn />
      </Suspense>
    </CustomerGate>
  );
}
