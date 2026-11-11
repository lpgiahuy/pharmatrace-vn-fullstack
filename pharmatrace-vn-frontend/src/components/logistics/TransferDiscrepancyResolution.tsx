'use client';

import { workflowErrorMessage } from '@/utils/workflow-error';
import { useState } from 'react';
import { Alert, App, Button, Form, Input, Modal, Select } from 'antd';
import { facilityService } from '@/services/facility.service';
import { InternalTransfer, logisticsService } from '@/services/logistics.service';

interface ResolutionInput {
  action: 'RESUPPLY' | 'ACCEPT_SHORTAGE'; sourceFacilityId?: number; reason: string; customerAgreement?: string;
}

export function TransferDiscrepancyResolution({ transfer, onUpdated }: { transfer: InternalTransfer; onUpdated: () => Promise<void> }) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sources, setSources] = useState<Array<{ value: number; label: string }>>([]);
  const [form] = Form.useForm<ResolutionInput>();
  const action = Form.useWatch('action', form);
  const start = async () => {
    setBusy(true);
    try {
      const response = await facilityService.getDropdownList();
      setSources(response.data.map(f => ({ value: f.id, label: f.name })));
      form.resetFields(); setOpen(true);
    } catch (error) { message.error(workflowErrorMessage(error, 'Unable to load replacement sources')); }
    finally { setBusy(false); }
  };
  const submit = async (values: ResolutionInput) => {
    setBusy(true);
    try {
      await logisticsService.resolveDiscrepancy(transfer.id, values);
      setOpen(false); await onUpdated(); message.success('Discrepancy resolution recorded');
    } catch (error) { message.error(workflowErrorMessage(error, 'Unable to resolve discrepancy')); }
    finally { setBusy(false); }
  };
  return <>
    <Button onClick={start} loading={busy}>Resolve shortage or damage</Button>
    <Modal title="Resolve transfer discrepancy" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={busy} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={submit}>
        <Form.Item name="action" label="Resolution" rules={[{ required: true }]}><Select options={[{ value: 'RESUPPLY', label: 'Reallocate affected order lines' }, { value: 'ACCEPT_SHORTAGE', label: 'Accept reduced quantities with customer agreement' }]} /></Form.Item>
        {action === 'RESUPPLY' && <><Alert type="info" showIcon title="Good received stock stays available at the destination. Affected lines are reserved in full at the selected source; another facility creates a replacement transfer." /><Form.Item name="sourceFacilityId" label="Replacement source" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={sources} /></Form.Item></>}
        {action === 'ACCEPT_SHORTAGE' && <><Alert type="warning" showIcon title="Requires an unpaid order without voucher, redeemed points or pending payment evidence. Merchandise totals are reduced; the accepted shipping fee remains unchanged." /><Form.Item name="customerAgreement" label="Customer agreement reference" rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={500} /></Form.Item></>}
        <Form.Item name="reason" label="Decision reason" rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={500} /></Form.Item>
      </Form>
    </Modal>
  </>;
}
