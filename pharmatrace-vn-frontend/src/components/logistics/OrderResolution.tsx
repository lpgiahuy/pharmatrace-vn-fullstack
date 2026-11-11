'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Form, Input, InputNumber, Modal, Select } from 'antd';
import { CloseCircleOutlined } from '@ant-design/icons';
import { Order } from '@/services/order.service';
import { apiClient } from '@/services/api.client';
import { formatDateTime } from '@/utils';

interface Resolution {
  cancellations: Array<{ reason: string; cancelled_by: number; cancelled_at: string; cancelled_by_name?: string | null }>;
  disputes: Array<{ reason: string; opened_at: string; outcome: string | null; resolution_reason: string | null; resolved_by: number | null; resolved_at: string | null; resolved_by_name?: string | null }>;
  refunds: Array<{ amount: string; payment_method: string; reason: string; approved_by: number; approved_at: string; payment_reference: string | null; executed_by: number | null; executed_at: string | null; approved_by_name?: string | null; executed_by_name?: string | null }>;
}

export function OrderResolution({ order, role, onUpdated }: { order: Order; role: string; onUpdated: () => Promise<void> }) {
  const { message } = App.useApp();
  const [data, setData] = useState<Resolution | null>(null);
  const [action, setAction] = useState<'dispute' | 'approve' | 'payment' | 'cancel' | null>(null);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  const canResolve = ['SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST'].includes(role);
  const canApprove = ['SUPER_ADMIN', 'FINANCE_MANAGER'].includes(role);
  const canRecord = ['SUPER_ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'].includes(role);

  const refresh = useCallback(async () => {
    const response = await apiClient.get<unknown, { data: Resolution }>(`/admin/orders/${order.id}/resolution`);
    setData(response.data);
  }, [order.id]);

  useEffect(() => {
    let active = true;
    apiClient.get<unknown, { data: Resolution }>(`/admin/orders/${order.id}/resolution`)
      .then(response => { if (active) setData(response.data); })
      .catch(error => { if (active) message.error(error?.message || 'Unable to load order resolution'); });
    return () => { active = false; };
  }, [order.id, message]);

  const open = (next: typeof action) => {
    setAction(next);
  };

  useEffect(() => {
    if (action) {
      form.setFieldsValue({
        amount: order.totalAmount,
        paymentMethod: 'BANK_TRANSFER',
        outcome: undefined,
        reason: undefined,
        paymentReference: undefined,
      });
    }
  }, [action, order.totalAmount, form]);

  const submit = async (values: { amount?: number; paymentMethod?: string; paymentReference?: string; outcome?: string; reason?: string }) => {
    setBusy(true);
    try {
      if (action === 'cancel') {
        await apiClient.patch(`/admin/orders/${order.id}/status`, { orderStatus: 'CANCELLED', note: values.reason?.trim() });
      } else {
        const route = action === 'dispute' ? 'dispute/resolve' : `cancellation-refund/${action === 'approve' ? 'approve' : 'payment'}`;
        const payload = action === 'dispute' ? { outcome: values.outcome, reason: values.reason?.trim() }
          : action === 'approve' ? { amount: values.amount, paymentMethod: values.paymentMethod, reason: values.reason?.trim() }
            : { amount: values.amount, paymentReference: values.paymentReference?.trim() };
        await apiClient.post(`/admin/orders/${order.id}/${route}`, payload);
      }
      await refresh();
      await onUpdated();
      setAction(null);
      message.success(action === 'cancel' ? 'Order cancelled successfully' : 'Order resolution saved');
    } catch (error) { message.error((error as { message?: string })?.message || 'Unable to save order resolution'); }
    finally { setBusy(false); }
  };

  if (!data) return null;
  const dispute = data.disputes[0];
  const refund = data.refunds[0];
  const cancellation = data.cancellations[0];
  const canCancel = canResolve && ['PENDING', 'WAITING_INTERNAL_TRANSFER', 'PROCESSING'].includes(order.orderStatus)
    && (order.orderStatus !== 'PROCESSING' || ['SUPER_ADMIN', 'STORE_MANAGER'].includes(role))
    && !(order.prescriptionId && order.prescriptionReviewStatus === 'APPROVED');
  const canApproveRefund = !refund && canApprove && order.orderStatus === 'CANCELLED' && order.paymentStatus === 'PAID' && !order.shipment;

  const hasContent = canCancel || cancellation || dispute || refund || canApproveRefund;
  if (!hasContent) return null;

  return (
    <>
      <div className="mt-6 space-y-4">
        {canCancel && (
          <div>
            <Button
              danger
              type="primary"
              icon={<CloseCircleOutlined />}
              onClick={() => open('cancel')}
              className="font-medium"
            >
              Cancel order
            </Button>
          </div>
        )}

        {cancellation && (
          <Alert
            type="error"
            showIcon
            title="Order Has Been Cancelled"
            description={
              <div className="text-xs space-y-1 mt-1 text-slate-700">
                <div>Cancelled by <strong>{cancellation.cancelled_by_name || `Staff #${cancellation.cancelled_by}`}</strong> at {formatDateTime(cancellation.cancelled_at)}</div>
                {cancellation.reason && <div>Reason: <span className="italic font-medium text-slate-900">{cancellation.reason}</span></div>}
              </div>
            }
          />
        )}

        {dispute && (
          <div className="p-4 rounded-md border border-amber-200 bg-amber-50/40 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-amber-900">Delivery Dispute</div>
              <span className="text-xs text-amber-700">Opened {formatDateTime(dispute.opened_at)}</span>
            </div>
            <p className="text-xs text-amber-800 m-0">Reason: {dispute.reason}</p>
            {dispute.outcome ? (
              <div className="text-xs text-amber-900 pt-2 border-t border-amber-200/60">
                <strong>{dispute.outcome === 'DELIVERED' ? 'Delivery confirmed' : 'Non-delivery confirmed'}:</strong> {dispute.resolution_reason}
                <span className="text-amber-700 ml-1.5">(Resolved by <strong>{dispute.resolved_by_name || `Staff #${dispute.resolved_by}`}</strong> at {formatDateTime(dispute.resolved_at!)})</span>
              </div>
            ) : (
              <div className="flex items-center justify-between pt-2 border-t border-amber-200/60">
                <span className="text-xs text-amber-800 font-medium">Dispute is open. Customer loyalty points are on hold.</span>
                {canResolve && (
                  <Button size="small" onClick={() => open('dispute')}>Resolve dispute</Button>
                )}
              </div>
            )}
          </div>
        )}

        {refund && (
          <div className="p-4 rounded-md border border-blue-200 bg-blue-50/30 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-blue-900">
                Refund {Number(refund.amount).toLocaleString('vi-VN')} ₫ via {refund.payment_method}
              </div>
              <span className="text-xs text-blue-700">Approved by <strong>{refund.approved_by_name || `Staff #${refund.approved_by}`}</strong> at {formatDateTime(refund.approved_at)}</span>
            </div>
            <p className="text-xs text-blue-800 m-0">Reason: {refund.reason}</p>
            {refund.payment_reference ? (
              <p className="text-xs text-blue-900 m-0 pt-2 border-t border-blue-200/60">
                <strong>Actual payment reference:</strong> {refund.payment_reference} (Recorded by <strong>{refund.executed_by_name || `Staff #${refund.executed_by}`}</strong> at {formatDateTime(refund.executed_at!)})
              </p>
            ) : (
              <div className="flex items-center justify-between pt-2 border-t border-blue-200/60">
                <span className="text-xs text-blue-800 font-medium">Approved; actual payment reference has not been recorded.</span>
                {canRecord && (
                  <Button size="small" type="primary" onClick={() => open('payment')}>Record actual refund</Button>
                )}
              </div>
            )}
          </div>
        )}

        {canApproveRefund && (
          <div className="flex items-center justify-between p-4 rounded-md border border-slate-200 bg-slate-50">
            <div className="text-xs text-slate-600">
              Order was paid but cancelled before shipping. A cancellation refund can be approved.
            </div>
            <Button type="primary" onClick={() => open('approve')}>Approve cancellation refund</Button>
          </div>
        )}
      </div>

      <Modal
        title={
          action === 'dispute'
            ? 'Resolve Delivery Dispute'
            : action === 'cancel'
              ? 'Cancel Order'
              : action === 'approve'
                ? 'Approve Cancellation Refund'
                : 'Record Actual Refund'
        }
        open={action !== null}
        onCancel={() => !busy && setAction(null)}
        onOk={() => form.submit()}
        confirmLoading={busy}
        okText={
          action === 'cancel'
            ? 'Confirm Cancellation'
            : action === 'approve'
              ? 'Approve Refund'
              : action === 'payment'
                ? 'Save Payment'
                : 'Submit Resolution'
        }
        okButtonProps={action === 'cancel' ? { danger: true } : undefined}
        destroyOnHidden
      >
        {action === 'cancel' && (
          <Alert
            type="error"
            showIcon
            title={`Cancel Order #${order.id}`}
            description="All reserved items will be released back into warehouse inventory. Please provide a cancellation reason."
            className="mb-4"
          />
        )}
        {action === 'payment' && (
          <p className="text-xs text-slate-500 mb-3">
            Record the completed payment with its actual amount and bank or cash voucher reference.
          </p>
        )}
        <Form
          form={form}
          layout="vertical"
          onFinish={submit}
          preserve={false}
          initialValues={{
            amount: order.totalAmount,
            paymentMethod: 'BANK_TRANSFER',
          }}
        >
          {action === 'dispute' && (
            <Form.Item name="outcome" label="Conclusion" rules={[{ required: true }]}>
              <Select
                options={[
                  { value: 'DELIVERED', label: 'Delivery confirmed' },
                  { value: 'NOT_DELIVERED', label: 'Non-delivery confirmed' },
                ]}
              />
            </Form.Item>
          )}
          {(action === 'approve' || action === 'payment') && (
            <Form.Item name="amount" label="Amount" rules={[{ required: true }]}>
              <InputNumber min={0.01} precision={2} className="w-full" />
            </Form.Item>
          )}
          {action === 'approve' && (
            <Form.Item name="paymentMethod" label="Refund method" rules={[{ required: true }]}>
              <Select options={['BANK_TRANSFER', 'E_WALLET', 'CASH'].map((value) => ({ value, label: value }))} />
            </Form.Item>
          )}
          {action === 'payment' ? (
            <Form.Item name="paymentReference" label="Actual payment reference" rules={[{ required: true, whitespace: true }]}>
              <Input maxLength={100} placeholder="e.g. FT2611108234 / Cash slip #012" />
            </Form.Item>
          ) : (
            <Form.Item
              name="reason"
              label={action === 'cancel' ? 'Cancellation Reason' : 'Reason'}
              rules={[{ required: true, whitespace: true, message: 'Please provide a reason' }]}
            >
              <Input.TextArea
                rows={3}
                maxLength={500}
                placeholder={action === 'cancel' ? 'e.g. Customer requested cancellation before shipping' : 'Enter reason...'}
              />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </>
  );
}
