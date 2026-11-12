'use client';

import { useState } from 'react';
import { App, AutoComplete, Button, Form, Input, InputNumber, Modal, Popconfirm, Select } from 'antd';
import { returnService, type PaymentMethod, type ReturnDetail, type ReturnLine } from '@/services/return.service';
import { readPackageUid } from '@/utils/package-uid';
import { BoxCodesInput } from './BoxCodesInput';
import { ErrorSummary, METHOD_LABELS, PAYMENT_METHOD_LABELS, reasonText, RESOLUTION_LABELS, returnErrors } from './ReturnParts';
import { formatDateTime } from '@/utils';

type Kind = 'approve' | 'reject' | 'reject-receipt' | 'request-info' | 'carrier' | 'receive' | 'inspection' | 'refund' | 'refund/payment';

const REVIEW = ['SUPERADMIN', 'STOREMANAGER', 'PHARMACIST'];
const RECEIVE = ['SUPERADMIN', 'STOREMANAGER', 'WAREHOUSESTAFF'];
const MANAGE = ['SUPERADMIN', 'STOREMANAGER'];
const CUSTOMER_CHOICE = ['CHANGED_MIND', 'ORDERED_WRONG', 'NO_LONGER_NEEDED', 'OTHER'];
const COURIERS = ['GHN', 'GHTK', 'Viettel Post', 'VNPost', 'J&T Express', 'Ninja Van', 'Best Express'];

const TITLES: Record<Kind, string> = {
  approve: 'Approve return',
  reject: 'Reject request',
  'reject-receipt': 'Refuse the parcel',
  'request-info': 'Ask the customer for more information',
  carrier: 'Record courier booking',
  receive: 'Receive returned goods',
  inspection: 'Inspect returned goods',
  refund: 'Approve refund',
  'refund/payment': 'Record refund payout',
};

interface Values {
  note?: string;
  customerFee?: number;
  courierName?: string;
  trackingNumber?: string;
  paymentMethod?: PaymentMethod;
  reason?: string;
  paymentReference?: string;
  lines?: { quantity?: number; boxCodes?: string; pass?: number; mismatch?: number; verdicts?: Record<string, 'pass' | 'fail'> }[];
}

const codes = (text?: string) => (text ?? '').split(/[\s,]+/).filter(Boolean).map(code => readPackageUid(code) ?? code);
const lineName = (line: ReturnLine) => `${line.medicine_name} (${line.unit_name})`;

function LineFields({ kind, lines }: { kind: Kind; lines: ReturnLine[] }) {
  return (
    <ul className="m-0 mb-4 list-none space-y-3 p-0">
      {lines.map((line, index) => (
        <li key={line.order_item_id} className="rounded-md border border-slate-200 p-3">
          <p className="m-0 text-sm font-semibold text-slate-900">{lineName(line)}</p>
          <p className="m-0 mb-2 text-xs text-slate-500">
            {reasonText(line)} · requested {line.quantity}
            {line.restricted && <span className="ml-1 font-semibold text-amber-800">· prescription / special storage</span>}
          </p>

          {kind === 'approve' && (
            <Form.Item name={['lines', index, 'quantity']} label="Approved quantity" className="mb-0" rules={[{ required: true, message: 'Enter a quantity.' }]}>
              <InputNumber min={0} max={line.quantity} precision={0} />
            </Form.Item>
          )}

          {kind === 'receive' && (
            <>
              <Form.Item name={['lines', index, 'quantity']} label={`Received quantity (approved ${line.approved_quantity ?? 0})`} rules={[{ required: true, message: 'Enter a quantity.' }]}>
                <InputNumber min={0} max={line.approved_quantity ?? 0} precision={0} />
              </Form.Item>
              {line.tracked ? (
                <Form.Item name={['lines', index, 'boxCodes']} label="Box codes" className="mb-0" extra="Scan one box per received unit with the camera or a USB scanner, or type the UID and press Enter.">
                  <BoxCodesInput quantityField={['lines', index, 'quantity']} />
                </Form.Item>
              ) : (
                <p className="m-0 text-xs text-slate-500">This item was sold without tracked boxes, so there is nothing to scan. Check the product by eye.</p>
              )}
            </>
          )}

          {kind === 'inspection' && (line.box_uids.length > 0 ? (
            <div className="space-y-2">
              {line.box_uids.map(uid => (
                <Form.Item key={uid} name={['lines', index, 'verdicts', uid]} label={<span className="font-mono text-xs">{uid}</span>} className="mb-0" rules={[{ required: true, message: 'Choose a result.' }]}>
                  <Select
                    className="w-40"
                    options={[{ value: 'pass', label: 'Pass, restock', disabled: line.restricted }, { value: 'fail', label: 'Fail, scrap' }]}
                  />
                </Form.Item>
              ))}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Form.Item name={['lines', index, 'pass']} label={`Passed (received ${line.received_quantity ?? 0})`} className="mb-0" extra={line.restricted ? 'This item cannot go back into stock.' : 'Goes back into stock.'}>
                <InputNumber min={0} max={line.restricted ? 0 : line.received_quantity ?? 0} precision={0} />
              </Form.Item>
              <Form.Item name={['lines', index, 'mismatch']} label="Not the product we sold" className="mb-0" extra="Another product, counterfeit or empty box. Never refunded.">
                <InputNumber min={0} max={line.received_quantity ?? 0} precision={0} />
              </Form.Item>
              <p className="m-0 text-xs text-slate-500 sm:col-span-2">Everything else is recorded as failed and scrapped.</p>
            </div>
          ))}
        </li>
      ))}
    </ul>
  );
}

