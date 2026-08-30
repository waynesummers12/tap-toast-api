

// Pricing service for Tap & Toast Mobile Bar
// Calculates total event price, deposit, balance, and internal bartender payout

export type PricingInput = {
  hours: number
  bartenders: number
}

export type PricingResult = {
  basePrice: number
  bartenderRateCharged: number
  bartenderPayRate: number
  businessMarginPerHour: number
  bartenderCostTotal: number
  bartenderPayoutTotal: number
  businessMarginTotal: number
  totalPrice: number
  depositAmount: number
  balanceDue: number
}

export type MountainViewPricingResult = {
  packagePrice: number
  staffingFee: number
  totalPrice: number
  depositAmount: number
  balanceDue: number
}

const BASE_EVENT_PRICE = 600
const BARTENDER_RATE_CHARGED = 40
const BARTENDER_PAY_RATE = 25

const MOUNTAIN_VIEW_PACKAGE_PRICES: Record<string, number> = {
  classic: 1195,
  signature: 1495
}

export function calculateMountainViewPricing(
  packageKey: string,
  guests: number
): MountainViewPricingResult | null {
  const packagePrice = MOUNTAIN_VIEW_PACKAGE_PRICES[packageKey]
  if (packagePrice === undefined) return null

  const staffingFee = guests >= 101 ? 250 : 0
  const totalPrice = packagePrice + staffingFee
  const depositAmount = totalPrice * 0.5
  const balanceDue = totalPrice - depositAmount

  return {
    packagePrice,
    staffingFee,
    totalPrice,
    depositAmount,
    balanceDue
  }
}

export function calculateEventPricing(input: PricingInput): PricingResult {
  const { hours, bartenders } = input

  const bartenderCostTotal = hours * bartenders * BARTENDER_RATE_CHARGED
  const bartenderPayoutTotal = hours * bartenders * BARTENDER_PAY_RATE
  const businessMarginPerHour = BARTENDER_RATE_CHARGED - BARTENDER_PAY_RATE
  const businessMarginTotal = hours * bartenders * businessMarginPerHour

  const totalPrice = BASE_EVENT_PRICE + bartenderCostTotal

  const depositAmount = totalPrice * 0.5
  const balanceDue = totalPrice - depositAmount

  return {
    basePrice: BASE_EVENT_PRICE,
    bartenderRateCharged: BARTENDER_RATE_CHARGED,
    bartenderPayRate: BARTENDER_PAY_RATE,
    businessMarginPerHour,
    bartenderCostTotal,
    bartenderPayoutTotal,
    businessMarginTotal,
    totalPrice,
    depositAmount,
    balanceDue
  }
}