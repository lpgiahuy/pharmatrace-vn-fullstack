'use client';

import React, { useEffect, useRef, useState } from 'react';
import { App, Button, Input, Modal, Spin } from 'antd';
import type { InputRef } from 'antd';
import { BarcodeOutlined, CameraOutlined, CheckCircleOutlined, CloseOutlined, StopOutlined } from '@ant-design/icons';
import { orderService, getOrderItems, type Order, type AvailableBoxInfo } from '@/services/order.service';
import { readPackageUid } from '@/utils/package-uid';
import { PackageQrCamera } from './PackageQrCamera';
import styles from './OrderPackingModal.module.css';

interface OrderPackingModalProps {
  open: boolean;
  onClose: () => void;
  orderId?: number;
  orderData?: Order | null;
  onSuccess?: (orderId?: number) => void;
}

const PACKAGE_UNITS = ['BOX', 'BLISTER', 'BOTTLE', 'VIAL', 'TUBE', 'PACK', 'SACHET', 'AMPOULE', 'PILL', 'TABLET', 'CAPSULE'];

export function OrderPackingModal({ open, onClose, orderId, orderData, onSuccess }: OrderPackingModalProps) {
  const { message } = App.useApp();
  const [order, setOrder] = useState<Order | null>(orderData || null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [availableBoxes, setAvailableBoxes] = useState<AvailableBoxInfo[]>([]);
  const [uids, setUids] = useState<string[]>([]);
  const uidsRef = useRef<string[]>([]);
  const inputRef = useRef<InputRef>(null);
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const targetId = orderId || orderData?.id;

  useEffect(() => {
    if (!open || !targetId) return;
    let active = true;
    const timer = setTimeout(() => {
      uidsRef.current = [];
      setUids([]);
      setInput('');
      setInputError('');
      setSubmitError('');
      setCameraOpen(false);
      setLoading(true);
      setLoadError('');
      setAvailableBoxes([]);
      void Promise.all([
        orderService.getAdminById(targetId),
        orderService.getAvailableBoxes(targetId),
      ]).then(([detail, boxes]) => {
        if (!active) return;
        setOrder(detail);
        setAvailableBoxes(boxes);
      }).catch(() => {
        if (active) setLoadError('Could not load the packing list. Close this window and try again.');
      }).finally(() => {
        if (active) setLoading(false);
      });
    }, 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [open, targetId]);

  const items = getOrderItems(order).filter((item) => !item.unitName ||
    PACKAGE_UNITS.some((unit) => item.unitName.toUpperCase().includes(unit)));
  const total = items.reduce((sum, item) => sum + item.quantity, 0);
  const complete = !loading && !loadError && uids.length === total;

  const addCodes = (raw: string) => {
    const codes = raw.trim().split(/[\s,]+/).filter(Boolean).map(readPackageUid);
    if (!codes.length) return;
    if (codes.some((code) => !code)) {
      setInputError('This is not a package UID. Scan the package QR label or enter its full UID.');
      return;
    }
    const nextUids = codes as string[];
    if (new Set(nextUids).size !== nextUids.length || nextUids.some((uid) => uidsRef.current.includes(uid))) {
      setInputError('This package has already been added.');
      return;
    }
    if (uidsRef.current.length + nextUids.length > total) {
      setInputError(`This order needs ${total} package${total === 1 ? '' : 's'}.`);
      return;
    }
    const selected = [...uidsRef.current, ...nextUids];
    uidsRef.current = selected;
    setUids(selected);
    setInput('');
    setInputError('');
    setSubmitError('');
  };

  const removeUid = (uid: string) => {
    const next = uidsRef.current.filter((value) => value !== uid);
    uidsRef.current = next;
    setUids(next);
    setInputError('');
    setSubmitError('');
    inputRef.current?.focus();
  };

  const handleSubmit = async () => {
    if (!complete || !targetId) return;
    setSubmitting(true);
    setSubmitError('');
    setCameraOpen(false);
    try {
      await orderService.fulfillOrder(targetId, uids);
      message.success('Order packed and ready for dispatch.');
      onSuccess?.(targetId);
      onClose();
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : 'Packing failed. Check the package UIDs and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const close = () => {
    if (submitting) return;
    setCameraOpen(false);
    onClose();
  };

  const findItem = (uid: string) => {
    const box = availableBoxes.find((value) => value.uid === uid);
    return items.find((item) =>
      (item.assignedUids || item.assigned_uids || []).includes(uid) ||
      (box?.medicineId && box.medicineId === item.medicineId));
  };

  return (
    <Modal
      open={open}
      onCancel={close}
      title={<div className={styles.title}><span>Pack order</span><span className={styles.orderCode}>{order?.orderCode || `#${targetId || ''}`}</span></div>}
      width={880}
      centered
      destroyOnHidden
      mask={{ closable: false }}
      keyboard={!submitting}
      closable={!submitting}
      style={{
        maxWidth: 'calc(100vw - 48px)',
        margin: 'auto',
      }}
      classNames={{ container: styles.modalContent, header: styles.header, body: styles.body, footer: styles.footer }}
      footer={
        <div className={styles.footerRow}>
          <span className={styles.footerHint}>{loading ? 'Loading packing list…' : `${uids.length} of ${total} package codes added`}</span>
          <div className={styles.footerActions}>
            <Button onClick={close} disabled={submitting}>Cancel</Button>
            <Button type="primary" onClick={handleSubmit} disabled={!complete} loading={submitting}>Complete packing</Button>
          </div>
        </div>
      }
    >
      {loading ? <div className={styles.loading}><Spin /><span>Loading packing list…</span></div> : loadError ? <p className={styles.loadError} role="alert">{loadError}</p> : (
        <div className={styles.workspace}>
          <section className={styles.pickList} aria-labelledby="packing-items-heading">
            <div className={styles.sectionHeading}><h2 id="packing-items-heading">Items to pack</h2><span>{total} package{total === 1 ? '' : 's'}</span></div>
            {items.map((item) => (
              <article className={styles.pickItem} key={item.id}>
                <div className={styles.itemHeading}>
                  <h3>{item.medicineName}</h3>
                  <span className={styles.quantity}>×{item.quantity}</span>
                </div>
                <p className={styles.itemMeta}><span>{item.unitName}</span>{item.sourceFacilityName && <span>{item.sourceFacilityName}</span>}</p>
                <p className={styles.itemNote}>Scan the UID on the package you pick.</p>
              </article>
            ))}
            {items.length === 0 && <p className={styles.itemNote}>No package QR codes are required for this order.</p>}
          </section>

          <section className={styles.scanArea} aria-labelledby="scan-packages-heading">
            <div className={styles.sectionHeading}><h2 id="scan-packages-heading">Scan packages</h2></div>
            {cameraOpen && !complete ? (
              <div>
                <PackageQrCamera onRead={addCodes} />
                <Button icon={<StopOutlined aria-hidden />} onClick={() => setCameraOpen(false)} className={styles.stopCamera}>Stop camera</Button>
              </div>
            ) : (
              <div className={styles.cameraPrompt}>
                {complete ? <CheckCircleOutlined className={styles.readyIcon} aria-hidden /> : <CameraOutlined className={styles.cameraIcon} aria-hidden />}
                <h3>{complete ? 'Package codes added' : 'Scan a package QR code'}</h3>
                <p>{complete ? 'Review the packages below, then complete packing.' : 'Use your camera to read the code on each package.'}</p>
                {!complete && <Button type="primary" icon={<CameraOutlined aria-hidden />} onClick={() => setCameraOpen(true)} size="large">Open camera</Button>}
              </div>
            )}

            <form className={styles.inputForm} onSubmit={(event) => { event.preventDefault(); addCodes(input); }}>
              <label htmlFor="packing-package-uid">USB scanner or manual UID</label>
              <div className={styles.inputRow}>
                <Input
                  id="packing-package-uid"
                  ref={inputRef}
                  prefix={<BarcodeOutlined aria-hidden />}
                  placeholder="Scan or type the package UID"
                  value={input}
                  onChange={(event) => { setInput(event.target.value); setInputError(''); }}
                  disabled={complete || submitting}
                  status={inputError ? 'error' : undefined}
                  aria-invalid={!!inputError}
                  aria-describedby={inputError ? 'packing-input-error' : 'packing-input-help'}
                  autoComplete="off"
                  size="large"
                />
                <Button htmlType="submit" disabled={complete || !input.trim() || submitting} size="large">Add</Button>
              </div>
              {inputError ? <p id="packing-input-error" className={styles.error} role="alert">{inputError}</p> :
                <p id="packing-input-help" className={styles.helper}>USB or Bluetooth scanner: click this field, scan, then press Enter.</p>}
            </form>

            <div className={styles.scannedHeading}><h3>Added packages</h3><span aria-live="polite" aria-atomic="true">{uids.length} of {total} added</span></div>
            {uids.length === 0 ? <p className={styles.emptyList}>Scanned packages will appear here.</p> : (
              <ul className={styles.scannedList}>
                {uids.map((uid) => (
                  <li key={uid}>
                    <CheckCircleOutlined className={styles.addedIcon} aria-hidden />
                    <div><span>{findItem(uid)?.medicineName || 'Package UID'}</span><code>{uid}</code></div>
                    <Button type="text" icon={<CloseOutlined aria-hidden />} aria-label={`Remove package ${uid}`} onClick={() => removeUid(uid)} disabled={submitting} className={styles.removeButton} />
                  </li>
                ))}
              </ul>
            )}
            {submitError && <p className={styles.error} role="alert">{submitError}</p>}
          </section>
        </div>
      )}
    </Modal>
  );
}
