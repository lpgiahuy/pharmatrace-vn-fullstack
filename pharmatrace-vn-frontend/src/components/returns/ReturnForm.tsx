'use client';

import { useRef, useState } from 'react';
import { ImagePlus, Lock, Repeat, Store, Truck, Wallet, X } from 'lucide-react';
import { App, Input, InputNumber, Select } from 'antd';
import { PickupAddressField } from './PickupAddressField';
import {
  returnService, type EligibleItem, type ReturnEligibility, type ReturnMethod, type ReturnResolution, type ReturnScope,
} from '@/services/return.service';
import { ErrorSummary, REASON_LABELS, returnErrors } from './ReturnParts';
import { formatCurrency } from '@/utils';

const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

const MAX_REASON_NOTE = 300;

interface Pick { checked: boolean; quantity: number | null; reason?: string; reasonNote?: string; exchangeVariantId?: number }

/** Price of the chosen replacement; keeping the same pack size keeps the price that was paid. */
function exchangePrice(item: EligibleItem, pick: Pick) {
  const option = item.exchangeOptions.find(entry => entry.variantId === (pick.exchangeVariantId ?? item.variantId));
  return Number(option?.unitPrice ?? item.paidUnitPrice);
}

function ExchangeHint({ item, pick }: { item: EligibleItem; pick: Pick }) {
  const diff = (exchangePrice(item, pick) - Number(item.paidUnitPrice)) * (pick.quantity ?? 0);
  if (!pick.exchangeVariantId || !diff) return null;
  return (
    <span className={`mt-1 block text-xs ${diff > 0 ? 'text-amber-800' : 'text-emerald-700'}`}>
      {diff > 0 ? `You pay ${formatCurrency(diff)} extra for this item` : `${formatCurrency(-diff)} less than what you paid`}
    </span>
  );
}

