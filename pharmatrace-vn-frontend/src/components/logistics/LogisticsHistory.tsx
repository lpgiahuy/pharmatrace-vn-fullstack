import { Timeline } from 'antd';
import { HistoryOutlined } from '@ant-design/icons';
import { logisticsActorLabel, type LogisticsEvent } from '@/services/logistics.service';
import { SHIPPING_STATUS_MAP, TRANSFER_STATUS_MAP } from './LogisticsBadges';
import { formatDateTime } from '@/utils';

export function LogisticsHistory({ events, transfer = false }: { events?: LogisticsEvent[]; transfer?: boolean }) {
  const statuses: Record<string, { label: string }> = transfer ? TRANSFER_STATUS_MAP : SHIPPING_STATUS_MAP;
  return <div className="space-y-2.5">
    <h3 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center gap-1.5 m-0">
      <HistoryOutlined /> {transfer ? 'Transfer' : 'Shipment'} Event History
    </h3>
    {events?.length ? <div className="bg-slate-50 p-3.5 rounded-md border border-slate-200">
      <Timeline items={events.map(ev => {
        const carrierChange = !transfer && ev.reason?.startsWith('Carrier updated:') && !ev.old_status;
        const failed = transfer ? ev.new_status.includes('REJECTED') : ev.new_status === 'DELIVERY_FAILED';
        return {
          color: ev.new_status === (transfer ? 'RECEIVED' : 'DELIVERED') ? 'green' : failed ? 'red' : 'blue',
          content: <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-xs text-slate-800">{carrierChange ? 'Carrier details updated' : statuses[ev.new_status]?.label || ev.new_status}</span>
              {ev.old_status && <span className="text-[11px] text-slate-400">(from {statuses[ev.old_status]?.label || ev.old_status})</span>}
            </div>
            {ev.reason && <p className={`text-xs p-2 rounded border m-0 ${transfer || failed ? 'text-rose-700 bg-rose-50 border-rose-200' : 'text-slate-700 bg-slate-100 border-slate-200'}`}>
              <strong>{transfer ? 'Note:' : carrierChange ? 'Change:' : 'Reason:'}</strong>{' '}
              {carrierChange ? ev.reason.slice('Carrier updated:'.length).trim() : ev.reason}
            </p>}
            <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span>{formatDateTime(transfer ? ev.created_at : ev.occurred_at || ev.created_at)}</span>
              {!transfer && ev.occurred_at && <span className="text-slate-400">(Recorded: {formatDateTime(ev.created_at)})</span>}
              <span className="text-slate-700">By: <strong className="font-semibold text-slate-800">{logisticsActorLabel(ev)}</strong></span>
            </div>
          </div>,
        };
      })} />
    </div> : <p className="text-xs text-slate-500 italic">No events recorded yet.</p>}
  </div>;
}
