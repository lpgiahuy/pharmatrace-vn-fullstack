import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { InternalTransferService } from './internal-transfer.service';
import { InternalTransferController } from './internal-transfer.controller';

describe('Logistics transfer routes', () => {
  let app: INestApplication;
  let baseUrl: string;
  const transfers = {
    adminGetInternalTransfers: jest.fn().mockResolvedValue([{ id: 42 }]),
    adminGetInternalTransfer: jest.fn().mockResolvedValue({ id: 42 }),
    adminDispatchInternalTransfer: jest.fn().mockResolvedValue({ id: 42 }),
    adminReceiveInternalTransfer: jest.fn().mockResolvedValue({ id: 42 }),
    adminRejectDamagedInternalTransfer: jest.fn().mockResolvedValue({ id: 42 }),
    cancelTransfer: jest.fn().mockResolvedValue({ id: 42 }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [InternalTransferController],
      providers: [
        { provide: InternalTransferService, useValue: transfers },
      ],
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true }).compile();
    app = module.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => { await app.close(); });

  it('lists transfers through the logistics route and removes the old route', async () => {
    const response = await fetch(baseUrl + '/admin/logistics/transfers?orderId=7');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ data: [{ id: 42 }] }));
    expect(transfers.adminGetInternalTransfers).toHaveBeenCalledTimes(1);
    expect(transfers.adminGetInternalTransfers.mock.calls[0][0]).toBe(7);
    expect((await fetch(baseUrl + '/admin/orders/transfers/all')).status).toBe(404);
  });

  it('routes transfer detail and actions to the transfer service', async () => {
    const detail = await fetch(baseUrl + '/admin/logistics/transfers/42');
    expect(detail.status).toBe(200);
    for (const action of ['dispatch', 'receive', 'reject-damaged', 'cancel']) {
      const response = await fetch(baseUrl + `/admin/logistics/transfers/42/${action}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      expect(response.status).toBe(200);
    }
    expect(transfers.adminGetInternalTransfer).toHaveBeenCalledWith(42, undefined);
    expect(transfers.adminDispatchInternalTransfer).toHaveBeenCalledWith(42, undefined, undefined);
    expect(transfers.adminReceiveInternalTransfer).toHaveBeenCalledWith(42, undefined);
    expect(transfers.adminRejectDamagedInternalTransfer).toHaveBeenCalledWith(42, undefined);
    expect(transfers.cancelTransfer).toHaveBeenCalledWith(42, undefined);
  });
});
