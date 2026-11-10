'use client';

import { useState } from 'react';
import { App, Button, Form, Input, InputNumber, Modal } from 'antd';
import { InternalTransfer, logisticsService } from '@/services/logistics.service';
import { workflowErrorMessage } from '@/utils/workflow-error';

const uids = (value?: string) => value?.split(/[\s,]+/).filter(Boolean) || [];
const quantityRules = [{ required: true, message: 'Enter the inspected quantity' }];

export function TransferInspection({ transfer, atSource, atDestination, onSaved }: {
  transfer: InternalTransfer; atSource: boolean; atDestination: boolean; onSaved: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const [mode, setMode] = useState<'receive' | 'return' | 'halt' | null>(null);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  const open = (value: typeof mode) => {
    form.resetFields();
    form.setFieldsValue({ lines: transfer.items.map(item => ({ good: item.quantity, damaged: 0, missing: 0 })) });
    setMode(value);
  };
  const save = async (values: { reason?: string; notes?: string; lines: Array<{ good: number; damaged: number; missing: number; goodUids?: string; damagedUids?: string }> }) => {
    setBusy(true);
    try {
      if (mode === 'halt') await logisticsService.haltTransfer(transfer.id, { reason: values.reason! });
      else {
        const inspectionLine = (line: typeof values.lines[number], index: number) => ({
          variantId: transfer.items[index].variantId, damagedQuantity: line.damaged,
          goodUids: line.goodUids?.trim() ? uids(line.goodUids) : undefined, damagedUids: uids(line.damagedUids),
        });
        if (mode === 'return') await logisticsService.receiveTransferReturn(transfer.id, {
          lines: values.lines.map((line, index) => ({ ...inspectionLine(line, index), goodQuantity: line.good })), notes: values.notes,
        });
        else await logisticsService.receiveTransfer(transfer.id, {
          lines: values.lines.map((line, index) => ({ ...inspectionLine(line, index), receivedQuantity: line.good, missingQuantity: line.missing })), notes: values.notes,
        });
      }
      setMode(null);
      message.success('Transfer updated');
      await onSaved();
    } catch (error) { message.error(workflowErrorMessage(error, 'Unable to update transfer')); }
    finally { setBusy(false); }
  };
  return <>
    {transfer.status === 'DISPATCHED' && atDestination && <Button onClick={() => open('receive')}>Inspect & receive</Button>}
    {transfer.status === 'DISPATCHED' && atSource && <Button onClick={() => open('halt')}>Halt & return to source</Button>}
    {transfer.status === 'RETURN_REQUESTED' && atSource && <Button onClick={() => open('return')}>Inspect source return</Button>}
    <Modal title={mode === 'halt' ? 'Halt transfer' : 'Physical transfer inspection'} open={!!mode} onCancel={() => !busy && setMode(null)} onOk={() => form.submit()} confirmLoading={busy} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={save}>
        {mode === 'halt' ? <Form.Item name="reason" label="Reason" rules={[{ required: true, whitespace: true }]}><Input.TextArea /></Form.Item> : <>
          <p>For tracked packages with damage or shortages, scan every good and damaged UID. Remaining dispatched UIDs will be recorded as missing.</p>
          {transfer.items.map((item, index) => <fieldset key={item.variantId} className="border border-slate-200 p-3 mb-3 rounded">
            <legend>{item.medicineName || `Variant #${item.variantId}`} — expected {item.quantity}</legend>
            <div className="flex gap-2 flex-wrap">
              <Form.Item name={['lines', index, 'good']} label="Good" rules={quantityRules}><InputNumber min={0} max={item.quantity} precision={0} /></Form.Item>
              <Form.Item name={['lines', index, 'damaged']} label="Damaged" rules={quantityRules}><InputNumber min={0} max={item.quantity} precision={0} /></Form.Item>
              {mode === 'receive' && <Form.Item name={['lines', index, 'missing']} label="Missing" rules={quantityRules}><InputNumber min={0} max={item.quantity} precision={0} /></Form.Item>}
            </div>
            <Form.Item name={['lines', index, 'goodUids']} label="Good UIDs (comma or newline separated)"><Input.TextArea /></Form.Item>
            <Form.Item name={['lines', index, 'damagedUids']} label="Damaged UIDs"><Input.TextArea /></Form.Item>
          </fieldset>)}
          <Form.Item name="notes" label="Inspection notes"><Input.TextArea /></Form.Item>
        </>}
      </Form>
    </Modal>
  </>;
}
