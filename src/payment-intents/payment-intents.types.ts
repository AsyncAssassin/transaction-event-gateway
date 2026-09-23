import { PaymentIntentStatus } from '../database/entities';

export type PaymentIntentResponse = {
  id: string;
  status: PaymentIntentStatus;
  amount: string;
  asset: string;
  destination: string;
  reference: string | null;
  clientRequestId: string | null;
  confirmedTxHash: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreatePaymentIntentResult = {
  httpStatus: 200 | 201;
  replayed: boolean;
  body: PaymentIntentResponse;
};
