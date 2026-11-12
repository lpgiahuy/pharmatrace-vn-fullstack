'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Image, Spin } from 'antd';
import { AlertCircle, Ban, Check, CheckCircle2, ClipboardCheck, Clock, HelpCircle, Package, PackageCheck, Wallet, XCircle, type LucideIcon } from 'lucide-react';
import { returnService, type ReturnDetail, type ReturnEvent, type ReturnScope, type ReturnStatus } from '@/services/return.service';
import { useAuth } from '@/store/useAuthStore';
import { useHydrated } from '@/hooks/useHydrated';
import { formatCurrency, formatDateTime } from '@/utils';

export const STATUS_META: Record<ReturnStatus, { label: string; tone: string; icon: LucideIcon }> = {
  REQUESTED: { label: 'Awaiting review', tone: 'text-amber-700', icon: Clock },
  NEEDS_INFO: { label: 'More information needed', tone: 'text-amber-700', icon: HelpCircle },
  APPROVED: { label: 'Approved', tone: 'text-blue-700', icon: ClipboardCheck },
  REJECTED: { label: 'Rejected', tone: 'text-red-700', icon: XCircle },
  CANCELLED: { label: 'Cancelled', tone: 'text-slate-600', icon: Ban },
  RECEIVED: { label: 'Goods received', tone: 'text-blue-700', icon: PackageCheck },
  INSPECTED: { label: 'Inspected', tone: 'text-blue-700', icon: PackageCheck },
  REFUND_APPROVED: { label: 'Refund approved', tone: 'text-blue-700', icon: Wallet },
  REFUNDED: { label: 'Refunded', tone: 'text-emerald-700', icon: CheckCircle2 },
  CLOSED: { label: 'Completed', tone: 'text-emerald-700', icon: CheckCircle2 },
};

export const REASON_LABELS: Record<string, string> = {
  WRONG_ITEM: 'Wrong item delivered',
  DAMAGED: 'Damaged or defective',
  EXPIRED_OR_NEAR_EXPIRY: 'Expired or near expiry',
  QUALITY_ISSUE: 'Quality issue',
  CHANGED_MIND: 'Changed my mind',
  ORDERED_WRONG: 'Ordered by mistake',
  NO_LONGER_NEEDED: 'No longer needed',
  OTHER: 'Other reason',
};

export function reasonText(line: { reason_code: string; reason_note?: string | null }) {
  return line.reason_code === 'OTHER' && line.reason_note ? `Other: ${line.reason_note}` : REASON_LABELS[line.reason_code] ?? line.reason_code;
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank transfer',
  DEBIT_CARD: 'Debit card',
  E_WALLET: 'E-wallet',
};

const EVENT_TITLES: Record<string, string> = {
  CREATED: 'Request created',
  INFO_PROVIDED: 'Customer added information',
  RETURN_METHOD_CHANGED: 'Return method changed',
  CARRIER_BOOKED: 'Courier booked',
  EXCHANGE_ORDER_CREATED: 'Replacement order created',
  RECEIPT_REJECTED: 'Parcel refused: goods did not match',
};

const NOTE_TERMS: Record<string, string> = {
  STORE_DROP_OFF: 'bringing the goods to the pharmacy',
  CARRIER_PICKUP: 'courier pickup',
  BANK_TRANSFER: 'bank transfer',
  DEBIT_CARD: 'debit card',
  E_WALLET: 'e-wallet',
  CASH: 'cash',
};

function friendlyNote(note: string) {
  return note
    .replace(/\b(STORE_DROP_OFF|CARRIER_PICKUP|BANK_TRANSFER|DEBIT_CARD|E_WALLET|CASH)\b/g, term => NOTE_TERMS[term])
    .replace(/\b(Refund of|customer pays) (\d+(?:\.\d+)?)/g, (_, lead: string, amount: string) => `${lead} ${formatCurrency(amount)}`);
}

const STAGES = [
  { label: 'Requested', hint: 'Sent' },
  { label: 'Approved', hint: 'Reviewed' },
  { label: 'Goods received', hint: 'At pharmacy' },
  { label: 'Resolved', hint: 'Refund or exchange' },
];

function stageOf(status: ReturnStatus) {
  if (status === 'APPROVED') return 1;
  if (['RECEIVED', 'INSPECTED', 'REFUND_APPROVED'].includes(status)) return 2;
  if (['REFUNDED', 'CLOSED'].includes(status)) return 3;
  return 0;
}

export function ReturnStatusBadge({ status }: { status: ReturnStatus }) {
  const { label, tone, icon: Icon } = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${tone}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </span>
  );
}

