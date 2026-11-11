import { logisticsActorLabel, type LogisticsEvent } from '@/services/logistics.service';
import { SHIPPING_STATUS_MAP, TRANSFER_STATUS_MAP } from './LogisticsBadges';
import { formatDateTime } from '@/utils';

type Tone = 'done' | 'failed' | 'neutral';

const DOT: Record<Tone, string> = {
  done: 'bg-emerald-600 border-emerald-600',
  failed: 'bg-red-600 border-red-600',
  neutral: 'bg-white border-slate-400',
};

export function LogisticsHistory({ events, transfer = false }: { events?: LogisticsEvent[]; transfer?: boolean }) {
  const statuses: Record<string, { label: string }> = transfer ? TRANSFER_STATUS_MAP : SHIPPING_STATUS_MAP;
  return <section aria-label={`${transfer ? 'Transfer' : 'Shipment'} event history`}>
    <h3 className="m-0 mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
      {transfer ? 'Transfer' : 'Shipment'} history{events?.length ? ` · ${events.length}` : ''}
    </h3>
    {events?.length ? <ol className="m-0 list-none p-0">
      {events.map((ev, index) => {
        const carrierChange = !transfer && ev.reason?.startsWith('Carrier updated:') && !ev.old_status;
        const failed = transfer ? ev.new_status.includes('REJECTED') : ev.new_status === 'DELIVERY_FAILED';
        const done = ev.new_status === (transfer ? 'RECEIVED' : 'DELIVERED');
        const tone: Tone = done ? 'done' : failed ? 'failed' : 'neutral';
        const last = index === events.length - 1;
        const title = carrierChange ? 'Carrier details updated' : statuses[ev.new_status]?.label || ev.new_status;
        const detail = carrierChange ? ev.reason?.slice('Carrier updated:'.length).trim() : ev.reason;
        const when = formatDateTime(transfer ? ev.created_at : ev.occurred_at || ev.created_at);
        return <li key={`${ev.new_status}-${ev.created_at}-${index}`} className="relative grid grid-cols-[14px_1fr] gap-x-3">
          <span className="relative flex justify-center" aria-hidden>
            {!last && <span className="absolute left-1/2 top-4 bottom-0 w-px -translate-x-1/2 bg-slate-300" />}
            <span className={`mt-1 h-2.5 w-2.5 rounded-full border-2 ${DOT[tone]}`} />
          </span>
          <div className={last ? '' : 'pb-4'}>
            <div className="flex flex-col gap-y-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-x-3">
              <p className={`m-0 text-sm font-semibold ${failed ? 'text-red-700' : 'text-slate-900'}`}>
                {title}
                {ev.old_status && <span className="ml-2 text-xs font-normal text-slate-500">from {statuses[ev.old_status]?.label || ev.old_status}</span>}
              </p>
              <time className="text-xs tabular-nums text-slate-500">{when}</time>
            </div>
            {detail && <p className={`m-0 mt-1 border-l-2 pl-2.5 text-xs leading-relaxed ${failed ? 'border-red-300 text-red-800' : 'border-slate-300 text-slate-600'}`}>
              <span className="font-medium">{transfer ? 'Note' : carrierChange ? 'Change' : 'Reason'}:</span> {detail}
            </p>}
            <p className="m-0 mt-1 break-words text-xs text-slate-500">
              {logisticsActorLabel(ev)}
              {!transfer && ev.occurred_at && <span className="block sm:inline"><span className="hidden sm:inline"> · </span>recorded {formatDateTime(ev.created_at)}</span>}
            </p>
          </div>
        </li>;
      })}
    </ol> : <p className="m-0 text-xs text-slate-500">No events recorded yet.</p>}
  </section>;
}
