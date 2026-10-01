export const upgradeOptions = {
  extra_hour: { cents: 10000, label: "Extra Hour of Service" },
  premium_drinks: { cents: 15000, label: "Premium Drink Package Upgrade" },
  extra_bartender: { cents: 20000, label: "Additional Bartender" },
} as const

export function upgradeOption(value: unknown) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(upgradeOptions, value)
    ? upgradeOptions[value as keyof typeof upgradeOptions] : null
}

export function validatePaidUpgrade(session: {
  id: string; payment_status: string; currency: string | null; amount_total: number | null;
  metadata: Record<string, string> | null
}) {
  const eventId = session.metadata?.event_id
  const kind = session.metadata?.upgrade_type
  const option = upgradeOption(kind)
  if (!eventId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId) ||
      !option || session.payment_status !== "paid" || session.currency !== "usd" || session.amount_total !== option.cents) {
    throw new Error("Invalid or unpaid upgrade session")
  }
  return { eventId, kind: kind!, option }
}
