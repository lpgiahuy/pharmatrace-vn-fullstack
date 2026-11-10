import { CartService } from './cart.service';
import { formatProduct } from '../product/product.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('Product detail and cart price consistency', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-10T06:00:00Z'));
  });

  afterEach(() => jest.useRealTimers());

  it.each([
    ['expired Sucralfate sale', '2026-04-22T12:54:24.344Z', '2026-04-22T17:46:37.894Z', 10800, 12000],
    ['future sale', '2026-12-01T00:00:00Z', '2026-12-31T00:00:00Z', 10800, 12000],
    ['sale without dates', null, null, 10800, 12000],
    ['active sale', '2026-11-01T00:00:00Z', '2026-11-30T00:00:00Z', 10800, 10800],
    ['sale at start', '2026-11-10T06:00:00Z', '2026-11-30T00:00:00Z', 10800, 10800],
    ['sale at end', '2026-11-01T00:00:00Z', '2026-11-10T06:00:00Z', 10800, 10800],
    ['regular price', null, null, 12000, 12000],
  ])('%s has the same payable price', async (
    _name, start, end, storedPrice, expectedPrice,
  ) => {
    const variant = {
      id: 1, medicine_id: 1, unit_name: 'Blister Pack', is_base_unit: true,
      price: storedPrice, original_price: storedPrice < 12000 ? 12000 : null,
      discount_percent: storedPrice < 12000 ? 10 : 0,
      sale_start_date: start, sale_end_date: end,
    };
    const medicine = {
      id: 1, medicine_name: 'Sucralfate 1g', status: 'ACTIVE',
      unit_price: 12000, packaging_variants: [variant],
    };
    const product = formatProduct(medicine);
    expect(product.packagingOptions[0].price).toBe(expectedPrice);

    const quantity = 1;
    const tx = {
      customers: { findUnique: jest.fn().mockResolvedValue({ id: 1, status: 'ACTIVE' }) },
      cart_items: { findMany: jest.fn().mockResolvedValue([{
        id: 1, quantity, packaging_variants: { ...variant, medicine },
      }]) },
    };
    const prisma = {
      withActor: jest.fn((_actor, run) => run(tx)),
    } as unknown as PrismaService;
    const cart = await new CartService(prisma).getCart(1);
    expect(cart.items[0].variantId).toBe(product.packagingOptions[0].id);
    expect(cart.items[0].price).toBe(product.packagingOptions[0].price);
    expect(cart.items[0].packagingOptions[0].price).toBe(expectedPrice);
    expect(cart.items[0].originalPrice).toBe(product.packagingOptions[0].originalPrice);
    expect(cart.subtotal).toBe(expectedPrice * quantity);
  });
});
