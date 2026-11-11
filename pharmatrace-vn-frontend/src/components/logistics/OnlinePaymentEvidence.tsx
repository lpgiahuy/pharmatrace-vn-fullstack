'use client';

import { useCallback, useEffect, useState } from 'react';
import { App, Button, Form, Input, InputNumber, Modal } from 'antd';
import { OnlinePaymentReceipt, Order, orderService } from '@/services/order.service';
import { workflowErrorMessage } from '@/utils/workflow-error';

export function OnlinePaymentEvidence({ order, role, onUpdated }: { order: Order; role: string; onUpdated: () => Promise<void> }) {
  const { message } = App.useApp();
  const [receipts, setReceipts] = useState<OnlinePaymentReceipt[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [form] = Form.useForm();
  const canApprove = ['FINANCE_MANAGER', 'SUPER_ADMIN'].includes(role);
  const refresh = useCallback(async () => {
    try { setReceipts((await orderService.getOnlinePayments(order.id)).data); }
    catch (error) { message.error(workflowErrorMessage(error, 'Unable to load payment evidence')); }
  }, [order.id, message]);

  useEffect(() => {
    let active = true;
    orderService.getOnlinePayments(order.id)
      .then(res => { if (active) setReceipts(res.data); })
      .catch(error => { if (active) message.error(workflowErrorMessage(error, 'Unable to load payment evidence')); });
    return () => { active = false; };
  }, [order.id, message]);

  useEffect(() => {
    if (open) {
      form.setFieldsValue({ amount: order.totalAmount, paymentReference: undefined });
    }
  }, [open, order.totalAmount, form]);
  const submit = async (values: { amount: number; paymentReference: string }) => {
    setBusy(true);
    try {
      await orderService.submitOnlinePayment(order.id, { ...values, paymentMethod: order.paymentMethod });
      setOpen(false);
      await refresh();
      message.success('Payment evidence submitted for approval');
    } catch (error) { message.error(workflowErrorMessage(error, 'Unable to submit payment evidence')); }
    finally { setBusy(false); }
  };
  const approve = async (id: number) => {
    setBusy(true);
    try { await orderService.approveOnlinePayment(order.id, id); await refresh(); await onUpdated(); message.success('Payment approved'); }
    catch (error) { message.error(workflowErrorMessage(error, 'Unable to approve payment')); }
    finally { setBusy(false); }
  };
  const reject = async () => {
    if (!rejectId || !rejectReason.trim()) { message.error('Enter a rejection reason'); return; }
    setBusy(true);
    try { await orderService.rejectOnlinePayment(order.id, rejectId, rejectReason.trim()); setRejectId(null); setRejectReason(''); await refresh(); message.success('Payment evidence rejected'); }
    catch (error) { message.error(workflowErrorMessage(error, 'Unable to reject payment')); }
    finally { setBusy(false); }
  };
  return <div className="space-y-2">
    {receipts.map(receipt => <div key={receipt.id} className="text-xs border rounded p-2">
      <p>{receipt.status}: {Number(receipt.amount).toLocaleString()} — {receipt.payment_method} — {receipt.payment_reference}</p>
      <p>Recorded by {receipt.recorded_by_name || `Staff #${receipt.recorded_by}`}{receipt.approved_by ? `; approved by ${receipt.approved_by_name || `Staff #${receipt.approved_by}`}` : ''}</p>
      {receipt.rejection_reason && <p>Rejected by {receipt.rejected_by_name || `Staff #${receipt.rejected_by}`}: {receipt.rejection_reason}</p>}
      {canApprove && receipt.status === 'PENDING' && <div className="flex gap-2"><Button size="small" loading={busy} onClick={() => approve(receipt.id)}>Approve payment</Button><Button size="small" onClick={() => setRejectId(receipt.id)}>Reject</Button></div>}
    </div>)}
    {order.paymentStatus === 'UNPAID' && order.orderStatus === 'PENDING' && !receipts.some(receipt => receipt.status === 'PENDING') &&
      <Button onClick={() => setOpen(true)}>Record payment evidence</Button>}
    <Modal title="Record online payment" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={busy} destroyOnHidden>
      <p>Submit the actual received amount and payment reference for finance approval.</p>
      <Form form={form} layout="vertical" onFinish={submit} preserve={false} initialValues={{ amount: order.totalAmount }}>
        <Form.Item name="amount" label="Amount received" rules={[{ required: true }]}><InputNumber min={0.01} precision={2} className="w-full" /></Form.Item>
        <Form.Item name="paymentReference" label="Payment reference" rules={[{ required: true, whitespace: true }]}><Input maxLength={100} /></Form.Item>
      </Form>
    </Modal>
    <Modal title="Reject payment evidence" open={rejectId !== null} onCancel={() => { setRejectId(null); setRejectReason(''); }} onOk={reject} confirmLoading={busy} destroyOnHidden>
      <Input.TextArea value={rejectReason} onChange={event => setRejectReason(event.target.value)} maxLength={500} aria-label="Rejection reason" />
    </Modal>
  </div>;
}
