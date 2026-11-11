export function codPermissions(role?: string | null) {
  const normalized = (role || '').toUpperCase().replace(/[\s_-]/g, '');
  return {
    canView: ['SUPERADMIN', 'STOREMANAGER', 'ACCOUNTANT', 'FINANCEMANAGER'].includes(normalized),
    canSubmit: ['SUPERADMIN', 'ACCOUNTANT', 'FINANCEMANAGER'].includes(normalized),
    canApprove: ['SUPERADMIN', 'FINANCEMANAGER'].includes(normalized),
  };
}

export function codSubmissionMessage(status: string) {
  return status === 'PENDING' ? 'Carrier statement submitted and pending approval.' : 'Carrier statement submitted.';
}
