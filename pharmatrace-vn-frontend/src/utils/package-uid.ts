const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readPackageUid(code: string): string | null {
  let uid = code.trim();
  if (/^https?:\/\//i.test(uid)) {
    try {
      uid = new URL(uid).searchParams.get('uid') || '';
    } catch {
      return null;
    }
  }
  return UUID.test(uid) ? uid.toLowerCase() : null;
}
