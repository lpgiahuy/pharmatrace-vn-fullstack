'use client';

import { useEffect, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { returnService, type ReturnDetail } from '@/services/return.service';
import { formatDateTime } from '@/utils';

const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

function roleLabel(role: string | null) {
  if (!role) return 'Pharmacy';
  const text = role.replace(/_/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Customer answer to a NEEDS_INFO request. Staff usually ask for photos, so photos can be sent with or
 * instead of text; photos are uploaded first so the pharmacy sees them as soon as the request returns to review.
 */
export function NeedsInfoReply({ detail, busy, onSubmit }: {
  detail: ReturnDetail;
  busy: boolean;
  onSubmit: (task: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [reply, setReply] = useState('');
  // Each picked photo keeps a local preview URL, released when it is removed or the reply is sent.
  const [files, setFiles] = useState<{ file: File; preview: string }[]>([]);
  useEffect(() => () => files.forEach(entry => URL.revokeObjectURL(entry.preview)), [files]);
  const [hint, setHint] = useState('');
  const request = [...detail.events].reverse().find(event => event.to_status === 'NEEDS_INFO');
  const photoRoom = MAX_PHOTOS - detail.attachments.length;

  function addFiles(list: FileList | null) {
    const picked = Array.from(list ?? []);
    const next = [...files.map(entry => entry.file), ...picked];
    if (next.length > photoRoom) return setHint(`This request can hold ${MAX_PHOTOS} photos in total. You can add ${Math.max(photoRoom, 0)} more.`);
    if (next.some(file => file.size > MAX_PHOTO_BYTES || !file.type.startsWith('image/'))) return setHint('Photos must be JPG, PNG or WEBP images smaller than 8 MB.');
    setHint('');
    setFiles(current => [...current.map(entry => ({ file: entry.file, preview: URL.createObjectURL(entry.file) })),
      ...picked.map(file => ({ file, preview: URL.createObjectURL(file) }))]);
  }

  function send() {
    const text = reply.trim();
    if (!text && !files.length) return setHint('Write a reply or add a photo.');
    const note = text || `Added ${files.length} photo${files.length > 1 ? 's' : ''}.`;
    void onSubmit(async () => {
      // Drop each photo once stored, so retrying after a failure does not upload it twice.
      for (const { file } of files) {
        await returnService.upload('customer', detail.id, file);
        setFiles(current => current.filter(entry => entry.file !== file).map(entry => ({ file: entry.file, preview: URL.createObjectURL(entry.file) })));
      }
      await returnService.act('customer', detail.id, 'info', { note });
    }, 'Reply sent. The pharmacy will review your request again.');
  }

  const canAttach = files.length < photoRoom;

  return (
    <section aria-labelledby="needs-info-title">
      <h2 id="needs-info-title" className="m-0 mb-2 text-sm font-bold text-slate-900">Reply to the pharmacy</h2>

      {detail.staff_note && (
        <div className="mb-3">
          <p className="m-0 mb-1 text-xs text-slate-500">
            {request ? <>{roleLabel(request.actor_role)} · <time dateTime={request.created_at}>{formatDateTime(request.created_at)}</time></> : 'Pharmacy'}
          </p>
          <p className="m-0 inline-block max-w-full whitespace-pre-line rounded-lg rounded-tl-sm bg-slate-100 px-3 py-2 text-sm text-slate-900">{detail.staff_note}</p>
        </div>
      )}

      <div className="rounded-lg border border-slate-300 bg-white focus-within:border-[#004996] focus-within:ring-1 focus-within:ring-[#004996]">
        <label htmlFor="reply" className="sr-only">Your reply</label>
        <textarea
          id="reply"
          rows={2}
          maxLength={1000}
          value={reply}
          onChange={event => { setReply(event.target.value); setHint(''); }}
          placeholder="Write a reply…"
          aria-describedby={hint ? 'reply-hint' : undefined}
          className="block w-full resize-none rounded-t-lg border-0 bg-transparent px-3 pt-2.5 text-sm focus:outline-none"
        />

        {files.length > 0 && (
          <ul className="m-0 flex list-none flex-wrap gap-2 px-3 pb-1 pt-1">
            {files.map(({ file, preview }, index) => (
              <li key={preview} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                <img src={preview} alt={file.name} className="h-14 w-14 rounded-md border border-slate-200 object-cover" />
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => setFiles(files.filter((_, i) => i !== index).map(entry => ({ file: entry.file, preview: URL.createObjectURL(entry.file) })))}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-slate-800 text-white hover:bg-slate-900"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <label
            title={canAttach ? `JPG, PNG or WEBP, up to 8 MB. ${photoRoom} more allowed.` : `This request already has ${MAX_PHOTOS} photos.`}
            className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors focus-within:outline-2 focus-within:outline-[#004996] ${canAttach ? 'cursor-pointer text-slate-600 hover:bg-slate-100 hover:text-slate-900' : 'cursor-not-allowed text-slate-400'}`}
          >
            <ImagePlus className="h-4 w-4" aria-hidden />
            Photo
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={!canAttach} className="sr-only" onChange={event => { addFiles(event.target.files); event.target.value = ''; }} />
          </label>
          <button type="button" disabled={busy} onClick={send} className="inline-flex min-h-[36px] cursor-pointer items-center rounded-md bg-[#004996] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#003875] disabled:cursor-wait disabled:opacity-70">
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
      {hint && <p id="reply-hint" role="alert" className="m-0 mt-1 text-xs text-red-700">{hint}</p>}
    </section>
  );
}

