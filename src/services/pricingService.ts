

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
  venue: "mountain-view"
  packageKey: "classic" | "signature"
  packageName: "Classic" | "Signature"
  serviceHours: 5
  packagePrice: number
  staffingFee: number
  bartendersNeeded: number
  totalPrice: number
  depositAmount: number
  balanceDue: number
}

const BASE_EVENT_PRICE = 600
const BARTENDER_RATE_CHARGED = 40
const BARTENDER_PAY_RATE = 25

const MOUNTAIN_VIEW_PACKAGES = {
  classic: { name: "Classic", price: 1195 },
  signature: { name: "Signature", price: 1495 }
} as const

export function calculateMountainViewPricing(
  packageKey: string,
  guests: number
): MountainViewPricingResult | null {
  if (packageKey !== "classic" && packageKey !== "signature") return null

  const selectedPackage = MOUNTAIN_VIEW_PACKAGES[packageKey]

  const staffingFee = guests >= 101 ? 250 : 0
  const bartendersNeeded = guests >= 101 ? 2 : 1
  const totalPrice = selectedPackage.price + staffingFee
  const depositAmount = totalPrice * 0.5
  const balanceDue = totalPrice - depositAmount

  return {
    venue: "mountain-view",
    packageKey,
    packageName: selectedPackage.name,
    serviceHours: 5,
    packagePrice: selectedPackage.price,
    staffingFee,
    bartendersNeeded,
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