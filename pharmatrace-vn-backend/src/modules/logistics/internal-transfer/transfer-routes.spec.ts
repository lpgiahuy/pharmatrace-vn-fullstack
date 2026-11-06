import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { InternalTransferService } from './internal-transfer.service';
import { InternalTransferController } from './internal-transfer.controller';

describe('Logistics transfer routes', () => {
  let controller: InternalTransferController;
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
    controller = module.get<InternalTransferController>(InternalTransferController);
  });

  it('delegates transfer listing to the transfer service', async () => {
    const res = await controller.transfers(undefined as never, 7, undefined);
    expect(res).toEqual({ success: true, data: [{ id: 42 }] });
    expect(transfers.adminGetInternalTransfers).toHaveBeenCalledWith(7, undefined, undefined);
  });

  it('routes transfer detail and actions to the transfer service', async () => {
    const detail = await controller.transfer(42, undefined as never);
    expect(detail).toEqual({ success: true, data: { id: 42 } });
    expect(transfers.adminGetInternalTransfer).toHaveBeenCalledWith(42, undefined);

    await controller.dispatch(42, undefined as never, {} as never);
    expect(transfers.adminDispatchInternalTransfer).toHaveBeenCalledWith(42, {}, undefined);

    await controller.receive(42, undefined as never);
    expect(transfers.adminReceiveInternalTransfer).toHaveBeenCalledWith(42, undefined);

    await controller.rejectDamaged(42, undefined as never);
    expect(transfers.adminRejectDamagedInternalTransfer).toHaveBeenCalledWith(42, undefined);

    await controller.cancelTransfer(42, undefined as never);
    expect(transfers.cancelTransfer).toHaveBeenCalledWith(42, undefined);
  });
});
