import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';
import { FITTING_FRAME_TYPES, FittingFrameType, FITTING_LENS_KINDS, FittingLensKind } from './FittingJob.model';

/**
 * Fitting charge per pair, by frame type and lens kind; a single document.
 * A list, not a map: Firestore merge-writes keep map keys, so a cleared cell would come back.
 */
export interface IFittingRateCard extends BaseDoc {
  rates: { frameType: FittingFrameType; lensKind: FittingLensKind; amount: number }[];
  createdAt?: Date;
  updatedAt?: Date;
}

export const FittingRateCard = createFirestoreModel<IFittingRateCard>('fittingratecards');

/** Every frame × lens cell, unset cells as 0. */
export const fullRateList = (rates: IFittingRateCard['rates'] = []) =>
  FITTING_FRAME_TYPES.flatMap((frameType) =>
    FITTING_LENS_KINDS.map((lensKind) => ({
      frameType,
      lensKind,
      amount: rates.find((r) => r.frameType === frameType && r.lensKind === lensKind)?.amount ?? 0,
    }))
  );

export const loadFittingRates = async () => {
  const doc: any = await FittingRateCard.findOne({});
  return { _id: doc?._id as string | undefined, rates: fullRateList(doc?.rates) };
};

/** Rate for one pair of this frame + lens, 0 when not set. */
export const fittingRateFor = (rates: IFittingRateCard['rates'], frameType: FittingFrameType | null | undefined, lensKind: FittingLensKind) =>
  rates.find((r) => r.frameType === (frameType || 'full') && r.lensKind === lensKind)?.amount ?? 0;
