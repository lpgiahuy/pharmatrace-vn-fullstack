import { redirect } from 'next/navigation';

export default function CustomerProfileRedirect() {
  redirect('/account');
}
