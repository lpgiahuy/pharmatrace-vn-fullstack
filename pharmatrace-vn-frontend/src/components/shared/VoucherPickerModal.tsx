'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Spin } from 'antd';
import { Search, Ticket } from 'lucide-react';
import { AvailableVoucher, voucherService } from '@/services/voucher.service';
import { formatCurrency } from '@/utils';

interface VoucherPickerModalProps {
  open: boolean;
  subtotal: number;
  appliedCode?: string | null;
  applying?: boolean;
  onClose: () => void;
  onApply: (voucher: AvailableVoucher) => void | Promise<void>;
}

const REASON_TEXT: Record<NonNullable<AvailableVoucher['reason']>, (v: AvailableVoucher, subtotal: number) => string> = {
  EXHAUSTED: () => 'This voucher has been fully redeemed',
  MIN_ORDER: (v, subtotal) => `Add ${formatCurrency(Math.max(0, v.minOrderValue - subtotal))} more to use this voucher`,
};

function describe(v: AvailableVoucher): string {
  if (v.discountType === 'PERCENT') {
    const cap = v.maxDiscountAmount ? ` up to ${formatCurrency(v.maxDiscountAmount)}` : '';
    const min = v.minOrderValue ? ` on orders from ${formatCurrency(v.minOrderValue)}` : '';
    return `${v.discountValue}% off${cap}${min}`;
  }
  const min = v.minOrderValue ? ` on orders from ${formatCurrency(v.minOrderValue)}` : '';
  return `${formatCurrency(v.discountValue)} off${min}`;
}

type PickerBodyProps = Pick<VoucherPickerModalProps, 'subtotal' | 'appliedCode' | 'applying' | 'onApply'>;

// Mounted only while the modal is open, so state starts fresh on every open.
function PickerBody({ subtotal, appliedCode, applying, onApply }: PickerBodyProps) {
  const [vouchers, setVouchers] = useState<AvailableVoucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    voucherService
      .getAvailableVouchers(subtotal)
      .then((res) => {
        if (cancelled) return;
        const list = res?.data ?? [];
        setVouchers(list);
        const applied = list.find((v) => v.voucherCode === appliedCode && v.usable);
        setSelectedId(applied ? applied.id : null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError((err as { message?: string })?.message || 'Could not load vouchers.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [subtotal, appliedCode]);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    const list = q ? vouchers.filter((v) => v.voucherCode.toUpperCase().includes(q)) : vouchers;
    // Usable vouchers first
    return [...list].sort((a, b) => Number(b.usable) - Number(a.usable));
  }, [vouchers, search]);

  const selected = vouchers.find((v) => v.id === selectedId && v.usable) ?? null;

  return (
    <>
      <div className="flex gap-3 mt-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search voucher code"
            className="w-full pl-9 pr-3 py-2.5 text-sm uppercase rounded-lg border border-gray-300 focus:border-[#004996] focus:ring-1 focus:ring-[#004996] outline-none"
          />
        </div>
      </div>

      <div className="mt-4 space-y-3 max-h-[50vh] overflow-y-auto pr-1">
        {loading ? (
          <div className="py-10 flex justify-center"><Spin /></div>
        ) : error ? (
          <p className="py-8 text-center text-sm text-red-600">{error}</p>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">No matching vouchers.</p>
        ) : (
          filtered.map((v) => {
            const isSelected = v.id === selectedId;
            return (
              <button
                key={v.id}
                type="button"
                disabled={!v.usable}
                onClick={() => setSelectedId(v.id)}
                className={`w-full flex text-left rounded-lg border overflow-hidden transition-colors ${
                  isSelected ? 'border-[#004996] bg-[#f0f7ff]' : 'border-gray-200 bg-white'
                } ${v.usable ? 'cursor-pointer hover:border-[#004996]' : 'cursor-not-allowed'}`}
              >
                <div className={`w-28 shrink-0 flex flex-col items-center justify-center gap-1 text-white ${v.usable ? 'bg-[#004996]' : 'bg-gray-300'}`}>
                  <Ticket className="w-7 h-7" />
                  <span className="text-xs font-semibold tracking-wide px-1 text-center break-all">{v.voucherCode}</span>
                </div>
                <div className={`flex-1 p-3.5 min-w-0 ${v.usable ? '' : 'opacity-60'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 text-sm">
                        &quot;{v.voucherCode}&quot; {describe(v)}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {v.usable && v.estimatedDiscount > 0 ? `Value: ${formatCurrency(v.estimatedDiscount)}` : null}
                      </p>
                      {v.endDate && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          Expires: {new Date(v.endDate).toLocaleDateString('en-GB')}
                        </p>
                      )}
                    </div>
                    <span
                      className={`mt-0.5 w-5 h-5 shrink-0 rounded-full border-2 flex items-center justify-center ${
                        isSelected ? 'border-[#004996]' : 'border-gray-300'
                      }`}
                    >
                      {isSelected && <span className="w-2.5 h-2.5 rounded-full bg-[#004996]" />}
                    </span>
                  </div>
                  {!v.usable && v.reason && (
                    <span className="inline-block mt-2 px-2 py-1 text-xs rounded bg-orange-50 text-orange-600">
                      {REASON_TEXT[v.reason](v, subtotal)}
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>

      <button
        type="button"
        disabled={!selected || applying}
        onClick={() => selected && onApply(selected)}
        className="mt-5 w-full py-3 rounded-lg text-white font-semibold bg-[#004996] hover:bg-[#003a78] disabled:bg-[#a5b4f0] disabled:cursor-not-allowed transition-colors cursor-pointer"
      >
        {applying ? 'Applying...' : 'Apply'}
      </button>
    </>
  );
}

export default function VoucherPickerModal({ open, onClose, ...bodyProps }: VoucherPickerModalProps) {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      title={<span className="text-xl font-bold">Select a voucher</span>}
      width={640}
      destroyOnHidden
    >
      <PickerBody {...bodyProps} />
    </Modal>
  );
}
