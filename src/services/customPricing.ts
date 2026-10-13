type ExistingPrice = {
  total_price: number | string
  custom_total_price?: number | string | null
  deposit_amount: number | string
  balance_due: number | string
  deposit_paid: boolean | null
  balance_paid: boolean | null
}

export class PriceValidationError extends Error {}

function cents(value: unknown): number {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") throw new PriceValidationError("The event's payment amounts need review before changing its price.")
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0 || n > 1000000) throw new PriceValidationError("The event's payment amounts need review before changing its price.")
  return Math.round(n * 100)
}

export function customPricing(event: ExistingPrice, newTotal: number) {
  const total = cents(newTotal)
  const previousTotal = cents(event.custom_total_price ?? event.total_price)
  const previousDeposit = cents(event.deposit_amount)
  const previousBalance = cents(event.balance_due)
  const paid = event.balance_paid ? previousTotal : event.deposit_paid ? previousTotal - previousBalance : 0
  if (paid < 0 || (event.deposit_paid && paid < previousDeposit)) {
    throw new PriceValidationError("The event's payment amounts need review before changing its price.")
  }
  if (total < paid) throw new PriceValidationError(`The new total cannot be less than the $${(paid / 100).toFixed(2)} already paid. Review any refund separately.`)

  // An unpaid deposit can be recalculated. A received deposit is historical money.
  const deposit = event.deposit_paid || event.balance_paid ? previousDeposit : Math.round(total / 2)
  return {
    custom_total_price: total / 100,
    total_price: total / 100,
    deposit_amount: deposit / 100,
    balance_due: (event.deposit_paid || event.balance_paid ? total - paid : total - deposit) / 100,
    balance_paid: (event.deposit_paid || event.balance_paid) ? total === paid : false,
  }
}
