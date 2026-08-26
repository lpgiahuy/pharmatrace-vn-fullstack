import { apiClient } from './api.client';
import { CustomerRegisterDto } from '@/types/auth.types';

export const authService = {
  async login(credentials: {
    loginType?: string;
    email?: string;
    identifier?: string;
    phone?: string;
    password?: string;
  }) {
    if (credentials.loginType === 'admin') {
      const res: any = await apiClient.post('/admin/auth/login', {
        email: credentials.email || credentials.identifier || '',
        password: credentials.password || '',
      });
      return res.data; // { user, accessToken }
    }

    if (credentials.loginType === 'warehouse') {
      const res: any = await apiClient.post('/warehouse/auth/login', {
        email: credentials.email || credentials.identifier || '',
        password: credentials.password || '',
      });
      return res.data; // { user, accessToken }
    }

    const identity = credentials.identifier || credentials.phone || credentials.email || '';
    const res: any = await apiClient.post('/auth/login', {
      identifier: identity,
      password: credentials.password || '',
    });
    return res.data;
  },

  async register(payload: CustomerRegisterDto) {
    const res: any = await apiClient.post('/auth/register', {
      name: payload.name,
      phone: payload.phone,
      email: payload.email || undefined,
      password: payload.password,
      address: payload.address || undefined,
    });
    return res.data;
  },

  async logout() {
    try {
      await apiClient.post('/auth/logout');
    } catch { }
  },

  async getProfile() {
    const res: any = await apiClient.get('/auth/me');
    return res.data;
  },

  async updateProfile(payload: { fullName?: string; email?: string; defaultAddress?: string }) {
    const res: any = await apiClient.patch('/auth/me', payload);
    return res.data;
  },

  async changePassword(payload: { currentPassword: string; newPassword: string }) {
    const res: any = await apiClient.patch('/auth/me/change-password', payload);
    return res.data;
  },

  async getLoyaltyProgress() {
    const res: any = await apiClient.get('/auth/loyalty-progress');
    return res.data;
  },

  async forgotPassword(email: string) {
    const res: any = await apiClient.post('/auth/forgot-password', { email });
    return res.data;
  },

  async resetPassword(tokenOrPayload: string | { token: string; password?: string; newPassword?: string }, newPassword?: string) {
    let token = '';
    let password = '';

    if (typeof tokenOrPayload === 'object' && tokenOrPayload !== null) {
      token = tokenOrPayload.token || '';
      password = tokenOrPayload.password || tokenOrPayload.newPassword || '';
    } else {
      token = tokenOrPayload || '';
      password = newPassword || '';
    }

    const res: any = await apiClient.post('/auth/reset-password', { token, newPassword: password });
    return res.data;
  },
};
