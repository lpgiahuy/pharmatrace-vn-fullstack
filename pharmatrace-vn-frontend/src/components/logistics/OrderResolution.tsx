'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Form, Input, Modal } from 'antd';
import { CloseCircleOutlined } from '@ant-design/icons';
import { Order } from '@/services/order.service';
import { apiClient } from '@/services/api.client';
import { formatDateTime } from '@/utils';
import { workflowErrorMessage } from '@/utils/workflow-error';

interface Resolution {
  cancellations: Array<{ reason: string; cancelled_by: number; cancelled_at: string; cancelled_by_name?: string | null }>;
}

export function OrderResolution({ order, role, onUpdated }: { order: Order; role: string; onUpdated: () => Promise<void> }) {
  const { message } = App.useApp();
  const [data, setData] = useState<Resolution | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  const canResolve = ['SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST'].includes(role);

  const refresh = useCallback(async () => {
    const response = await apiClient.get<unknown, { data: Resolution }>(`/admin/orders/${order.id}/resolution`);
    setData(response.data);
  }, [order.id]);

  useEffect(() => {
    let active = true;
    apiClient.get<unknown, { data: Resolution }>(`/admin/orders/${order.id}/resolution`)
      .then(response => { if (active) setData(response.data); })
      .catch(error => { if (active) message.error(workflowErrorMessage(error, 'Unable to load order resolution')); });
    return () => { active = false; };
  }, [order.id, message]);

  const submit = async (values: { reason?: string }) => {
    setBusy(true);
    try {
      await apiClient.patch(`/admin/orders/${order.id}/status`, { orderStatus: 'CANCELLED', note: values.reason?.trim() });
      await refresh();
      await onUpdated();
      setCancelOpen(false);
      message.success('Order cancelled successfully');
    } catch (error) { message.error(workflowErrorMessage(error, 'Unable to cancel the order')); }
    finally { setBusy(false); }
  };

  if (!data) return null;
  const cancellation = data.cancellations[0];
  const canCancel = canResolve && ['PENDING', 'WAITING_INTERNAL_TRANSFER', 'PROCESSING'].includes(order.orderStatus)
    && (order.orderStatus !== 'PROCESSING' || ['SUPER_ADMIN', 'STORE_MANAGER'].includes(role))
    && !(order.prescriptionId && order.prescriptionReviewStatus === 'APPROVED');

  if (!canCancel && !cancellation) return null;

  return (
    <>
      <div className="mt-6 space-y-4">
        {canCancel && (
          <div>
            <Button
              danger
              type="primary"
              icon={<CloseCircleOutlined />}
              onClick={() => setCancelOpen(true)}
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
      </div>

      <Modal
        title="Cancel Order"
        open={cancelOpen}
        onCancel={() => !busy && setCancelOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={busy}
        okText="Confirm Cancellation"
        okButtonProps={{ danger: true }}
        destroyOnHidden
      >
        <Alert
          type="error"
          showIcon
          title={`Cancel Order #${order.id}`}
          description="All reserved items will be released back into warehouse inventory. Please provide a cancellation reason."
          className="mb-4"
        />
        <Form form={form} layout="vertical" onFinish={submit} preserve={false}>
          <Form.Item
            name="reason"
            label="Cancellation Reason"
            rules={[{ required: true, whitespace: true, message: 'Please provide a reason' }]}
          >
            <Input.TextArea
              rows={3}
              maxLength={500}
              placeholder="e.g. Customer requested cancellation before shipping"
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