function Choice({ selected, onSelect, icon: Icon, title, text }: {
  selected: boolean; onSelect: () => void; icon: typeof Truck; title: string; text: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex min-h-[44px] w-full cursor-pointer items-start gap-3 rounded-md border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#004996] ${selected ? 'border-[#004996] bg-blue-50' : 'border-slate-300 bg-white hover:border-slate-400'}`}
    >
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${selected ? 'text-[#004996]' : 'text-slate-500'}`} aria-hidden />
      <span>
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        <span className="block text-xs text-slate-600">{text}</span>
      </span>
    </button>
  );
}

function ItemRow({ item, pick, onChange, exchange }: { item: EligibleItem; pick: Pick; onChange: (next: Pick) => void; exchange: boolean }) {
  const disabled = item.returnableQuantity === 0;
  const id = `item-${item.orderItemId}`;
  return (
    <li className={`rounded-md border p-3 ${pick.checked ? 'border-[#004996] bg-blue-50/40' : 'border-slate-200 bg-white'}`}>
      <label htmlFor={id} className={`flex items-start gap-3 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
        <input
          id={id}
          type="checkbox"
          className="mt-1 h-5 w-5 shrink-0 accent-[#004996]"
          checked={pick.checked}
          disabled={disabled}
          onChange={event => onChange({ ...pick, checked: event.target.checked })}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900">{item.medicineName}</span>
          <span className="block text-xs text-slate-500">
            {item.unitName} · {formatCurrency(item.unitPrice)} · bought {item.purchasedQuantity}
            {/* Paid prices are rounded to whole dong, so only a real discount (1 ₫ or more) is worth mentioning. */}
            {Number(item.unitPrice) - Number(item.paidUnitPrice) >= 1 && <> · you paid {formatCurrency(item.paidUnitPrice)} each after discounts</>}
          </span>
          {item.restricted && (
            <span className="mt-1 flex items-start gap-1.5 text-xs text-amber-800">
              <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              Prescription or special-storage medicine. Only wrong or defective items can be returned, with photos.
            </span>
          )}
          {disabled && <span className="mt-1 block text-xs text-slate-600">No quantity left to return.</span>}
        </span>
      </label>

      {pick.checked && (
        <div className="mt-3 grid gap-3 pl-8 sm:grid-cols-[140px_1fr_1fr]">
          <div>
            <label htmlFor={`${id}-qty`} className="mb-1 block text-xs font-medium text-slate-700">Quantity</label>
            <InputNumber
              id={`${id}-qty`}
              className="w-full"
              min={1}
              max={item.returnableQuantity}
              precision={0}
              value={pick.quantity}
              onChange={quantity => onChange({ ...pick, quantity: typeof quantity === 'number' ? quantity : null })}
            />
            <span className="mt-1 block text-xs text-slate-500">Max {item.returnableQuantity}</span>
          </div>
          <div>
            <label htmlFor={`${id}-reason`} className="mb-1 block text-xs font-medium text-slate-700">Reason</label>
            <Select
              id={`${id}-reason`}
              className="w-full"
              placeholder="Select a reason"
              value={pick.reason}
              onChange={reason => onChange({ ...pick, reason })}
              options={item.allowedReasons.map(value => ({ value, label: REASON_LABELS[value] ?? value }))}
            />
          </div>
          {exchange && (
            <div>
              <label htmlFor={`${id}-swap`} className="mb-1 block text-xs font-medium text-slate-700">Exchange for</label>
              <Select
                id={`${id}-swap`}
                className="w-full"
                value={pick.exchangeVariantId ?? item.variantId}
                onChange={value => onChange({ ...pick, exchangeVariantId: value === item.variantId ? undefined : value })}
                options={item.exchangeOptions.map(option => {
                  const same = option.variantId === item.variantId;
                  const diff = Number(option.unitPrice) - Number(item.paidUnitPrice);
                  const suffix = same || !diff ? '' : ` (${diff > 0 ? '+' : '−'}${formatCurrency(Math.abs(diff))} each)`;
                  return { value: option.variantId, label: `${same ? `Same product (${option.unitName})` : option.unitName} · ${formatCurrency(option.unitPrice)}${suffix}` };
                })}
              />
              <ExchangeHint item={item} pick={pick} />
            </div>
          )}
          {pick.reason === 'OTHER' && (
            <div className="sm:col-span-3">
              <label htmlFor={`${id}-note`} className="mb-1 block text-xs font-medium text-slate-700">Describe the reason</label>
              <Input.TextArea
                id={`${id}-note`}
                rows={2}
                maxLength={MAX_REASON_NOTE}
                value={pick.reasonNote}
                onChange={event => onChange({ ...pick, reasonNote: event.target.value })}
                placeholder="Tell us why you are returning this item"
                aria-describedby={`${id}-note-count`}
              />
              <span id={`${id}-note-count`} className="mt-1 block text-right text-xs text-slate-500">
                {(pick.reasonNote ?? '').length} / {MAX_REASON_NOTE}
              </span>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function ReturnForm({ eligibility, scope, channel, defaultMethod = 'CARRIER_PICKUP', onCreated }: {
  eligibility: ReturnEligibility;
  scope: ReturnScope;
  channel?: 'COUNTER' | 'PHONE';
  defaultMethod?: ReturnMethod;
  onCreated: (id: number) => void;
}) {
  const { message } = App.useApp();
  const summaryRef = useRef<HTMLDivElement>(null);
  const [picks, setPicks] = useState<Record<number, Pick>>({});
  const [resolution, setResolution] = useState<ReturnResolution>('REFUND');
  const [method, setMethod] = useState<ReturnMethod>(defaultMethod);
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const fail = (messages: string[]) => {
    setErrors(messages);
    requestAnimationFrame(() => summaryRef.current?.focus());
  };

  const selected = eligibility.items.filter(item => picks[item.orderItemId]?.checked);
  const needsPhotos = selected.some(item => item.restricted);
  const pickOf = (item: EligibleItem): Pick => picks[item.orderItemId] ?? { checked: false, quantity: 1 };
  // Mirrors public.create_return_replacement_order: differences are netted across all exchanged lines.
  const exchangeDiff = selected.reduce((sum, item) => {
    const pick = pickOf(item);
    return sum + (exchangePrice(item, pick) - Number(item.paidUnitPrice)) * (pick.quantity ?? 0);
  }, 0);

  function addFiles(list: FileList | null) {
    const next = [...files, ...Array.from(list ?? [])];
    if (next.length > MAX_PHOTOS) return fail([`You can attach at most ${MAX_PHOTOS} photos.`]);
    if (next.some(file => file.size > MAX_PHOTO_BYTES || !file.type.startsWith('image/'))) return fail(['Photos must be images smaller than 8 MB.']);
    setErrors([]);
    setFiles(next);
  }

  async function submit() {
    const problems: string[] = [];
    if (!selected.length) problems.push('Select at least one item to return.');
    selected.forEach(item => {
      const pick = pickOf(item);
      if (!pick.quantity || pick.quantity > item.returnableQuantity) {
        problems.push(`Enter a quantity between 1 and ${item.returnableQuantity} for ${item.medicineName}.`);
      }
      if (!pick.reason) problems.push(`Select a reason for ${item.medicineName}.`);
      else if (pick.reason === 'OTHER' && !pick.reasonNote?.trim()) problems.push(`Describe the reason for returning ${item.medicineName}.`);
    });
    if (needsPhotos && !files.length) problems.push('Add at least one photo of the prescription or special-storage item.');
    if (problems.length) return fail(problems);

    setSubmitting(true);
    try {
      const { data } = await returnService.create(scope, {
        orderId: eligibility.orderId,
        resolution,
        returnMethod: method,
        channel,
        pickupAddress: method === 'CARRIER_PICKUP' ? address.trim() || undefined : undefined,
        description: description.trim() || undefined,
        lines: selected.map(item => {
          const pick = pickOf(item);
          return {
            orderItemId: item.orderItemId,
            quantity: pick.quantity!,
            reasonCode: pick.reason!,
            reasonNote: pick.reason === 'OTHER' ? pick.reasonNote?.trim() : undefined,
            exchangeVariantId: resolution === 'EXCHANGE' ? pick.exchangeVariantId : undefined,
          };
        }),
      });
      const results = await Promise.allSettled(files.map(file => returnService.upload(scope, data.id, file)));
      if (results.some(result => result.status === 'rejected')) message.warning('The request was created, but some photos could not be uploaded. Add them from the request page.');
      else message.success('Return request created.');
      onCreated(data.id);
    } catch (error) {
      fail(returnErrors(error, 'We could not create the request. Please try again.'));
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="mb-4"><ErrorSummary messages={errors} innerRef={summaryRef} /></div>
        <form className="space-y-6" onSubmit={event => { event.preventDefault(); void submit(); }} noValidate>
          <section aria-labelledby="step-items">
            <h2 id="step-items" className="m-0 mb-2 text-sm font-bold text-slate-900">1. What are you returning?</h2>
            <ul className="m-0 list-none space-y-2 p-0">
              {eligibility.items.map(item => (
                <ItemRow
                  key={item.orderItemId}
                  item={item}
                  pick={pickOf(item)}
                  exchange={resolution === 'EXCHANGE'}
                  onChange={next => setPicks(current => ({ ...current, [item.orderItemId]: next }))}
                />
              ))}
            </ul>
          </section>

          <section aria-labelledby="step-resolution">
            <h2 id="step-resolution" className="m-0 mb-2 text-sm font-bold text-slate-900">2. What would you like?</h2>
            <div role="radiogroup" aria-labelledby="step-resolution" className="grid gap-2 sm:grid-cols-2">
              <Choice selected={resolution === 'REFUND'} onSelect={() => setResolution('REFUND')} icon={Wallet} title="Refund" text="Get your money back once the goods are checked." />
              <Choice selected={resolution === 'EXCHANGE'} onSelect={() => setResolution('EXCHANGE')} icon={Repeat} title="Exchange" text="Receive a replacement. Any price difference is settled on delivery." />
            </div>
            {resolution === 'EXCHANGE' && exchangeDiff !== 0 && (
              <p aria-live="polite" className={`m-0 mt-3 rounded-md border p-3 text-sm ${exchangeDiff > 0 ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-300 bg-emerald-50 text-emerald-900'}`}>
                {exchangeDiff > 0
                  ? <>Estimated extra to pay: <strong>{formatCurrency(exchangeDiff)}</strong>, collected on delivery of the replacement order.</>
                  : <>The replacement costs <strong>{formatCurrency(-exchangeDiff)}</strong> less. The difference is refunded after the returned goods are inspected.</>}
                <span className="mt-1 block text-xs opacity-80">Based on current prices and the quantities above. The final amount follows the quantity the pharmacy approves.</span>
              </p>
            )}
          </section>

          <section aria-labelledby="step-method">
            <h2 id="step-method" className="m-0 mb-2 text-sm font-bold text-slate-900">3. How will you send the goods back?</h2>
            <div role="radiogroup" aria-labelledby="step-method" className="grid gap-2 sm:grid-cols-2">
              <Choice selected={method === 'CARRIER_PICKUP'} onSelect={() => setMethod('CARRIER_PICKUP')} icon={Truck} title="Courier pickup" text="A courier collects the goods from you. A fee may apply if you changed your mind." />
              <Choice selected={method === 'STORE_DROP_OFF'} onSelect={() => setMethod('STORE_DROP_OFF')} icon={Store} title="Bring to the pharmacy" text="Show your return code at the counter. No fee." />
            </div>
            {method === 'CARRIER_PICKUP' && (
              <div className="mt-3"><PickupAddressField id="pickup-address" value={address} onChange={setAddress} /></div>
            )}
          </section>

          <section aria-labelledby="step-details">
            <h2 id="step-details" className="m-0 mb-2 text-sm font-bold text-slate-900">4. Details</h2>
            <label htmlFor="return-description" className="mb-1 block text-xs font-medium text-slate-700">What happened? (optional)</label>
            <textarea id="return-description" rows={3} maxLength={1000} value={description} onChange={event => setDescription(event.target.value)} className="w-full rounded-md border border-slate-300 p-2 text-sm focus:border-[#004996] focus:outline-none focus:ring-1 focus:ring-[#004996]" />

            <p className="mb-1 mt-4 text-xs font-medium text-slate-700">Photos {needsPhotos ? <span className="text-red-700">(required for your selection)</span> : '(optional)'}</p>
            <div className="flex flex-wrap items-center gap-2">
              {files.map((file, index) => (
                <span key={`${file.name}-${index}`} className="inline-flex max-w-[220px] items-center gap-1.5 rounded-md border border-slate-300 bg-white py-1 pl-2.5 pr-1 text-xs text-slate-700">
                  <span className="truncate">{file.name}</span>
                  <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles(files.filter((_, i) => i !== index))} className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-slate-500 hover:bg-slate-100"><X className="h-3.5 w-3.5" aria-hidden /></button>
                </span>
              ))}
              {files.length < MAX_PHOTOS && (
                <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-400 px-3 text-xs font-semibold text-slate-700 transition-colors hover:border-[#004996] hover:text-[#004996] focus-within:outline-2 focus-within:outline-[#004996]">
                  <ImagePlus className="h-4 w-4" aria-hidden />
                  Add photo
                  <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={event => { addFiles(event.target.files); event.target.value = ''; }} />
                </label>
              )}
            </div>
            <p className="m-0 mt-1 text-xs text-slate-500">Up to {MAX_PHOTOS} photos, JPG, PNG or WEBP, 8 MB each.</p>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
            <p className="m-0 text-xs text-slate-500" aria-live="polite">{selected.length ? `${selected.length} item${selected.length > 1 ? 's' : ''} selected` : 'No items selected'}</p>
            <button type="submit" disabled={submitting} className="inline-flex min-h-[44px] cursor-pointer items-center justify-center rounded-md bg-[#004996] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#003875] disabled:cursor-not-allowed disabled:opacity-60">
              {submitting ? 'Saving…' : scope === 'admin' ? 'Create return request' : 'Send return request'}
            </button>
          </div>
        </form>
    </>
  );
}
