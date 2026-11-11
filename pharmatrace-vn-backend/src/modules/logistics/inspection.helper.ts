import { BadRequestException } from '@nestjs/common';

export function validateInspectionUids(assigned: string[], groups: Array<{ quantity: number; uids?: string[] }>, allowMissing = false) {
  const selected = groups.flatMap(group => group.uids || []);
  if (groups.some(group => !Number.isSafeInteger(group.quantity) || group.quantity < 0)) {
    throw new BadRequestException('Inspection quantities must be non-negative integers.');
  }
  if (new Set(assigned).size !== assigned.length || new Set(selected).size !== selected.length ||
      selected.some(uid => !assigned.includes(uid)) ||
      (assigned.length > 0 && groups.some(group => (group.uids || []).length !== group.quantity)) ||
      (!allowMissing && assigned.length > 0 && selected.length !== assigned.length)) {
    throw new BadRequestException('Inspection UID groups must be unique, belong to this order, and match inspected quantities.');
  }
}
