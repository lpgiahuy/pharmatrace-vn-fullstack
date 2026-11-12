'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Form } from 'antd';
import { CameraOutlined, StopOutlined } from '@ant-design/icons';
import { X } from 'lucide-react';
import { PackageQrCamera } from '@/components/shared/PackageQrCamera';
import { readPackageUid } from '@/utils/package-uid';

const split = (text?: string) => (text ?? '').split(/[\s,]+/).filter(Boolean);

/**
 * Box codes for one returned line, shown as removable chips. Codes come from the camera, a USB scanner (it types
 * and presses Enter) or the keyboard, in any mix. Used as an antd Form control: the value stays a newline-separated
 * string of UIDs so the submit code does not change.
 */
export function BoxCodesInput({ id, value, onChange, quantityField }: {
  id?: string;
  value?: string;
  onChange?: (value: string) => void;
  /** Form path of the received quantity on the same line, shown as "N of M boxes". */
  quantityField: (string | number)[];
}) {
  const expected = Number(Form.useWatch(quantityField, Form.useFormInstance()) ?? 0);
  const [draft, setDraft] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string }>();
  const inputRef = useRef<HTMLInputElement>(null);
  // The camera callback fires between renders, so keep the latest list in a ref to avoid losing fast scans.
  const latest = useRef(split(value));
  useEffect(() => { latest.current = split(value); }, [value]);

  const uids = split(value);

  function commit(next: string[]) {
    latest.current = next;
    onChange?.(next.join('\n'));
  }

  /** Adds every code in `raw` (one scan, or a pasted list); keeps unreadable text in the box so it can be fixed. */
  function add(raw: string) {
    const codes = split(raw);
    if (!codes.length) return;
    const next = [...latest.current];
    const rejected: string[] = [];
    let duplicate = false;
    for (const code of codes) {
      const uid = readPackageUid(code);
      if (!uid) rejected.push(code);
      else if (next.includes(uid)) duplicate = true;
      else next.push(uid);
    }
    const added = next.length - latest.current.length;
    if (added) commit(next);
    setDraft(rejected.join(' '));
    setFeedback(rejected.length
      ? { tone: 'error', text: `${rejected.length === 1 ? 'This is' : 'These are'} not a box UID: ${rejected.join(', ')}. A UID looks like 0e434d6b-2621-4488-b435-220421e8c36d.` }
      : duplicate && !added ? { tone: 'error', text: 'That box is already in the list.' }
        : added ? { tone: 'ok', text: `Added ${added} box${added > 1 ? 'es' : ''}.` } : undefined);
  }

  function remove(uid: string) {
    commit(latest.current.filter(entry => entry !== uid));
    setFeedback(undefined);
    inputRef.current?.focus();
  }

  const countTone = !expected ? 'text-slate-500' : uids.length === expected ? 'text-emerald-700' : uids.length > expected ? 'text-red-700' : 'text-slate-500';

  return (
    <div>
      <div
        className="flex min-h-[44px] flex-wrap items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-1.5 focus-within:border-[#004996] focus-within:ring-1 focus-within:ring-[#004996]"
        onClick={() => inputRef.current?.focus()}
      >
        {uids.map(uid => (
          <span key={uid} className="inline-flex items-center gap-1 rounded bg-slate-100 py-0.5 pl-2 pr-0.5 font-mono text-xs text-slate-800" title={uid}>
            {uid}
            <button
              type="button"
              aria-label={`Remove box ${uid}`}
              onClick={event => { event.stopPropagation(); remove(uid); }}
              className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-slate-500 hover:bg-slate-200 hover:text-slate-900"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          value={draft}
          onChange={event => { setDraft(event.target.value); setFeedback(undefined); }}
          onKeyDown={event => {
            if (['Enter', ',', ' ', 'Tab'].includes(event.key) && draft.trim()) {
              event.preventDefault();
              add(draft);
            } else if (event.key === 'Backspace' && !draft && uids.length) {
              remove(uids[uids.length - 1]);
            }
          }}
          onPaste={event => {
            event.preventDefault();
            add(`${draft} ${event.clipboardData.getData('text')}`);
          }}
          onBlur={() => { if (draft.trim()) add(draft); }}
          placeholder={uids.length ? '' : 'Scan or type a box UID, then press Enter'}
          className="min-w-[200px] flex-1 border-0 bg-transparent py-1 font-mono text-xs outline-none"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <Button
          icon={cameraOpen ? <StopOutlined /> : <CameraOutlined />}
          onClick={() => { setCameraOpen(open => !open); setFeedback(undefined); }}
          aria-pressed={cameraOpen}
        >
          {cameraOpen ? 'Stop camera' : 'Scan with camera'}
        </Button>
        <span className={`text-xs tabular-nums ${countTone}`} aria-live="polite">
          {uids.length} of {expected} box{expected === 1 ? '' : 'es'}
        </span>
      </div>
      {cameraOpen && <div className="mt-2"><PackageQrCamera onRead={add} /></div>}
      {feedback && (
        <p role={feedback.tone === 'error' ? 'alert' : 'status'} className={`m-0 mt-1 text-xs ${feedback.tone === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>
          {feedback.text}
        </p>
      )}
    </div>
  );
}
