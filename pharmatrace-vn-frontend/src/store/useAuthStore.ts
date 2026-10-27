'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authService } from '@/services/auth.service';
import {
  getPortalKey,
  getPortalUser,
  getPortalToken,
  setPortalAuth,
  clearPortalAuth,
} from '@/utils/portalAuth';

export interface UserSession {
  user: any;
  accessToken: string | null;
  refreshToken?: string | null;
}

export interface UserProfile {
  id: number;
  name?: string;
  fullName?: string;
  username?: string;
  email?: string;
  phone?: string;
  role?: string;
  facilityId?: number;
  defaultAddress?: string;
  rewardPoints?: number;
  membershipTier?: string;
}

interface AuthState {
  customerSession: UserSession | null;
  adminSession: UserSession | null;
  warehouseSession: UserSession | null;
  isLoading: boolean;
  error: string | null;


  getUser: () => any;
  getAccessToken: () => string | null;
  getIsAuthenticated: () => boolean;

  login: (credentials: any) => Promise<any>;
  loginCustomer: (identity: string, password: string) => Promise<any>;
  loginStaff: (email: string, password: string) => Promise<any>;
  loginWarehouse: (email: string, password: string) => Promise<any>;
  register: (data: any) => Promise<any>;
  registerCustomer: (data: any) => Promise<any>;
  setAuth: (user: any, token: string) => void;
  logout: () => Promise<void>;
  updateUser: (updates: any) => void;
  hasRole: (roles: string | string[]) => boolean;
  clearError: () => void;
  fetchProfile: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      customerSession: null,
      adminSession: null,
      warehouseSession: null,
      isLoading: false,
      error: null,


      getUser: () => {
        if (typeof window === 'undefined') return null;
        const portal = getPortalKey(window.location.pathname);
        return get()[`${portal}Session`]?.user || getPortalUser(portal) || null;
      },

      getAccessToken: () => {
        if (typeof window === 'undefined') return null;
        const portal = getPortalKey(window.location.pathname);
        return get()[`${portal}Session`]?.accessToken || getPortalToken(portal) || null;
      },

      getIsAuthenticated: () => {
        if (typeof window === 'undefined') return false;
        const portal = getPortalKey(window.location.pathname);
        const u = get()[`${portal}Session`]?.user || getPortalUser(portal);
        const t = get()[`${portal}Session`]?.accessToken || getPortalToken(portal);
        return !!u && !!t;
      },

      login: async (credentials) => {
        set({ isLoading: true, error: null });
        try {
          const result = await authService.login(credentials);
          const portal = getPortalKey(typeof window !== 'undefined' ? window.location.pathname : '/');

          const accessToken = result.accessToken || null;
          const refreshToken = (result as any).refreshToken || null;
          const expiresAt = (result as any).expiresAt || Date.now() + 3600000;

          setPortalAuth(portal, result.user, accessToken, refreshToken, expiresAt);

          const sessionKey = `${portal}Session` as const;
          const sessionData = { user: result.user, accessToken, refreshToken };

          set({
            [sessionKey]: sessionData,
            isLoading: false,
          } as any);

          return result;
        } catch (err: any) {
          const message = err.response?.data?.message || err.message || 'Login failed';
          set({ error: message, isLoading: false });
          throw err;
        }
      },

      loginCustomer: async (identity, password) => {
        return get().login({
          loginType: 'customer',
          identifier: identity,
          password,
        });
      },

      loginStaff: async (email, password) => {
        return get().login({
          loginType: 'admin',
          email,
          password,
        });
      },

      loginWarehouse: async (email, password) => {
        return get().login({
          loginType: 'warehouse',
          email,
          password,
        });
      },

      register: async (formData) => {
        set({ isLoading: true, error: null });
        try {
          const result = await authService.register(formData);
          set({ isLoading: false });
          return result;
        } catch (err: any) {
          const message = err.response?.data?.message || err.message || 'Registration failed';
          set({ error: message, isLoading: false });
          throw err;
        }
      },

      registerCustomer: async (formData) => {
        return get().register(formData);
      },

      setAuth: (user, token) => {
        const portal = getPortalKey();
        setPortalAuth(portal, user, token);
        const sessionKey = `${portal}Session` as const;
        set({
          [sessionKey]: { user, accessToken: token },
        } as any);
      },

      logout: async () => {
        const portal = getPortalKey();
        const sessionKey = `${portal}Session` as const;
        const currentUser = get()[sessionKey]?.user || getPortalUser(portal);
        const userRole = currentUser?.role;

        let redirectUrl = '/login';
        if (['WAREHOUSE_MANAGER', 'WAREHOUSE_STAFF', 'FACTORY_WAREHOUSE_STAFF'].includes(userRole) || portal === 'warehouse') {
          redirectUrl = '/warehouse/login';
        } else if (['SUPER_ADMIN', 'ADMIN', 'STORE_MANAGER', 'PHARMACIST'].includes(userRole) || portal === 'admin') {
          redirectUrl = '/admin/login';
        }

        try {
          await authService.logout();
        } catch { }

        clearPortalAuth(portal);

        set({
          [sessionKey]: null,
        } as any);

        if (typeof window !== 'undefined') {
          window.location.href = redirectUrl;
        }
      },

      updateUser: (updates) => {
        const portal = getPortalKey();
        const sessionKey = `${portal}Session` as const;
        const currentSession = get()[sessionKey] || { user: {}, accessToken: null };
        const updatedUser = { ...currentSession.user, ...updates };
        setPortalAuth(portal, updatedUser);
        set({
          [sessionKey]: { ...currentSession, user: updatedUser },
        } as any);
      },

      hasRole: (roles) => {
        const portal = getPortalKey();
        const user = get()[`${portal}Session`]?.user || getPortalUser(portal);
        if (!user) return false;
        const allowed = Array.isArray(roles) ? roles : [roles];
        const userRole = user.role;
        return allowed.some((r) => r.toLowerCase() === (userRole || '').toLowerCase());
      },

      clearError: () => set({ error: null }),

      fetchProfile: async () => {
        try {
          set({ isLoading: true });
          const user = await authService.getProfile();
          const portal = getPortalKey();
          const sessionKey = `${portal}Session` as const;
          set({
            [sessionKey]: { user, accessToken: getPortalToken(portal) },
            isLoading: false,
          } as any);
        } catch {
          set({ isLoading: false });
        }
      },
    }),
    {
      name: 'pharma-auth',
      partialize: (state) => ({
        customerSession: state.customerSession,
        adminSession: state.adminSession,
        warehouseSession: state.warehouseSession,
      }),
    }
  )
);

export const useAuth = () => {
  const store = useAuthStore();
  const portal = typeof window !== 'undefined' ? getPortalKey(window.location.pathname) : 'customer';
  const session = store[`${portal}Session`] || null;
  const user = session?.user || getPortalUser(portal) || null;
  const accessToken = session?.accessToken || getPortalToken(portal) || null;
  const isAuthenticated = !!user && !!accessToken;

  return {
    ...store,
    user,
    accessToken,
    isAuthenticated,
  };
};
