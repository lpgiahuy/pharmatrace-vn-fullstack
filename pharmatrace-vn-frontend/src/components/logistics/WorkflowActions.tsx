'use client';

import { useState } from 'react';
import { App, Button, Form, Input, InputNumber, Modal, Popconfirm, Select } from 'antd';
import { InternalTransfer, Shipment, logisticsService, DeliveryProofPayload, ReturnDispositionPayload, ReturnRefundPayload, ReconcileCodPayload, canCollectShipmentCod } from '@/services/logistics.service';
import { codSubmissionMessage } from '@/utils/cod-workflow';
import { formatCurrency, formatDateTime } from '@/utils';
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

export function ShipmentWorkflowActions({ shipment, canManage, canIntake, canRefund, onSaved }: {
  shipment: Shipment; canManage: boolean; canIntake: boolean; canRefund: boolean; onSaved: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const [mode, setMode] = useState<'proof' | 'rma' | 'intake' | 'qa' | 'refund' | 'refundPayment' | null>(null);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  const items = shipment.orders?.order_items || [];
  const returnedItems = shipment.returnItems || [];
  const open = (value: typeof mode) => {
    form.resetFields();
    form.setFieldsValue({ proofType: 'DELIVERY_PHOTO', deliveredToName: shipment.orders?.recipient_name, customerFee: 0, paymentMethod: 'BANK_TRANSFER',
      lines: value === 'qa'
        ? returnedItems.map(item => ({ passQuantity: item.quantity, failQuantity: 0, restockBoxUids: item.box_uids.join('\n') }))
        : items.map(() => ({ quantity: 0, boxUids: '' })) });
    setMode(value);
  };
  const save = async (values: DeliveryProofPayload & ReturnRefundPayload & { paymentReference: string; notes: string; qaNotes: string; lines: Array<{ quantity: number; boxUids?: string; passQuantity: number; failQuantity: number; restockBoxUids?: string; scrapBoxUids?: string }> }) => {
    setBusy(true);
    try {
      if (mode === 'proof') await logisticsService.confirmDeliveryWithProof(shipment.id, { proofType: values.proofType, proofReference: values.proofReference, deliveredToName: values.deliveredToName, deliveryNotes: values.deliveryNotes });
      if (mode === 'rma') await logisticsService.requestPostDeliveryReturn(shipment.id, { reason: values.reason, lines: values.lines.map((line, index) => ({ variantId: items[index].variant_id, quantity: line.quantity })).filter(line => line.quantity > 0) });
      if (mode === 'intake') await logisticsService.receiveReturn(shipment.id, { notes: values.notes, receivedLines: values.lines.map((line, index) => ({ variantId: items[index].variant_id, quantity: line.quantity, boxUids: uids(line.boxUids) })).filter(line => line.quantity > 0) });
      if (mode === 'refund') await logisticsService.approveReturnRefund(shipment.id, { goodsValue: values.goodsValue, customerFee: values.customerFee, paymentMethod: values.paymentMethod, reason: values.reason });
      if (mode === 'refundPayment') await logisticsService.recordRefundPayment(shipment.id, values.paymentReference);
      if (mode === 'qa') {
        const lines = values.lines.map((line, index) => ({ passQuantity: line.passQuantity, failQuantity: line.failQuantity, variantId: returnedItems[index].variant_id, restockBoxUids: uids(line.restockBoxUids), scrapBoxUids: uids(line.scrapBoxUids) }));
        const passed = lines.reduce((sum, line) => sum + line.passQuantity, 0);
        const failed = lines.reduce((sum, line) => sum + line.failQuantity, 0);
        const decision: ReturnDispositionPayload['decision'] = passed === 0 ? 'SCRAP' : failed === 0 ? 'RESTOCK' : 'PARTIAL_RESTOCK';
        await logisticsService.dispositionReturn(shipment.id, { decision, qaNotes: values.qaNotes, lines });
      }
      setMode(null);
      message.success('Shipment updated');
      await onSaved();
    } catch (error) { message.error(workflowErrorMessage(error, 'Unable to update shipment')); }
    finally { setBusy(false); }
  };
  return <div className="flex gap-2 flex-wrap">
    {canManage && shipment.shipping_status === 'IN_TRANSIT' && <Button onClick={() => open('proof')}>Record delivery evidence</Button>}
    {canManage && shipment.shipping_status === 'DELIVERED' && <Button onClick={() => open('rma')}>Approve post-delivery return</Button>}
    {canIntake && ['RETURN_REQUESTED', 'RETURN_IN_TRANSIT'].includes(shipment.shipping_status) && <Button onClick={() => open('intake')}>Receive into quarantine</Button>}
    {canManage && shipment.shipping_status === 'RETURNED_TO_WAREHOUSE' && shipment.return_qa_status !== 'COMPLETED' && <Button disabled={!returnedItems.length} onClick={() => open('qa')}>Inspect returned goods</Button>}
    {canRefund && shipment.return_qa_status === 'COMPLETED' && shipment.orders?.payment_status === 'PAID' && !shipment.refundDecision && <Button onClick={() => open('refund')}>Approve refund</Button>}
    {canRefund && shipment.refundDecision?.status === 'APPROVED' && <Button onClick={() => open('refundPayment')}>Record refund payment</Button>}
    {shipment.refundDecision && <p>Refund {shipment.refundDecision.status === 'APPROVED' ? 'approved, payment pending' : 'paid'}: {Number(shipment.refundDecision.refund_amount).toLocaleString()} — {shipment.refundDecision.payment_method}, approved by staff #{shipment.refundDecision.approved_by}{shipment.refundDecision.payment_reference ? `, reference ${shipment.refundDecision.payment_reference}` : ''}.</p>}
    <Modal title={{ proof: 'Delivery evidence', rma: 'Approve return', intake: 'Physical return intake', qa: 'Return quality inspection', refund: 'Approve refund', refundPayment: 'Record refund payment' }[mode || 'proof']} open={!!mode} onCancel={() => !busy && setMode(null)} onOk={() => form.submit()} confirmLoading={busy} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={save}>
        {mode === 'proof' && <>
          <Form.Item name="proofType" label="Evidence type" rules={[{ required: true }]}><Select options={['CUSTOMER_SIGNATURE', 'DELIVERY_PHOTO', 'OTP', 'DISPATCH_NOTE', 'STAFF_CONFIRMATION'].map(value => ({ value, label: value }))} /></Form.Item>
          <Form.Item name="proofReference" label="Evidence reference" rules={[{ required: true, whitespace: true }]}><Input maxLength={500} /></Form.Item>
          <Form.Item name="deliveredToName" label="Recipient name" rules={[{ required: true, whitespace: true }]}><Input maxLength={150} /></Form.Item>
          <Form.Item name="deliveryNotes" label="Delivery notes"><Input.TextArea maxLength={500} /></Form.Item>
        </>}
        {mode === 'rma' && <><p>Enter approved return quantities. Leave other lines at zero.</p>{items.map((item, index) => <Form.Item key={item.variant_id} name={['lines', index, 'quantity']} label={`${item.medicine_name || `Variant #${item.variant_id}`} — purchased ${item.quantity}`} rules={quantityRules}><InputNumber min={0} max={item.quantity} precision={0} /></Form.Item>)}<Form.Item name="reason" label="Approval reason" rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={500} /></Form.Item></>}
        {mode === 'refund' && <><p>Enter the paid value of returned goods after applicable discounts and the customer fee. Refund = goods value − customer fee. Payment must be recorded separately after approval.</p><Form.Item name="goodsValue" label="Paid value of returned goods" rules={quantityRules}><InputNumber min={0.01} precision={2} className="w-full" /></Form.Item><Form.Item name="customerFee" label="Customer return fee" rules={quantityRules}><InputNumber min={0} precision={2} className="w-full" /></Form.Item><Form.Item name="paymentMethod" label="Refund method" rules={[{ required: true }]}><Select options={['CASH', 'BANK_TRANSFER', 'DEBIT_CARD', 'E_WALLET'].map(value => ({ value, label: value }))} /></Form.Item><Form.Item name="reason" label="Financial decision and fee reason" rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={500} /></Form.Item></>}
        {mode === 'refundPayment' && <><p>Record payment only after it has been sent using the approved method.</p><Form.Item name="paymentReference" label="Payment reference" rules={[{ required: true, whitespace: true }]}><Input maxLength={100} /></Form.Item></>}
        {mode === 'intake' && <><p>Enter only the quantities physically received. Goods remain quarantined until QA is completed.</p>{items.map((item, index) => {
          const limit = shipment.return_category === 'POST_DELIVERY_RMA' ? shipment.authorizedItems?.find(line => line.variant_id === item.variant_id)?.quantity || 0 : item.quantity;
          return <fieldset key={item.variant_id} className="border border-slate-200 p-3 mb-3 rounded"><legend>{item.medicine_name || `Variant #${item.variant_id}`} — {shipment.return_category === 'POST_DELIVERY_RMA' ? 'authorized' : 'ordered'} {limit}</legend><Form.Item name={['lines', index, 'quantity']} label="Received quantity" rules={quantityRules}><InputNumber min={0} max={limit} precision={0} /></Form.Item><Form.Item name={['lines', index, 'boxUids']} label="Received UIDs"><Input.TextArea disabled={limit === 0} /></Form.Item></fieldset>;
        })}<Form.Item name="notes" label="Intake notes"><Input.TextArea maxLength={500} /></Form.Item></>}
        {mode === 'qa' && <>
          <p>Failed units remain in quarantine pending a separate disposal or return decision.</p>
          {returnedItems.map((item, index) => <fieldset key={item.variant_id} className="border border-slate-200 p-3 mb-3 rounded">
            <legend>{items.find(entry => entry.variant_id === item.variant_id)?.medicine_name || `Variant #${item.variant_id}`} — received {item.quantity}</legend>
            <Form.Item name={['lines', index, 'passQuantity']} label="Passed quantity" rules={quantityRules}><InputNumber min={0} max={item.quantity} precision={0} /></Form.Item>
            <Form.Item name={['lines', index, 'failQuantity']} label="Failed quantity" rules={quantityRules}><InputNumber min={0} max={item.quantity} precision={0} /></Form.Item>
            <p className="text-xs break-all">Received UIDs: {item.box_uids.join(', ') || 'Untracked units'}</p>
            <Form.Item name={['lines', index, 'restockBoxUids']} label="Passed UIDs"><Input.TextArea /></Form.Item>
            <Form.Item name={['lines', index, 'scrapBoxUids']} label="Failed UIDs remaining in quarantine"><Input.TextArea /></Form.Item>
          </fieldset>)}
          <Form.Item name="qaNotes" label="QA assessment" rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={500} /></Form.Item>
        </>}
      </Form>
    </Modal>
  </div>;
}

export function CodReconciliation({ shipment, onSaved, canSubmit, canApprove }: { shipment: Shipment; onSaved: () => Promise<void>; canSubmit: boolean; canApprove: boolean }) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  const save = async (values: ReconcileCodPayload) => {
    setBusy(true);
    try {
      const result = await logisticsService.reconcileCod(shipment.id, values);
      message.success(codSubmissionMessage(result.data.status));
      setOpen(false);
      await onSaved();
    } catch (error) { message.error(workflowErrorMessage(error, 'Unable to reconcile COD')); }
    finally { setBusy(false); }
  };
  const approve = async (statementId: number) => {
    setBusy(true);
    try {
      const result = await logisticsService.approveCodStatement(shipment.id, statementId);
      if (result.data.status === 'DISCREPANCY_PENDING') message.warning('Statement has a discrepancy; no cashbook entry was created.');
      else if (result.data.status === 'SETTLED') message.success('COD statement approved and settled.');
      else message.info('COD statement reviewed.');
      await onSaved();
    } catch (error) { message.error(workflowErrorMessage(error, 'Unable to approve COD statement')); }
    finally { setBusy(false); }
  };
  const reviews = shipment.statementReviews || [];
  const pending = reviews.some(review => review.status === 'PENDING');
  return <>
    {reviews.length > 0 && <div className="space-y-2">
      <h3 className="text-xs sm:text-sm font-bold text-slate-900 m-0">Carrier statements</h3>
      {reviews.map(review => <div key={review.id} className="rounded-md border border-slate-200 bg-white p-3 text-xs space-y-2">
        <div className="font-semibold">{review.statement_reference} — {review.status === 'PENDING' ? 'Pending approval' : review.status === 'APPROVED' ? 'Approved' : 'Discrepancy pending'}</div>
        <div>Gross: {formatCurrency(Number(review.gross))} · Fee: {formatCurrency(Number(review.fee))} · Adjustment: {formatCurrency(Number(review.adjustment))} · Net: {formatCurrency(Number(review.net))}</div>
        <div className="text-slate-500">Submitted by staff #{review.recorded_by} · {formatDateTime(review.recorded_at)}{review.approved_by ? ` · Reviewed by staff #${review.approved_by}` : ''}</div>
        {canApprove && review.status === 'PENDING' && <Popconfirm title="Approve this carrier statement?" description="Approval records the settlement or marks a discrepancy." onConfirm={() => approve(review.id)} okText="Approve" cancelText="Cancel"><Button type="primary" size="small" loading={busy}>Approve statement</Button></Popconfirm>}
      </div>)}
    </div>}
    {canSubmit && canCollectShipmentCod(shipment) && !pending && <Button onClick={() => { form.resetFields(); form.setFieldsValue({ grossAmount: Number(shipment.cod_amount), courierFee: 0, adjustmentAmount: 0, netAmount: Number(shipment.cod_amount) }); setOpen(true); }}>Submit carrier statement</Button>}
    <Modal title="COD reconciliation" open={open} onCancel={() => !busy && setOpen(false)} onOk={() => form.submit()} confirmLoading={busy} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={save}>
        <p>Net remittance = gross collected − courier fee + adjustment. The statement requires approval before settlement.</p>
        {(['grossAmount', 'courierFee', 'adjustmentAmount', 'netAmount'] as const).map((name, index) => <Form.Item key={name} name={name} label={['Gross collected', 'Courier fee', 'Adjustment', 'Net remitted'][index]} rules={quantityRules}><InputNumber min={name === 'adjustmentAmount' ? undefined : 0} precision={2} className="w-full" /></Form.Item>)}
        <Form.Item name="statementReference" label="Carrier statement reference" rules={[{ required: true, whitespace: true }]}><Input maxLength={100} /></Form.Item>
        <Form.Item name="discrepancyNote" label="Review notes"><Input.TextArea maxLength={500} /></Form.Item>
      </Form>
    </Modal>
  </>;
}