function timeAgo(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

const RECEIVERS = 'warehouse staff or a store manager to receive them';

/** One sentence on what the request is waiting for, and who has to act when the viewer cannot. */
function situation(detail: ReturnDetail, { exchange, pickup, nothingCredited }: { exchange: boolean; pickup: boolean; nothingCredited: boolean }) {
  const { handover } = detail;
  switch (detail.status) {
    case 'REQUESTED': return { title: 'Review this return request', waitingOn: 'a pharmacist or store manager to review it' };
    case 'NEEDS_INFO': return { title: 'Waiting for the customer to reply', waitingOn: undefined };
    case 'APPROVED':
      if (!pickup) return { title: 'Waiting for the customer to bring the goods', waitingOn: RECEIVERS };
      return handover.trackingNumber
        ? { title: `${handover.courierName ?? 'The courier'} is collecting the goods`, waitingOn: RECEIVERS }
        : { title: 'Book a courier to collect the goods', waitingOn: RECEIVERS };
    case 'RECEIVED': return { title: 'Goods are in quarantine: inspect them', waitingOn: 'a pharmacist or store manager to inspect them' };
    case 'INSPECTED':
      if (exchange) {
        return detail.replacement_order_id
          ? { title: `Replacement order #${detail.replacement_order_id} created`, waitingOn: 'a store manager to complete the exchange' }
          : { title: 'Create the replacement order', waitingOn: 'a pharmacist or store manager to create the replacement order' };
      }
      return nothingCredited
        ? { title: 'Nothing passed inspection', waitingOn: 'a store manager to close the request' }
        : { title: 'Ready for refund', waitingOn: 'a store manager to approve the refund' };
    case 'REFUND_APPROVED': return { title: 'Refund approved: record the payout', waitingOn: 'a store manager to record the payout' };
    default: return { title: 'Return request', waitingOn: undefined };
  }
}

export function ReturnActions({ detail, role, onChanged }: { detail: ReturnDetail; role: string; onChanged: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<Values>();
  const [kind, setKind] = useState<Kind>();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const can = (roles: string[]) => roles.includes(role);
  const { status } = detail;
  const exchange = detail.resolution === 'EXCHANGE';
  const wrongItemOnly = detail.lines.every(line => line.reason_code === 'WRONG_ITEM');
  const pickup = detail.return_method === 'CARRIER_PICKUP';
  const feeAllowed = pickup && detail.lines.every(line => CUSTOMER_CHOICE.includes(line.reason_code));
  const linesFor = (target?: Kind) => target === 'inspection' ? detail.lines.filter(line => (line.received_quantity ?? 0) > 0) : detail.lines;

  async function call(action: string, body?: unknown, success = 'Done.') {
    setBusy(true);
    try {
      await returnService.act('admin', detail.id, action, body);
      message.success(success);
      setKind(undefined);
      onChanged();
    } catch (error) {
      setErrors(returnErrors(error, 'That did not work. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  function open(next: Kind) {
    const initial: Values = {
      lines: linesFor(next).map(line => ({
        quantity: next === 'approve' ? line.quantity : line.approved_quantity ?? 0,
        pass: line.restricted ? 0 : line.received_quantity ?? 0,
        mismatch: 0,
        verdicts: Object.fromEntries(line.box_uids.map(uid => [uid, line.restricted ? 'fail' : 'pass'])),
      })),
    };
    form.resetFields();
    form.setFieldsValue(initial);
    setErrors([]);
    setKind(next);
  }

  function submit(values: Values) {
    const rows = linesFor(kind).map((line, index) => ({ line, value: values.lines?.[index] ?? {} }));
    switch (kind) {
      case 'approve':
        return call('approve', {
          lines: rows.map(({ line, value }) => ({ orderItemId: line.order_item_id, approvedQuantity: value.quantity ?? 0 })),
          customerFee: feeAllowed ? values.customerFee || undefined : undefined,
          note: values.note?.trim() || undefined,
        }, 'Request approved.');
      case 'reject': return call('reject', { note: values.note }, 'Request rejected.');
      case 'reject-receipt': return call('reject-receipt', { note: values.note }, 'Parcel refused and request rejected.');
      case 'request-info': return call('request-info', { note: values.note }, 'Message sent to the customer.');
      case 'carrier': return call('carrier', { courierName: values.courierName, trackingNumber: values.trackingNumber }, 'Courier recorded.');
      case 'receive':
        return call('receive', {
          lines: rows.map(({ line, value }) => ({ orderItemId: line.order_item_id, quantity: value.quantity ?? 0, boxUids: codes(value.boxCodes) })),
        }, 'Goods received into quarantine.');
      case 'inspection': {
        const over = rows.filter(({ line, value }) => !line.box_uids.length && (value.pass ?? 0) + (value.mismatch ?? 0) > (line.received_quantity ?? 0));
        if (over.length) {
          setErrors(over.map(({ line }) => `Passed plus wrong-product units for ${lineName(line)} cannot exceed the ${line.received_quantity ?? 0} received.`));
          return;
        }
        return call('inspection', {
          notes: values.note?.trim() || undefined,
          lines: rows.map(({ line, value }) => {
            if (line.box_uids.length) {
              const passed = line.box_uids.filter(uid => value.verdicts?.[uid] === 'pass');
              const failed = line.box_uids.filter(uid => value.verdicts?.[uid] !== 'pass');
              return { orderItemId: line.order_item_id, passQuantity: passed.length, failQuantity: failed.length, restockBoxUids: passed, scrapBoxUids: failed };
            }
            const pass = value.pass ?? 0;
            const mismatch = value.mismatch ?? 0;
            return { orderItemId: line.order_item_id, passQuantity: pass, mismatchQuantity: mismatch, failQuantity: (line.received_quantity ?? 0) - pass - mismatch };
          }),
        }, 'Inspection recorded.');
      }
      case 'refund': return call('refund', { paymentMethod: values.paymentMethod, reason: values.reason }, 'Refund approved.');
      case 'refund/payment': return call('refund/payment', { paymentReference: values.paymentReference }, 'Refund payout recorded.');
    }
  }

  // Actions in order of importance: the first `primary` is the step the request is waiting for.
  const actions: { kind: Kind; label: string; primary?: boolean }[] = [];
  if (status === 'REQUESTED' && can(REVIEW)) actions.push({ kind: 'approve', label: 'Approve', primary: true }, { kind: 'request-info', label: 'Ask for information' });
  if (status === 'APPROVED' && can(RECEIVE)) actions.push({ kind: 'receive', label: 'Receive goods', primary: true });
  if (status === 'APPROVED' && pickup && !detail.handover.trackingNumber && can(REVIEW)) actions.push({ kind: 'carrier', label: 'Add courier tracking' });
  if (status === 'RECEIVED' && can(REVIEW)) actions.push({ kind: 'inspection', label: 'Record inspection', primary: true });
  // Mirrors public.return_line_credit_quantity: customer-choice goods only count once they pass inspection.
  const nothingCredited = detail.lines.every(line => (CUSTOMER_CHOICE.includes(line.reason_code) && line.pass_quantity !== null
    ? line.pass_quantity : line.received_quantity ?? line.approved_quantity ?? 0) === 0);
  const closeWithoutRefund = !exchange && status === 'INSPECTED' && nothingCredited && can(MANAGE);
  if (status === 'INSPECTED' && can(MANAGE) && !closeWithoutRefund && (!exchange || detail.replacement_order_id)) actions.push({ kind: 'refund', label: 'Approve refund', primary: !exchange });
  if (status === 'REFUND_APPROVED' && can(MANAGE)) actions.push({ kind: 'refund/payment', label: 'Record payout', primary: true });
  const canReject = ['REQUESTED', 'NEEDS_INFO'].includes(status) && can(REVIEW);

  // Mirrors public.create_return_replacement_order: shipping before the goods are back needs checkable evidence.
  const earlyReplacement = wrongItemOnly && detail.lines.every(line => line.tracked)
    && detail.attachments.some(photo => photo.uploaded_by_type === 'customer');
  const exchangeReady = exchange && !detail.replacement_order_id && can(REVIEW)
    && (status === 'INSPECTED' || (status === 'APPROVED' && earlyReplacement));
  const canRefuseParcel = status === 'APPROVED' && !detail.replacement_order_id && (can(RECEIVE) || can(REVIEW));
  const canClose = exchange && status === 'INSPECTED' && !!detail.replacement_order_id && can(MANAGE);

  if (['REJECTED', 'CANCELLED', 'REFUNDED', 'CLOSED'].includes(status)) return null;

  // Restricted goods cannot be approved without evidence, so say so here instead of failing after the click.
  const missingPhotos = status === 'REQUESTED' && detail.lines.some(line => line.restricted) && detail.attachments.length === 0;
  const hasActions = actions.length > 0 || exchangeReady || canClose || closeWithoutRefund || canReject || canRefuseParcel;
  const { title, waitingOn } = situation(detail, { exchange, pickup, nothingCredited });
  const units = detail.lines.reduce((sum, line) => sum + line.quantity, 0);
  const reasons = [...new Set(detail.lines.map(line => reasonText(line)))];
  const photos = detail.attachments.length;
  // While under review the request itself is the decision, so it becomes the title; later the situation leads.
  const summary = `${RESOLUTION_LABELS[detail.resolution]} ${units} unit${units === 1 ? '' : 's'} · ${reasons.length === 1 ? reasons[0] : `${reasons.length} reasons`}`;
  const reviewing = status === 'REQUESTED';

  return (
    <section aria-labelledby="next-step-title" className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 id="next-step-title" className="m-0 text-base font-semibold text-slate-900">{reviewing ? summary : title}</h2>
          <p className="m-0 mt-0.5 text-xs text-slate-500">
            {!reviewing && <>{summary} · </>}
            {METHOD_LABELS[detail.return_method]}
            {detail.handover.trackingNumber && <> · tracking <span className="font-mono text-slate-700">{detail.handover.trackingNumber}</span></>} · {photos ? `${photos} photo${photos === 1 ? '' : 's'}` : 'No photos'}
            {' · '}sent <time dateTime={detail.created_at} title={formatDateTime(detail.created_at)}>{timeAgo(detail.created_at)}</time>
          </p>
        </div>
        {canReject && (
          <Button type="text" danger onClick={() => open('reject')} className="-mr-2">Reject</Button>
        )}
        {canRefuseParcel && (
          <Button type="text" danger onClick={() => open('reject-receipt')} className="-mr-2">Goods don&apos;t match</Button>
        )}
      </div>

      {missingPhotos && (
        <p className="m-0 mt-3 text-sm text-amber-800">
          This request includes prescription or special-storage goods and has no photos. Ask the customer for photos before approving.
        </p>
      )}

      {hasActions ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {exchangeReady && (
            <Popconfirm title="Create the replacement order?" description="Stock is reserved at this pharmacy and the order is collected on delivery." okText="Create order" onConfirm={() => call('exchange', undefined, 'Replacement order created.')}>
              <Button type="primary" loading={busy}>Create replacement order</Button>
            </Popconfirm>
          )}
          {actions.map(action => (
            <Button
              key={action.kind}
              type={action.primary ? 'primary' : 'text'}
              disabled={action.kind === 'approve' && missingPhotos}
              onClick={() => open(action.kind)}
              className={action.primary ? undefined : 'text-[#004996]'}
            >
              {action.label}
            </Button>
          ))}
          {canClose && (
            <Popconfirm title="Complete this exchange?" okText="Complete" onConfirm={() => call('close', undefined, 'Exchange completed.')}>
              <Button type="primary" loading={busy}>Complete exchange</Button>
            </Popconfirm>
          )}
          {closeWithoutRefund && (
            <Popconfirm
              title="Close without a refund?"
              description="None of the returned goods passed inspection, and the customer returned them by choice, so nothing is refunded."
              okText="Close request"
              onConfirm={() => call('close', undefined, 'Request closed without refund.')}
            >
              <Button type="primary" loading={busy}>Close without refund</Button>
            </Popconfirm>
          )}
        </div>
      ) : waitingOn && (
        <p className="m-0 mt-2 text-sm text-slate-600">Waiting for {waitingOn}.</p>
      )}
      {errors.length > 0 && !kind && <div className="mt-3"><ErrorSummary messages={errors} /></div>}

      <Modal
        title={kind && TITLES[kind]}
        open={!!kind}
        onCancel={() => setKind(undefined)}
        onOk={() => form.submit()}
        okText="Confirm"
        confirmLoading={busy}
        destroyOnHidden
        forceRender
        width={560}
      >
        <Form form={form} layout="vertical" onFinish={submit} requiredMark={false}>
          <div className="mb-3"><ErrorSummary messages={errors} /></div>

          {kind && ['approve', 'receive', 'inspection'].includes(kind) && <LineFields kind={kind} lines={linesFor(kind)} />}

          {kind === 'approve' && feeAllowed && (
            <Form.Item name="customerFee" label="Return fee charged to the customer" extra="Only when the customer changed their mind and returns by courier.">
              <InputNumber min={0} step={1000} className="w-48" suffix="₫" />
            </Form.Item>
          )}
          {kind && ['approve', 'inspection'].includes(kind) && (
            <Form.Item name="note" label="Note (optional)"><Input.TextArea rows={2} maxLength={1000} /></Form.Item>
          )}
          {kind === 'reject-receipt' && (
            <p className="mt-0 text-sm text-slate-700">
              Use this when the parcel is not what was approved: another product, a counterfeit or an empty box. The request is
              rejected and nothing is refunded or replaced. Add photos of what arrived in the Photos panel before you confirm.
            </p>
          )}
          {kind && ['reject', 'reject-receipt', 'request-info'].includes(kind) && (
            <Form.Item name="note" label={kind === 'request-info' ? 'What do you need from the customer?' : kind === 'reject-receipt' ? 'What arrived instead (shown to the customer)' : 'Reason shown to the customer'} rules={[{ required: true, message: 'This is required.' }]}>
              <Input.TextArea rows={3} maxLength={1000} />
            </Form.Item>
          )}
          {kind === 'carrier' && (
            <>
              <Form.Item name="courierName" label="Courier" rules={[{ required: true, message: 'Choose or enter the courier.' }]}>
                <AutoComplete options={COURIERS.map(value => ({ value }))} maxLength={100} placeholder="GHN, GHTK, Viettel Post…" filterOption />
              </Form.Item>
              <Form.Item
                name="trackingNumber"
                label="Tracking number"
                extra="As printed on the waybill: letters and digits, dashes allowed."
                normalize={(value?: string) => value?.toUpperCase().replace(/\s+/g, '')}
                rules={[
                  { required: true, message: 'Enter the tracking number.' },
                  { pattern: /^[A-Z0-9][A-Z0-9-]{3,39}$/, message: 'Use 4-40 letters or digits (dashes allowed), without accents or spaces.' },
                ]}
              >
                <Input maxLength={40} className="font-mono" />
              </Form.Item>
            </>
          )}
          {kind === 'refund' && (
            <>
              <p className="mt-0 text-xs text-slate-500">The amount is calculated from the inspected goods, minus any return fee and the value of the replacement order.</p>
              <Form.Item name="paymentMethod" label="Refund method" rules={[{ required: true, message: 'Choose a method.' }]}>
                <Select options={(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map(value => ({ value, label: PAYMENT_METHOD_LABELS[value] }))} />
              </Form.Item>
              <Form.Item name="reason" label="Reason" rules={[{ required: true, message: 'Enter a reason.' }]}><Input.TextArea rows={2} maxLength={500} /></Form.Item>
            </>
          )}
          {kind === 'refund/payment' && (
            <Form.Item name="paymentReference" label="Payment reference" extra="Bank transaction code or receipt number. Your name is recorded with the payout." rules={[{ required: true, message: 'Enter the payment reference.' }]}>
              <Input maxLength={100} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </section>
  );
}
