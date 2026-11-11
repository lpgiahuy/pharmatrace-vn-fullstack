export function workflowErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = error.message;
    if (typeof message === 'string' && message) return message;
    if (Array.isArray(message) && message.every(value => typeof value === 'string')) return message.join('. ');
  }
  return fallback;
}
