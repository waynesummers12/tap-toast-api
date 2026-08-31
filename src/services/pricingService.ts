

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

export type NormalBookingMode = "full" | "rental"
export type NormalPricingTier = "essentials" | "signature" | "premium" | "custom"

export type NormalPricingInput = {
  bookingMode: NormalBookingMode
  pricingTier: NormalPricingTier
  hours: number
  bartenders: number
  guests: number
  rentalDeliverySelected: boolean
  rentalIceCoolerSelected: boolean
  setupHourSelected: boolean
  cocktailTapQuantity: number
}

export type NormalPricingResult = NormalPricingInput & {
  pricingVersion: 1
  basePrice: 600
  bartenderRate: 60
  tierSurcharge: number
  addOnsTotal: number
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
const BARTENDER_PAY_RATE = 25

const MOUNTAIN_VIEW_PACKAGES = {
  classic: { name: "Classic", price: 1195 },
  signature: { name: "Signature", price: 1495 }
} as const

const NORMAL_TIER_SURCHARGES: Record<NormalPricingTier, number> = {
  essentials: 0,
  signature: 150,
  premium: 300,
  custom: 0,
}

export function calculateNormalBookingPricing(
  input: NormalPricingInput
): NormalPricingResult | null {
  const validMode = input.bookingMode === "full" || input.bookingMode === "rental"
  const validTier = Object.prototype.hasOwnProperty.call(NORMAL_TIER_SURCHARGES, input.pricingTier)
  const validHours = Number.isInteger(input.hours) && input.hours >= 1 && input.hours <= 10
  const validBartenders = Number.isInteger(input.bartenders) && input.bartenders >= 0 && input.bartenders <= 5
  const validGuests = Number.isInteger(input.guests) && input.guests >= 1 && input.guests <= 300
  const validTapQuantity = Number.isInteger(input.cocktailTapQuantity) && input.cocktailTapQuantity >= 0 && input.cocktailTapQuantity <= 20
  const validBooleans = [
    input.rentalDeliverySelected,
    input.rentalIceCoolerSelected,
    input.setupHourSelected,
  ].every((value) => typeof value === "boolean")
  const validModeSelections = input.bookingMode === "rental"
    ? input.pricingTier === "custom" && input.bartenders === 0
    : input.bartenders >= 1 &&
      !input.rentalDeliverySelected &&
      !input.rentalIceCoolerSelected &&
      !(input.pricingTier === "premium" && input.setupHourSelected)
  const validTierStructure = input.bookingMode === "rental" ||
    input.pricingTier === "custom" ||
    (input.pricingTier === "essentials" && input.hours === 3 && input.bartenders >= 1) ||
    (input.pricingTier === "signature" && input.hours === 4 && input.bartenders >= 2) ||
    (input.pricingTier === "premium" && input.hours === 5 && input.bartenders >= 3)

  if (!validMode || !validTier || !validHours || !validBartenders || !validGuests ||
      !validTapQuantity || !validBooleans || !validModeSelections || !validTierStructure) {
    return null
  }

  const basePrice = 600
  const bartenderRate = 60
  const tierSurcharge = input.bookingMode === "full"
    ? NORMAL_TIER_SURCHARGES[input.pricingTier]
    : 0
  const staffingTotal = input.bookingMode === "full"
    ? input.bartenders * input.hours * bartenderRate
    : 0
  const addOnsTotal =
    (input.rentalDeliverySelected ? 150 : 0) +
    (input.rentalIceCoolerSelected ? 100 : 0) +
    (input.setupHourSelected ? 50 : 0) +
    input.cocktailTapQuantity * 125
  const totalPrice = basePrice + staffingTotal + tierSurcharge + addOnsTotal
  const depositAmount = totalPrice * 0.5

  return {
    ...input,
    pricingVersion: 1,
    basePrice,
    bartenderRate,
    tierSurcharge,
    addOnsTotal,
    totalPrice,
    depositAmount,
    balanceDue: totalPrice - depositAmount,
  }
}

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
  const canonicalPricing = calculateNormalBookingPricing({
    bookingMode: "full",
    pricingTier: "custom",
    hours,
    bartenders,
    guests: 1,
    rentalDeliverySelected: false,
    rentalIceCoolerSelected: false,
    setupHourSelected: false,
    cocktailTapQuantity: 0,
  })

  if (!canonicalPricing) {
    throw new Error("Invalid normal booking pricing input")
  }

  const bartenderCostTotal = hours * bartenders * canonicalPricing.bartenderRate
  const bartenderPayoutTotal = hours * bartenders * BARTENDER_PAY_RATE
  const businessMarginPerHour = canonicalPricing.bartenderRate - BARTENDER_PAY_RATE
  const businessMarginTotal = hours * bartenders * businessMarginPerHour

  return {
    basePrice: BASE_EVENT_PRICE,
    bartenderRateCharged: canonicalPricing.bartenderRate,
    bartenderPayRate: BARTENDER_PAY_RATE,
    businessMarginPerHour,
    bartenderCostTotal,
    bartenderPayoutTotal,
    businessMarginTotal,
    totalPrice: canonicalPricing.totalPrice,
    depositAmount: canonicalPricing.depositAmount,
    balanceDue: canonicalPricing.balanceDue
  }
}