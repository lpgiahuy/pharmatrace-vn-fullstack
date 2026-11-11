import { Test, TestingModule } from '@nestjs/testing';
import { CartService } from './cart.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('CartService', () => {
  let service: CartService;
  let prisma: any;

  const mockCustomer = {
    id: 1,
    full_name: 'Test Customer',
    status: 'ACTIVE',
  };

  const mockVariant = {
    id: 10,
    medicine_id: 100,
    unit_name: 'Box',
    price: 50000,
    original_price: 60000,
    discount_percent: 16,
    sale_start_date: new Date('2000-01-01T00:00:00Z'),
    sale_end_date: new Date('2100-01-01T00:00:00Z'),
    is_base_unit: true,
    medicine: {
      id: 100,
      medicine_name: 'Panadol Extra',
      slug: 'panadol-extra',
      image_url: 'http://img.com/panadol.jpg',
      status: 'ACTIVE',
      is_prescription: false,
      packaging_variants: [
        {
          id: 10,
          unit_name: 'Box',
          price: 50000,
          original_price: 60000,
          discount_percent: 16,
          is_base_unit: true,
        },
      ],
    },
  };

  const mockCartRecord = {
    id: 5,
    customer_id: 1,
    variant_id: 10,
    quantity: 2,
    created_at: new Date(),
    packaging_variants: mockVariant,
  };

  beforeEach(async () => {
    prisma = {
      customers: {
        findUnique: jest.fn().mockResolvedValue(mockCustomer),
      },
      packaging_variants: {
        findUnique: jest.fn().mockResolvedValue(mockVariant),
        findMany: jest.fn().mockResolvedValue([mockVariant]),
      },
      cart_items: {
        findMany: jest.fn().mockResolvedValue([mockCartRecord]),
        findUnique: jest.fn().mockResolvedValue(mockCartRecord),
        create: jest.fn().mockResolvedValue({ ...mockCartRecord, id: 6 }),
        update: jest.fn().mockResolvedValue(mockCartRecord),
        delete: jest.fn().mockResolvedValue(mockCartRecord),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      withActor: jest.fn((_actor: unknown, operation: (tx: any) => Promise<unknown>) => operation(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<CartService>(CartService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getCart', () => {
    it('should return formatted cart items, subtotal, and total items', async () => {
      const result = await service.getCart(1);
      expect(result.items.length).toBe(1);
      expect(result.items[0].productId).toBe(100);
      expect(result.items[0].price).toBe(50000);
      expect(result.items[0].quantity).toBe(2);
      expect(result.totalItems).toBe(2);
      expect(result.subtotal).toBe(100000);
    });

    it('should throw NotFoundException if customer does not exist', async () => {
      prisma.customers.findUnique.mockResolvedValueOnce(null);
      await expect(service.getCart(999)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if customer is inactive', async () => {
      prisma.customers.findUnique.mockResolvedValueOnce({
        id: 1,
        status: 'BANNED',
      });
      await expect(service.getCart(1)).rejects.toThrow(BadRequestException);
    });
  });

  describe('addToCart', () => {
    it('should increment quantity if item already in cart', async () => {
      prisma.cart_items.findUnique.mockResolvedValueOnce(mockCartRecord);
      await service.addToCart(1, { variantId: 10, quantity: 3 });

      expect(prisma.cart_items.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockCartRecord.id },
          data: { quantity: 5 },
        }),
      );
    });

    it('should create new cart item if not already in cart', async () => {
      prisma.cart_items.findUnique.mockResolvedValueOnce(null);
      await service.addToCart(1, { variantId: 10, quantity: 1 });

      expect(prisma.cart_items.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            customer_id: 1,
            variant_id: 10,
            quantity: 1,
          },
        }),
      );
    });

    it('should throw NotFoundException if variant does not exist', async () => {
      prisma.packaging_variants.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.addToCart(1, { variantId: 999, quantity: 1 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if medicine is not ACTIVE', async () => {
      prisma.packaging_variants.findUnique.mockResolvedValueOnce({
        ...mockVariant,
        medicine: { ...mockVariant.medicine, status: 'INACTIVE' },
      });
      await expect(
        service.addToCart(1, { variantId: 10, quantity: 1 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateQuantity', () => {
    it('should update quantity when quantity > 0', async () => {
      await service.updateQuantity(1, 10, { quantity: 4 });
      expect(prisma.cart_items.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockCartRecord.id },
          data: { quantity: 4 },
        }),
      );
    });

    it('should delete item when quantity is 0', async () => {
      await service.updateQuantity(1, 10, { quantity: 0 });
      expect(prisma.cart_items.delete).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockCartRecord.id },
        }),
      );
    });

    it('should throw NotFoundException when item not in cart', async () => {
      prisma.cart_items.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.updateQuantity(1, 999, { quantity: 2 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeItem', () => {
    it('should delete variant from customer cart', async () => {
      await service.removeItem(1, 10);
      expect(prisma.cart_items.deleteMany).toHaveBeenCalledWith({
        where: {
          customer_id: 1,
          variant_id: 10,
        },
      });
    });
  });

  describe('clearCart', () => {
    it('should delete all cart items for customer', async () => {
      const result = await service.clearCart(1);
      expect(prisma.cart_items.deleteMany).toHaveBeenCalledWith({
        where: { customer_id: 1 },
      });
      expect(result.items).toEqual([]);
      expect(result.totalItems).toBe(0);
      expect(result.subtotal).toBe(0);
    });
  });
});
