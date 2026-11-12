'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import { MapPin } from 'lucide-react';
import type { SelectedLocationResult } from '@/components/shared/MapAddressPickerModal';

// Leaflet touches `window`, so the picker is loaded on the client only.
const MapAddressPickerModal = dynamic(() => import('@/components/shared/MapAddressPickerModal'), { ssr: false });

const MAX_ADDRESS = 500;

/** Pickup address with the same "Select on Map" picker used at checkout. Empty means the order's delivery address. */
export function PickupAddressField({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const [mapOpen, setMapOpen] = useState(false);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor={id} className="block text-xs font-medium text-slate-700">Pickup address</label>
        <button
          type="button"
          onClick={() => setMapOpen(true)}
          className="inline-flex min-h-[32px] cursor-pointer items-center gap-1 text-xs font-semibold text-[#004996] transition-colors hover:text-[#003772] hover:underline"
        >
          <MapPin className="h-3.5 w-3.5" aria-hidden />
          Select on Map
        </button>
      </div>
      <div className="relative">
        <MapPin className="absolute left-3 top-3 h-4 w-4 text-slate-400" aria-hidden />
        <textarea
          id={id}
          rows={2}
          maxLength={MAX_ADDRESS}
          value={value}
          onChange={event => onChange(event.target.value)}
          placeholder="Leave empty to use this order's delivery address"
          className="w-full resize-none rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-[#004996] focus:outline-none focus:ring-1 focus:ring-[#004996]"
        />
      </div>
      {/* Portal + raised layer so the picker also works when this field sits inside an antd Modal (z-index 1000, transformed). */}
      {mapOpen && createPortal(
        <div className="relative z-[1100]">
          <MapAddressPickerModal
            isOpen={mapOpen}
            onClose={() => setMapOpen(false)}
            initialAddress={value}
            onConfirm={(result: SelectedLocationResult) => onChange(result.fullAddress.slice(0, MAX_ADDRESS))}
          />
        </div>,
        document.body,
      )}
    </div>
  );
}
