import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { cartService, ServerCartItem } from '@/services/cart.service';

export interface CartPackagingOption {
  id: number;
  unitName: string;
  price: number;
  originalPrice?: number | null;
}

export interface CartItem {
  id: string; // `${productId}-${variantId || 'base'}`
  productId: number;
  slug: string;
  medicineName: string;
  isPrescription?: boolean;
  imageUrl?: string | null;
  variantId?: number;
  unitName: string;
  price: number;
  originalPrice?: number | null;
  quantity: number;
  packagingOptions?: CartPackagingOption[];
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

  // Actions
  addItem: (item: Omit<CartItem, 'quantity'>, quantity?: number) => void;
  updateQuantity: (id: string, quantity: number) => void;
  updateItemVariant: (
    currentId: string,
    newVariant: { id: number; unitName: string; price: number; originalPrice?: number | null }
  ) => void;
  removeItem: (id: string) => void;
  clearCart: () => void;
  applyVoucher: (voucher: AppliedVoucher) => void;
  removeVoucher: () => void;

  // Server sync for multi-device support
  fetchServerCart: () => Promise<void>;
  syncWithServer: () => Promise<void>;

  // Selection (Shopee-style checkout selection)
  selectedItemIds: string[];
  setSelectedItems: (ids: string[]) => void;
  toggleSelectItem: (id: string) => void;
  selectAllItems: () => void;
  unselectAllItems: () => void;
  getSelectedItems: () => CartItem[];
  getSelectedSubtotal: () => number;
  removeSelectedItems: () => void;

  // Selectors / Helpers
  getTotalItems: () => number;
  getSubtotal: () => number;
  getDiscountAmount: () => number;
  getTotalAmount: () => number;
}

const isCustomerLoggedIn = (): boolean => {
  if (typeof window === 'undefined') return false;
  return Boolean(
    localStorage.getItem('pharma_customer_access_token') ||
    localStorage.getItem('pharma_access_token') ||
    localStorage.getItem('access_token')
  );
};

