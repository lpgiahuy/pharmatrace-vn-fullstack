'use client';

import { workflowErrorMessage } from '@/utils/workflow-error';
import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Form, Input, InputNumber, Modal, Select } from 'antd';
import { Order, orderService, PaymentException } from '@/services/order.service';

interface ExceptionInput { amount: number; paymentMethod: string; paymentReference: string; reason: string }
interface DecisionInput { amount?: number; reference: string; reason: string }

export function PaymentExceptions({ order, role, onUpdated }: { order: Order; role: string; onUpdated: () => Promise<void> }) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<PaymentException[]>([]);
  const [recordOpen, setRecordOpen] = useState(false);
  const [decision, setDecision] = useState<{ row: PaymentException; action: 'APPROVE' | 'APPLY' | 'REFUND' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [recordForm] = Form.useForm<ExceptionInput>();
  const [decisionForm] = Form.useForm<DecisionInput>();
  const canApprove = ['SUPER_ADMIN', 'FINANCE_MANAGER'].includes(role);
  const reload = useCallback(async () => setRows((await orderService.getPaymentExceptions(order.id)).data), [order.id]);
  useEffect(() => {
    let active = true;
    orderService.getPaymentExceptions(order.id)
      .then(res => { if (active) setRows(res.data); })
      .catch(error => { if (active) message.error(workflowErrorMessage(error, 'Unable to load payment exceptions')); });
    return () => { active = false; };
  }, [order.id, message]);
  const record = async (values: ExceptionInput) => {
    setBusy(true);
    try { await orderService.recordPaymentException(order.id, values); setRecordOpen(false); await reload(); message.success('Exception submitted for finance approval'); }
    catch (error) { message.error(workflowErrorMessage(error, 'Unable to record exception')); }
    finally { setBusy(false); }
  };
  const resolve = async (values: DecisionInput) => {
    if (!decision) return;
    setBusy(true);
    try { await orderService.resolvePaymentException(order.id, decision.row.id, { ...values, action: decision.action }); setDecision(null); await reload(); await onUpdated(); message.success('Finance decision recorded'); }
    catch (error) { message.error(workflowErrorMessage(error, 'Unable to record decision')); }
    finally { setBusy(false); }
  };
  const start = (row: PaymentException, action: 'APPROVE' | 'APPLY' | 'REFUND') => { setDecision({ row, action }); };
  return <div className="space-y-3 mt-4">
    <h4 className="font-semibold">Late, short or excess payments</h4>
    <p className="text-sm">Record actual funds with their original bank/wallet reference. Approved receipts remain on hold until allocated or refunded. Cancelled orders are never reopened by a payment.</p>
    {rows.map(row => <div key={row.id} className="border rounded p-3 space-y-2 text-sm">
      <p>#{row.id} — {row.payment_method} — {row.payment_reference}</p>
      <p>Received: {Number(row.amount).toLocaleString()} · Allocated: {Number(row.allocated).toLocaleString()} · Refunded: {Number(row.refunded).toLocaleString()} · On hold: {(Number(row.amount) - Number(row.allocated) - Number(row.refunded)).toLocaleString()}</p>
      <p>{row.approved_by ? `Approved by ${row.approved_by_name || `Staff #${row.approved_by}`}` : 'Awaiting finance approval'} · {row.reason}</p>
      {row.actions.map(action => <p key={action.id}>{action.action}: {Number(action.amount).toLocaleString()} — {action.reference} — {action.actor_name || `Staff #${action.actor_id}`}: {action.reason}</p>)}
      {canApprove && <div className="flex flex-wrap gap-2">{!row.approved_by ? <Button onClick={() => start(row, 'APPROVE')}>Approve actual receipt</Button> : <>
        {order.paymentStatus === 'UNPAID' && !['CANCELLED', 'CANCELED'].includes(order.orderStatus) && <Button disabled={Number(row.amount) <= Number(row.allocated) + Number(row.refunded)} onClick={() => start(row, 'APPLY')}>Allocate to order</Button>}
        <Button disabled={Number(row.amount) <= Number(row.refunded) + (['CANCELLED', 'CANCELED'].includes(order.orderStatus) ? 0 : Number(row.allocated))} onClick={() => start(row, 'REFUND')}>Record actual refund</Button>
      </>}</div>}
    </div>)}
    <Button onClick={() => setRecordOpen(true)}>Record exceptional payment</Button>
    <Modal title="Record actual exceptional payment" open={recordOpen} onCancel={() => setRecordOpen(false)} onOk={() => recordForm.submit()} confirmLoading={busy} destroyOnHidden>
      <Form form={recordForm} layout="vertical" onFinish={record} preserve={false}>
        <Form.Item name="paymentMethod" label="Received via" rules={[{ required: true }]}><Select options={[{ value: 'BANK_TRANSFER', label: 'Bank transfer' }, { value: 'E_WALLET', label: 'E-wallet' }]} /></Form.Item>
        <Form.Item name="amount" label="Amount actually received" rules={[{ required: true }]}><InputNumber min={0.01} precision={2} /></Form.Item>
        <Form.Item name="paymentReference" label="Original transaction reference" rules={[{ required: true, whitespace: true }]}><Input maxLength={100} /></Form.Item>
        <Form.Item name="reason" label="Exception reason" rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={500} /></Form.Item>
      </Form>
    </Modal>
    <Modal title={decision?.action === 'REFUND' ? 'Record completed refund' : decision?.action === 'APPLY' ? 'Allocate approved funds' : 'Approve actual receipt'} open={!!decision} onCancel={() => setDecision(null)} onOk={() => decisionForm.submit()} confirmLoading={busy} destroyOnHidden>
      {decision?.action === 'REFUND' && <Alert showIcon type="warning" title="Record only a refund already paid to the customer. This action records the cashbook expense." />}
      <Form form={decisionForm} layout="vertical" onFinish={resolve} preserve={false}>
        {decision?.action !== 'APPROVE' && <Form.Item name="amount" label="Amount" rules={[{ required: true }]}><InputNumber min={0.01} precision={2} /></Form.Item>}
        <Form.Item name="reference" label={decision?.action === 'REFUND' ? 'Actual refund transaction reference' : 'Decision / allocation reference'} rules={[{ required: true, whitespace: true }]}><Input maxLength={100} /></Form.Item>
        <Form.Item name="reason" label="Decision reason" rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={500} /></Form.Item>
      </Form>
    </Modal>
  </div>;
}
