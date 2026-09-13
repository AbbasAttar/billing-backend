function roundToRetail49or99(val: number): number {
  const rounded = Math.round(val);
  const base = Math.floor(rounded / 100) * 100;
  const rem = rounded % 100;
  if (rem < 25) return Math.max(0, base - 1); // e.g. 99
  if (rem < 75) return base + 49;
  return base + 99;
}

function roundToCleanFloor(val: number): number {
  return Math.round(val / 10) * 10;
}

export function calculateDefaultFramePricing(costPrice: number, customMrp?: number) {
  const cp = Math.max(0, costPrice);

  // 1. Tier determination
  let tier: 'essential' | 'trendy' | 'premium' | 'luxury';
  if (cp <= 490) tier = 'essential';
  else if (cp <= 790) tier = 'trendy';
  else if (cp <= 1490) tier = 'premium';
  else tier = 'luxury';

  // 2. Anchor Brand MRP
  let calculatedBrandMrp: number;
  if (customMrp && customMrp > 0) {
    calculatedBrandMrp = customMrp;
  } else if (cp === 390) calculatedBrandMrp = 1399;
  else if (cp === 430) calculatedBrandMrp = 1549;
  else if (cp === 490) calculatedBrandMrp = 1749;
  else if (cp === 590) calculatedBrandMrp = 2099;
  else if (cp === 690) calculatedBrandMrp = 2449;
  else if (cp === 790) calculatedBrandMrp = 2749;
  else {
    calculatedBrandMrp = roundToRetail49or99(cp * 3.55);
  }

  // Margin Ratio: How much profit headroom does this brand offer?
  const marginRatio = cp > 0 ? calculatedBrandMrp / cp : 3.55;
  const grossHeadroom = Math.max(0, calculatedBrandMrp - cp);

  // 3. Store Price (Our In-Store Tag Rate)
  let calculatedStorePrice: number;
  if (!customMrp) {
    if (cp === 390) calculatedStorePrice = 1199;
    else if (cp === 430) calculatedStorePrice = 1249;
    else if (cp === 490) calculatedStorePrice = 1499;
    else if (cp === 590) calculatedStorePrice = 1699;
    else if (cp === 690) calculatedStorePrice = 2149;
    else if (cp === 790) calculatedStorePrice = 2399;
    else {
      calculatedStorePrice = roundToRetail49or99(cp * 3.0);
    }
  } else {
    // Brand Price is specified: adjust store multiplier according to brand's profit headroom
    if (marginRatio >= 3.2) {
      calculatedStorePrice = roundToRetail49or99(Math.min(cp * 3.0, calculatedBrandMrp * 0.85));
    } else if (marginRatio >= 2.4) {
      calculatedStorePrice = roundToRetail49or99(cp + grossHeadroom * 0.78);
    } else if (marginRatio >= 1.7) {
      calculatedStorePrice = roundToRetail49or99(cp + grossHeadroom * 0.85);
    } else if (marginRatio >= 1.25) {
      calculatedStorePrice = roundToRetail49or99(cp + grossHeadroom * 0.90);
    } else {
      calculatedStorePrice = calculatedBrandMrp;
    }
  }

  calculatedStorePrice = Math.min(calculatedStorePrice, calculatedBrandMrp);
  if (calculatedBrandMrp > cp && calculatedStorePrice <= cp) {
    calculatedStorePrice = calculatedBrandMrp;
  }

  // 4. Floor Price (Walk-away limit)
  let rawFloor: number;
  if (!customMrp) {
    if (cp === 390) rawFloor = 800;
    else if (cp === 430) rawFloor = 1000;
    else if (cp === 490) rawFloor = 1100;
    else if (cp === 590) rawFloor = 1200;
    else if (cp === 690) rawFloor = 1600;
    else if (cp === 790) rawFloor = 1800;
    else {
      rawFloor = cp * 2.15;
    }
  } else {
    if (marginRatio >= 3.2) {
      rawFloor = Math.min(cp * 2.15, calculatedBrandMrp * 0.65);
    } else if (marginRatio >= 2.4) {
      rawFloor = cp + grossHeadroom * 0.45;
    } else if (marginRatio >= 1.7) {
      rawFloor = Math.max(cp * 1.25, cp + grossHeadroom * 0.45);
    } else if (marginRatio >= 1.25) {
      rawFloor = Math.max(cp * 1.15, cp + grossHeadroom * 0.50);
    } else {
      rawFloor = Math.max(cp, calculatedBrandMrp * 0.90);
    }
  }
  
  let floorPrice = roundToCleanFloor(rawFloor);

  if (calculatedBrandMrp > cp) {
    if (floorPrice >= calculatedStorePrice) {
      floorPrice = Math.min(
        roundToCleanFloor(calculatedStorePrice * 0.85),
        roundToCleanFloor(cp + (calculatedStorePrice - cp) * 0.5)
      );
    }
    if (floorPrice >= calculatedBrandMrp) {
      floorPrice = Math.max(Math.floor(calculatedBrandMrp - 50), cp);
    }
    if (cp > 0 && floorPrice < cp) {
      floorPrice = cp;
    }
  }

  return {
    tier,
    storePrice: calculatedStorePrice,
    floorPrice,
    anchorMrp: calculatedBrandMrp,
  };
}