export function ReturnProgress({ status, audience = 'staff' }: { status: ReturnStatus; audience?: 'customer' | 'staff' }) {
  if (status === 'REJECTED' || status === 'CANCELLED') return null;
  const current = stageOf(status);
  // NEEDS_INFO pauses the flow on the customer, so the current step turns amber and stops pulsing.
  const onHold = status === 'NEEDS_INFO';
  const finished = current === STAGES.length - 1;
  return (
    // No margin reset here: the page's space-y gap below the tracker comes from this element's margin.
    <ol className="mx-0 mt-0 grid list-none grid-cols-4 p-0" aria-label="Return progress">
      {STAGES.map((stage, index) => {
        const done = index < current || (finished && index === current);
        const active = index === current && !done;
        const held = active && onHold;
        const label = held ? (audience === 'customer' ? 'Waiting for you' : 'Waiting for customer') : stage.label;
        const hint = held ? 'Reply needed' : stage.hint;
        return (
          <li key={stage.label} aria-current={active ? 'step' : undefined} className="relative flex min-w-0 flex-col items-center px-1 text-center">
            {index > 0 && <span className={`absolute right-1/2 top-4 h-0.5 w-full ${index <= current ? 'bg-[#004996]' : 'bg-slate-200'}`} aria-hidden />}
            <span className="relative z-10 flex h-8 w-8 items-center justify-center">
              {/* Same ripple as the delivery status tracker in My orders. */}
              {active && !held && (
                <>
                  <span className="pointer-events-none absolute h-8 w-8 rounded-full bg-[#004996] animate-ripple motion-reduce:hidden" aria-hidden />
                  <span className="pointer-events-none absolute h-8 w-8 rounded-full bg-[#004996] animate-ripple-delayed motion-reduce:hidden" aria-hidden />
                </>
              )}
              <span
                className={`relative flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-bold ${
                  held ? 'border-amber-700 bg-amber-700 text-white'
                    : done || active ? 'border-[#004996] bg-[#004996] text-white' : 'border-slate-300 bg-white text-slate-400'
                }`}
              >
                {done ? <Check className="h-4 w-4" aria-hidden /> : index + 1}
              </span>
            </span>
            <span className={`mt-2 text-xs leading-tight sm:text-sm ${held ? 'font-semibold text-amber-800' : done || active ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>{label}</span>
            <span className={`hidden text-xs sm:block ${held ? 'text-amber-700' : 'text-slate-400'}`}>{hint}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function ReturnTimeline({ events, showStaff }: { events: ReturnEvent[]; showStaff: boolean }) {
  return (
    <ol className="m-0 list-none p-0" aria-label="Return history">
      {events.map((event, index) => {
        const last = index === events.length - 1;
        const failed = event.to_status === 'REJECTED';
        const done = event.to_status === 'REFUNDED' || event.to_status === 'CLOSED';
        const who = event.actor_name
          ? `${event.actor_name}${showStaff && event.actor_role ? ` · ${event.actor_role.replace(/_/g, ' ').toLowerCase()}` : ''}`
          : null;
        return (
          <li key={event.id} className="relative grid grid-cols-[14px_1fr] gap-x-3">
            <span className="relative flex justify-center" aria-hidden>
              {!last && <span className="absolute bottom-0 left-1/2 top-4 w-px -translate-x-1/2 bg-slate-300" />}
              <span className={`mt-1 h-2.5 w-2.5 rounded-full border-2 ${failed ? 'border-red-600 bg-red-600' : done ? 'border-emerald-600 bg-emerald-600' : 'border-slate-400 bg-white'}`} />
            </span>
            <div className={last ? '' : 'pb-4'}>
              <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                <p className={`m-0 text-sm font-semibold ${failed ? 'text-red-700' : 'text-slate-900'}`}>
                  {EVENT_TITLES[event.action] ?? STATUS_META[event.to_status]?.label ?? event.action}
                </p>
                <time className="text-xs tabular-nums text-slate-500">{formatDateTime(event.created_at)}</time>
              </div>
              {event.note && <p className="m-0 mt-1 border-l-2 border-slate-300 pl-2.5 text-xs leading-relaxed text-slate-600">{friendlyNote(event.note)}</p>}
              {who && <p className="m-0 mt-1 text-xs text-slate-500">{who}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Photo({ scope, requestId, id }: { scope: ReturnScope; requestId: number; id: number }) {
  const [src, setSrc] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let url: string | undefined;
    let cancelled = false;
    returnService.photo(scope, requestId, id)
      .then(blob => { if (!cancelled) { url = URL.createObjectURL(blob); setSrc(url); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [scope, requestId, id]);

  if (failed) {
    return <span className="flex h-20 w-20 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-400" role="img" aria-label="Photo unavailable"><AlertCircle className="h-5 w-5" /></span>;
  }
  if (!src) return <span className="h-20 w-20 animate-pulse rounded-md bg-slate-100" aria-hidden />;
  return <Image src={src} alt={`Evidence photo ${id}`} width={80} height={80} className="rounded-md border border-slate-200 object-cover" />;
}

export function ReturnPhotos({ scope, detail }: { scope: ReturnScope; detail: ReturnDetail }) {
  if (!detail.attachments.length) return <p className="m-0 text-xs text-slate-500">No photos attached.</p>;
  return (
    <Image.PreviewGroup>
      <div className="flex flex-wrap gap-2">
        {detail.attachments.map(photo => <Photo key={photo.id} scope={scope} requestId={detail.id} id={photo.id} />)}
      </div>
    </Image.PreviewGroup>
  );
}

export function ReturnHandover({ detail }: { detail: ReturnDetail }) {
  const { handover } = detail;
  if (['REJECTED', 'CANCELLED', 'CLOSED', 'REFUNDED'].includes(detail.status)) return null;
  const pickup = handover.method === 'CARRIER_PICKUP';
  return (
    <section className="rounded-md border border-slate-200 bg-slate-50/70 p-4" aria-label="How to hand over the goods">
      <h3 className="m-0 mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
        <Package className="h-4 w-4 text-[#004996]" aria-hidden />
        {pickup ? 'Courier pickup' : 'Bring the goods to the pharmacy'}
      </h3>
      {pickup ? (
        <div className="space-y-1 text-sm text-slate-700">
          <p className="m-0">Pickup address: {handover.pickupAddress}</p>
          <p className="m-0">
            {handover.trackingNumber
              ? <>Courier <strong>{handover.courierName}</strong>, tracking number <strong className="font-mono">{handover.trackingNumber}</strong></>
              : 'The pharmacy will book a courier after approval and the tracking number will appear here.'}
          </p>
        </div>
      ) : (
        <div className="space-y-1 text-sm text-slate-700">
          <p className="m-0">{handover.facility?.facility_name}{handover.facility?.address ? ` · ${handover.facility.address}` : ''}</p>
          <p className="m-0">Show this code at the counter: <strong className="font-mono text-base text-slate-900">{handover.code}</strong></p>
        </div>
      )}
    </section>
  );
}

export const RESOLUTION_LABELS = { REFUND: 'Refund', EXCHANGE: 'Exchange' } as const;
export const METHOD_LABELS = { CARRIER_PICKUP: 'Courier pickup', STORE_DROP_OFF: 'Bring to pharmacy' } as const;

export function returnErrors(error: unknown, fallback: string): string[] {
  const body = error as { message?: string | string[]; errors?: { message: string }[] } | undefined;
  if (body?.errors?.length) return body.errors.map(entry => entry.message);
  if (Array.isArray(body?.message)) return body.message;
  return [body?.message || fallback];
}

export function ErrorSummary({ messages, innerRef }: { messages: string[]; innerRef?: React.Ref<HTMLDivElement> }) {
  if (!messages.length) return null;
  return (
    <div ref={innerRef} role="alert" tabIndex={-1} className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 focus:outline-none">
      <p className="m-0 font-semibold">{messages.length > 1 ? 'Please fix the following:' : 'Something needs your attention:'}</p>
      <ul className="m-0 mt-1 list-disc pl-5">
        {messages.map(text => <li key={text}>{text}</li>)}
      </ul>
    </div>
  );
}

export function CustomerGate({ redirect, children }: { redirect: string; children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const hydrated = useHydrated();
  if (!hydrated || isLoading) return <div className="flex min-h-[50vh] items-center justify-center"><Spin size="large" /></div>;
  if (!isAuthenticated) {
    return (
      <div className="mx-auto max-w-lg rounded-md border border-slate-200 bg-white p-12 text-center shadow-xs">
        <h2 className="mb-2 text-xl font-bold text-slate-900">Sign in required</h2>
        <p className="mb-6 text-sm text-slate-500">Sign in to request and follow your returns.</p>
        <Link href={`/login?redirect=${redirect}`} className="inline-flex w-full items-center justify-center rounded-md bg-[#004996] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#003875]">
          Sign in to continue
        </Link>
      </div>
    );
  }
  return <>{children}</>;
}
