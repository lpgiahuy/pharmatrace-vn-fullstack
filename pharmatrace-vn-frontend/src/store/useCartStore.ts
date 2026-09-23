import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface CartItem {
  id: string; // `${productId}-${variantId || 'base'}`
  productId: number;
  slug: string;
  medicineName: string;
  imageUrl?: string | null;
  variantId?: number;
  unitName: string;
  price: number;
  originalPrice?: number | null;
  quantity: number;
}

export interface AppliedVoucher {
  voucherId: number;
  voucherCode: string;
  discountType: string;
  discountValue: number;
  discountAmount: number;
  minOrderValue: number;
  maxDiscountAmount: number | null;
}

interface CartState {
  items: CartItem[];
  appliedVoucher: AppliedVoucher | null;
  isDrawerOpen: boolean;

  // Actions
  addItem: (item: Omit<CartItem, 'quantity'>, quantity?: number) => void;
  updateQuantity: (id: string, quantity: number) => void;
  removeItem: (id: string) => void;
  clearCart: () => void;
  setDrawerOpen: (open: boolean) => void;
  applyVoucher: (voucher: AppliedVoucher) => void;
  removeVoucher: () => void;

  // Selectors / Helpers
  getTotalItems: () => number;
  getSubtotal: () => number;
  getDiscountAmount: () => number;
  getTotalAmount: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      appliedVoucher: null,
      isDrawerOpen: false,

      addItem: (item, quantity = 1) => {
        set((state) => {
          const existingIndex = state.items.findIndex((i) => i.id === item.id);
          let newItems: CartItem[];

          if (existingIndex > -1) {
            newItems = [...state.items];
            newItems[existingIndex] = {
              ...newItems[existingIndex],
              quantity: newItems[existingIndex].quantity + quantity,
            };
          } else {
            newItems = [...state.items, { ...item, quantity }];
          }

          return { items: newItems };
        });
      },

      updateQuantity: (id, quantity) => {
        set((state) => {
          if (quantity <= 0) {
            return { items: state.items.filter((i) => i.id !== id) };
          }
          return {
            items: state.items.map((i) =>
              i.id === id ? { ...i, quantity } : i,
            ),
          };
        });
      },

      removeItem: (id) => {
        set((state) => ({
          items: state.items.filter((i) => i.id !== id),
        }));
      },

      clearCart: () => {
        set({ items: [], appliedVoucher: null });
      },

      setDrawerOpen: (isDrawerOpen) => {
        set({ isDrawerOpen });
      },

      applyVoucher: (appliedVoucher) => {
        set({ appliedVoucher });
      },

      removeVoucher: () => {
        set({ appliedVoucher: null });
      },

      getTotalItems: () => {
        return get().items.reduce((total, item) => total + item.quantity, 0);
      },

      getSubtotal: () => {
        return get().items.reduce(
          (total, item) => total + item.price * item.quantity,
          0,
        );
      },

      getDiscountAmount: () => {
        const { appliedVoucher } = get();
        const subtotal = get().getSubtotal();
        if (!appliedVoucher || subtotal < (appliedVoucher.minOrderValue || 0)) {
          return 0;
        }

        if (appliedVoucher.discountType === 'PERCENT') {
          let discount = (subtotal * appliedVoucher.discountValue) / 100;
          if (
            appliedVoucher.maxDiscountAmount &&
            discount > appliedVoucher.maxDiscountAmount
          ) {
            discount = appliedVoucher.maxDiscountAmount;
          }
          return Math.round(discount);
        }

        return Math.min(appliedVoucher.discountValue, subtotal);
      },

      getTotalAmount: () => {
        const subtotal = get().getSubtotal();
        const discount = get().getDiscountAmount();
        return Math.max(0, subtotal - discount);
      },
    }),
    {
      name: 'pharmatrace_cart_v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        items: state.items,
        appliedVoucher: state.appliedVoucher,
      }),
    },
  ),
);