const mapServerItemToCartItem = (s: ServerCartItem): CartItem => ({
  id: `${s.productId}-${s.variantId}`,
  productId: s.productId,
  slug: s.slug,
  medicineName: s.medicineName,
  isPrescription: s.isPrescription,
  imageUrl: s.imageUrl,
  variantId: s.variantId,
  unitName: s.unitName,
  price: Number(s.price),
  originalPrice: s.originalPrice ? Number(s.originalPrice) : null,
  quantity: s.quantity,
  packagingOptions: (s.packagingOptions || []).map((p) => ({
    id: p.id,
    unitName: p.unitName,
    price: Number(p.price),
    originalPrice: p.originalPrice ? Number(p.originalPrice) : null,
  })),
});

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      selectedItemIds: [],
      appliedVoucher: null,

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

          // Auto-select newly added item
          const newSelectedIds = state.selectedItemIds.includes(item.id)
            ? state.selectedItemIds
            : [...state.selectedItemIds, item.id];

          return { items: newItems, selectedItemIds: newSelectedIds };
        });

        // Background sync to server if customer is authenticated
        if (isCustomerLoggedIn() && item.variantId) {
          cartService.addToCart(item.variantId, quantity).catch(() => {});
        }
      },

      updateQuantity: (id, quantity) => {
        const currentItem = get().items.find((i) => i.id === id);

        set((state) => {
          if (quantity <= 0) {
            return {
              items: state.items.filter((i) => i.id !== id),
              selectedItemIds: state.selectedItemIds.filter((itemId) => itemId !== id),
            };
          }
          return {
            items: state.items.map((i) =>
              i.id === id ? { ...i, quantity } : i,
            ),
          };
        });

        // Background sync to server
        if (isCustomerLoggedIn() && currentItem?.variantId) {
          if (quantity <= 0) {
            cartService.removeItem(currentItem.variantId).catch(() => {});
          } else {
            cartService.updateQuantity(currentItem.variantId, quantity).catch(() => {});
          }
        }
      },

      updateItemVariant: (currentId, newVariant) => {
        const currentItem = get().items.find((i) => i.id === currentId);

        set((state) => {
          if (!currentItem) return state;

          const newId = `${currentItem.productId}-${newVariant.id}`;
          if (newId === currentId) return state;

          const existingTarget = state.items.find((i) => i.id === newId);
          let newItems: CartItem[];
          let newSelectedIds = [...state.selectedItemIds];
          const isCurrentSelected = state.selectedItemIds.includes(currentId);

          if (existingTarget) {
            newItems = state.items
              .filter((i) => i.id !== currentId)
              .map((i) =>
                i.id === newId
                  ? { ...i, quantity: i.quantity + currentItem.quantity }
                  : i
              );
            if (isCurrentSelected && !newSelectedIds.includes(newId)) {
              newSelectedIds.push(newId);
            }
            newSelectedIds = newSelectedIds.filter((id) => id !== currentId);
          } else {
            newItems = state.items.map((i) =>
              i.id === currentId
                ? {
                    ...i,
                    id: newId,
                    variantId: newVariant.id,
                    unitName: newVariant.unitName,
                    price: Number(newVariant.price),
                    originalPrice: newVariant.originalPrice ? Number(newVariant.originalPrice) : null,
                  }
                : i
            );
            if (isCurrentSelected) {
              newSelectedIds = newSelectedIds.map((id) => (id === currentId ? newId : id));
            }
          }

          return { items: newItems, selectedItemIds: newSelectedIds };
        });

        // Background sync to server
        if (isCustomerLoggedIn() && currentItem?.variantId && newVariant.id) {
          cartService.switchVariant(currentItem.variantId, newVariant.id).catch(() => {});
        }
      },

      removeItem: (id) => {
        const currentItem = get().items.find((i) => i.id === id);

        set((state) => ({
          items: state.items.filter((i) => i.id !== id),
          selectedItemIds: state.selectedItemIds.filter((itemId) => itemId !== id),
        }));

        // Background sync to server
        if (isCustomerLoggedIn() && currentItem?.variantId) {
          cartService.removeItem(currentItem.variantId).catch(() => {});
        }
      },

      clearCart: () => {
        set({ items: [], selectedItemIds: [], appliedVoucher: null });

        if (isCustomerLoggedIn()) {
          cartService.clearCart().catch(() => {});
        }
      },

      fetchServerCart: async () => {
        if (!isCustomerLoggedIn()) return;
        try {
          const res = await cartService.getCart();
          if (res?.data?.items) {
            const serverItems = res.data.items.map(mapServerItemToCartItem);
            set((state) => {
              const validIds = new Set(serverItems.map((i) => i.id));
              const retainedSelected = state.selectedItemIds.filter((id) => validIds.has(id));
              return {
                items: serverItems,
                selectedItemIds: retainedSelected,
              };
            });
          }
        } catch {
          // Keep local cart if network error
        }
      },

      syncWithServer: async () => {
        if (!isCustomerLoggedIn()) return;
        try {
          const res = await cartService.getCart();
          if (res?.data?.items) {
            const serverItems: CartItem[] = res.data.items.map(mapServerItemToCartItem);
            set((state) => {
              const validIds = new Set(serverItems.map((i) => i.id));
              const retainedSelected = state.selectedItemIds.filter((id) => validIds.has(id));
              return {
                items: serverItems,
                selectedItemIds: retainedSelected,
              };
            });
          }
        } catch {
          // Keep local cart if sync fails
        }
      },

      setSelectedItems: (ids: string[]) => {
        set({ selectedItemIds: ids });
      },

      toggleSelectItem: (id: string) => {
        set((state) => ({
          selectedItemIds: state.selectedItemIds.includes(id)
            ? state.selectedItemIds.filter((itemId) => itemId !== id)
            : [...state.selectedItemIds, id],
        }));
      },

      selectAllItems: () => {
        set((state) => ({
          selectedItemIds: state.items.map((item) => item.id),
        }));
      },

      unselectAllItems: () => {
        set({ selectedItemIds: [] });
      },

      getSelectedItems: () => {
        const { items, selectedItemIds } = get();
        return items.filter((item) => selectedItemIds.includes(item.id));
      },

      getSelectedSubtotal: () => {
        const { items, selectedItemIds } = get();
        return items
          .filter((item) => selectedItemIds.includes(item.id))
          .reduce((total, item) => total + item.price * item.quantity, 0);
      },

      removeSelectedItems: () => {
        const { items, selectedItemIds } = get();
        const itemsToRemove = items.filter((item) => selectedItemIds.includes(item.id));

        set((state) => ({
          items: state.items.filter((item) => !state.selectedItemIds.includes(item.id)),
          selectedItemIds: [],
          appliedVoucher: null,
        }));

        if (isCustomerLoggedIn()) {
          for (const item of itemsToRemove) {
            if (item.variantId) {
              cartService.removeItem(item.variantId).catch(() => {});
            }
          }
        }
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
        selectedItemIds: state.selectedItemIds,
        appliedVoucher: state.appliedVoucher,
      }),
    },
  ),
);
