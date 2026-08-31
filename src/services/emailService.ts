import { Resend } from "resend"

const resend = new Resend(process.env.RESEND_API_KEY as string)
const INTERNAL_EMAILS = [
  "jen@coloradotapandtoast.com",
  "waynesummers12@gmail.com"
]

function getRecipient(event: any): string | null {
  return (
    event.customer?.email ||
    event.customer_email ||
    event.email ||
    event.metadata?.customer_email ||
    null
  )
}

const UPGRADE_LABELS: Record<string, string> = {
  garnishes: "Premium Garnishes",
  cocktails: "Signature Cocktails",
  setupHour: "Extra Setup Hour",
  extraBartender: "Additional Bartender",
  customMenu: "Custom Drink Menu"
}

const UPGRADE_PRICES: Record<string, number> = {
  garnishes: 75,
  cocktails: 100,
  setupHour: 50,
  extraBartender: 40, // per hour (display only)
  customMenu: 100
}

function formatUpgradesWithPricing(upgrades: any): string {
  try {
    const parsed = Array.isArray(upgrades)
      ? upgrades
      : JSON.parse(upgrades || "[]")

    return parsed
      .map((key: string) => {
        const label = UPGRADE_LABELS[key] || key
        const price = UPGRADE_PRICES[key]
        return price ? `${label} (+$${price})` : label
      })
      .join(", ")
  } catch {
    return ""
  }
}

function calculateUpgradesTotal(upgrades: any): number {
  try {
    const parsed = Array.isArray(upgrades)
      ? upgrades
      : JSON.parse(upgrades || "[]")

    return parsed.reduce((sum: number, key: string) => sum + (UPGRADE_PRICES[key] || 0), 0)
  } catch {
    return 0
  }
}

function formatUpgrades(upgrades: any): string {
  try {
    const parsed = Array.isArray(upgrades)
      ? upgrades
      : JSON.parse(upgrades || "[]")

    return parsed
      .map((key: string) => UPGRADE_LABELS[key] || key)
      .join(", ")
  } catch {
    return ""
  }
}

function formatTime(time: string) {
  if (!time) return "6:00 PM"

  const [hourStr, minute = "00"] = String(time).split(":")
  let hour = parseInt(hourStr, 10)

  if (isNaN(hour)) return "6:00 PM"

  const ampm = hour >= 12 ? "PM" : "AM"
  hour = hour % 12 || 12

  return `${hour}:${minute} ${ampm}`
}

function formatCurrency(amount: unknown): string {
  const value = Number(amount)
  return Number.isFinite(value) ? value.toFixed(2) : "0.00"
}

function getMountainViewPackageName(event: any): "Classic" | "Signature" | null {
  if (event.venue !== "mountain-view") return null
  if (event.package_key === "classic" && event.package_name === "Classic") return "Classic"
  if (event.package_key === "signature" && event.package_name === "Signature") return "Signature"
  return null
}

export async function sendBookingConfirmation(event: any) {
  try {
    console.log("📨 Sending booking confirmation for event:", event.id)
    const recipient = getRecipient(event)
    if (!recipient) {
      console.error("❌ No email found for event:", event)
      return
    }
    await resend.emails.send({
      from: "Tap & Toast <jen@coloradotapandtoast.com>",
      to: recipient,
      bcc: INTERNAL_EMAILS,
      subject: "🎉 Your Tap & Toast Event is Confirmed",
      html: `
      <div style="font-family: Arial, sans-serif; background-color: #000000; padding: 30px; color: #ffffff;">

        <div style="max-width: 600px; margin: 0 auto; background: #111111; border-radius: 10px; overflow: hidden; border: 1px solid #222;">

          <div style="background: linear-gradient(to right, #facc15, #eab308); padding: 20px; text-align: center;">
            <h1 style="margin: 0; font-size: 24px; color: #000;">Tap & Toast</h1>
            <p style="margin: 0; font-size: 14px; color: #000;">Mobile Bar Experience</p>
          </div>

          <div style="padding: 25px;">

            <h2 style="margin-top: 0;">🎉 Your Event is Confirmed</h2>

            <p>Hi <strong>${event.customer?.name || event.customer_name || event.name || event.metadata?.customer_name || "there"}</strong>,</p>

            <p>
              Your deposit has been successfully received and your event is officially booked.
              We’re excited to be part of your special day.
            </p>

            <div style="margin: 20px 0; padding: 15px; background: #1a1a1a; border-radius: 8px;">
              <h3 style="margin-top: 0; color: #facc15;">Event Details</h3>
              <p style="margin: 5px 0;"><strong>Date:</strong> ${event.event_date}</p>
              <p style="margin: 5px 0;"><strong>Location:</strong> ${event.location}</p>
              <p style="margin: 5px 0;"><strong>Start Time:</strong> ${formatTime(event.start_time)}</p>
              <p style="margin: 5px 0;"><strong>Duration:</strong> ${event.hours} hours</p>
              <p style="margin: 5px 0;"><strong>Bartenders:</strong> ${event.bartenders}</p>
              ${event.upgrades && event.upgrades.length ? `
                <p style="margin: 5px 0;"><strong>Upgrades:</strong> ${formatUpgradesWithPricing(event.upgrades)}</p>
                <p style="margin: 5px 0;"><strong>Upgrades Total:</strong> $${calculateUpgradesTotal(event.upgrades)}</p>
              ` : ''}
            </div>

            <div style="margin: 20px 0; padding: 15px; background: #1a1a1a; border-radius: 8px;">
              <h3 style="margin-top: 0; color: #facc15;">Pricing Summary</h3>
              <p style="margin: 5px 0;"><strong>Base Event:</strong> $${event.base_price || 600}</p>
              <p style="margin: 5px 0;"><strong>Bartenders:</strong> $${(event.bartenders && event.hours) ? event.bartenders * 40 * event.hours : 0}</p>
              ${event.upgrades && event.upgrades.length ? `
                <p style="margin: 5px 0;"><strong>Upgrades:</strong> $${calculateUpgradesTotal(event.upgrades)}</p>
              ` : ''}
              <p style="margin: 5px 0; font-weight: bold;">
                <strong>Estimated Total:</strong> $${
                  (event.base_price || 600) +
                  ((event.bartenders && event.hours) ? event.bartenders * 40 * event.hours : 0) +
                  calculateUpgradesTotal(event.upgrades)
                }
              </p>
              <p style="margin: 5px 0; color: #22c55e; font-weight: bold;">
                <strong>Deposit Paid:</strong> $${Math.round(((event.base_price || 600) + ((event.bartenders && event.hours) ? event.bartenders * 40 * event.hours : 0) + calculateUpgradesTotal(event.upgrades)) * 0.5)}
              </p>

              <p style="margin: 5px 0; color: #facc15; font-weight: bold;">
                <strong>Remaining Balance:</strong> $${
                  ((event.base_price || 600) +
                  ((event.bartenders && event.hours) ? event.bartenders * 40 * event.hours : 0) +
                  calculateUpgradesTotal(event.upgrades)) -
                  Math.round(((event.base_price || 600) + ((event.bartenders && event.hours) ? event.bartenders * 40 * event.hours : 0) + calculateUpgradesTotal(event.upgrades)) * 0.5)
                }
              </p>

              <p style="margin: 5px 0; font-size: 12px; color: #aaa;">
                Due 10 days prior to your event
              </p>
            </div>

            <p>
              Your remaining balance will be due <strong>10 days prior</strong> to your event.
            </p>

            <div style="margin: 25px 0; padding: 15px; background: #111; border: 1px solid #333; border-radius: 8px;">
              <p style="margin: 0; font-size: 14px; color: #facc15;">
                Want to elevate your experience?
              </p>
              <p style="margin: 5px 0 0 0; font-size: 13px;">
                You can upgrade your package anytime — add bartenders, extend hours, or customize your bar.
              </p>
            </div>

            <div style="text-align: center; margin: 25px 0;">
              <a href="https://www.coloradotapandtoast.com/upgrade?eventId=${event.id || event.event_id}" 
                 style="display: inline-block; background: linear-gradient(to right, #facc15, #eab308); color: #000; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px;">
                Upgrade Your Event Experience
              </a>
            </div>

            <div style="text-align: center; margin: 10px 0 25px 0;">
              <a href="https://calendar.google.com/calendar/render?action=TEMPLATE&text=Tap+%26+Toast+Event&dates=${(() => {
  const startHour = Number(String(event.start_time || "18:00").split(":")[0]) // default 6pm
  const duration = Number(event.hours || 4)

  const start = new Date(`${event.event_date}T${String(startHour).padStart(2, '0')}:00:00`)
  const end = new Date(start.getTime() + duration * 60 * 60 * 1000)

  const format = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'

  return `${format(start)}/${format(end)}`
})()}&details=Tap+%26+Toast+Mobile+Bar+Service&location=${encodeURIComponent(event.location || '')}" 
                 style="display: inline-block; background: #ffffff; color: #000; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 13px; border: 1px solid #ddd;">
                📅 Add to Google Calendar
              </a>
            </div>

            <p style="margin-top: 30px;">Cheers,</p>
            <p style="margin: 0;">Tap & Toast 🍸</p>

          </div>

        </div>

      </div>
      `
    })

    console.log("Confirmation email sent")
  } catch (error) {
    console.error("Email error:", error)
  }
}

export async function sendInternalNotification(event: any, idempotencyKey?: string) {
  try {
    const mountainViewPackageName = getMountainViewPackageName(event)
    const result = await resend.emails.send({
      from: "Tap & Toast Alerts <jen@coloradotapandtoast.com>",
      to: ["jen@coloradotapandtoast.com", "waynesummers12@gmail.com"],
      subject: mountainViewPackageName
        ? `🚨 New Mountain View ${mountainViewPackageName} Booking - ${event.event_date}`
        : `🚨 New Booking - ${event.event_date}`,
      html: `
        <h2>New Booking 🚨</h2>
        <p><strong>Name:</strong> ${event.customer?.name || event.customer_name || event.name || event.metadata?.customer_name || "N/A"}</p>
        <p><strong>Email:</strong> ${event.customer?.email || event.customer_email || event.email || event.metadata?.customer_email || "N/A"}</p>
        <p><strong>Event Date:</strong> ${event.event_date}</p>
        <p><strong>Start Time:</strong> ${formatTime(event.start_time)}</p>
        <p><strong>Location:</strong> ${event.location || "N/A"}</p>
        ${mountainViewPackageName ? `
          <p><strong>Venue:</strong> Mountain View Menagerie</p>
          <p><strong>Package:</strong> ${mountainViewPackageName}</p>
          <p><strong>Guests:</strong> ${event.guest_count}</p>
          <p><strong>Bartenders:</strong> ${event.bartenders_needed}</p>
          <p><strong>Total:</strong> $${formatCurrency(event.total_price)}</p>
          <p><strong>Deposit:</strong> $${formatCurrency(event.deposit_amount)}</p>
          <p><strong>Remaining Balance:</strong> $${formatCurrency(event.balance_due)}</p>
        ` : ""}
        ${event.upgrades && event.upgrades.length ? `
          <p><strong>Upgrades:</strong> ${formatUpgradesWithPricing(event.upgrades)}</p>
          <p><strong>Upgrades Total:</strong> $${calculateUpgradesTotal(event.upgrades)}</p>
        ` : ''}
      `,
    }, { idempotencyKey })

    if (result.error) throw new Error(result.error.message)

    console.log("Internal notification email sent")
  } catch (error) {
    console.error("Internal email error:", error)
    throw error
  }
}
export async function sendBalancePaymentEmail(
  event: any,
  paymentUrl: string,
  idempotencyKey?: string
) {
  try {
    const recipient = getRecipient(event)
    if (!recipient) {
      throw new Error(`No customer email found for event ${event.id}`)
    }
    const result = await resend.emails.send({
      from: "Tap & Toast <jen@coloradotapandtoast.com>",
      to: recipient,
      bcc: INTERNAL_EMAILS,
      subject: "Final Payment Due – Colorado Tap & Toast",
      html: `
      <div style="font-family: Arial, sans-serif; background-color: #000000; padding: 30px; color: #ffffff;">

        <div style="max-width: 600px; margin: 0 auto; background: #111111; border-radius: 10px; overflow: hidden; border: 1px solid #222;">

          <div style="background: linear-gradient(to right, #facc15, #eab308); padding: 20px; text-align: center;">
            <h1 style="margin: 0; font-size: 24px; color: #000;">Tap & Toast</h1>
            <p style="margin: 0; font-size: 14px; color: #000;">Mobile Bar Experience</p>
          </div>

          <div style="padding: 25px;">

            <h2 style="margin-top: 0;">💳 Final Payment Due</h2>

            <p>Hi <strong>${event.customer?.name || "there"}</strong>,</p>

            <p>
              Your event is coming up soon. Please complete your final payment below.
            </p>

            <div style="margin: 20px 0; padding: 15px; background: #1a1a1a; border-radius: 8px;">
              <h3 style="margin-top: 0; color: #facc15;">Event Details</h3>
              <p style="margin: 5px 0;"><strong>Date:</strong> ${event.event_date}</p>
              <p style="margin: 5px 0;"><strong>Location:</strong> ${event.location}</p>
              <p style="margin: 5px 0;"><strong>Start Time:</strong> ${formatTime(event.start_time)}</p>
              <p style="margin: 5px 0;"><strong>Duration:</strong> ${event.hours} hours</p>
            </div>

            <div style="margin: 20px 0; padding: 15px; background: #1a1a1a; border-radius: 8px;">
              <h3 style="margin-top: 0; color: #facc15;">Payment Summary</h3>
              <p style="margin: 5px 0;"><strong>Remaining Balance:</strong> $${event.balance_due}</p>
              <p style="margin: 5px 0; font-size: 12px; color: #aaa;">Remaining balance due 10 days before your event</p>
            </div>

            <div style="text-align: center; margin: 25px 0;">
              <a href="${paymentUrl}" 
                 style="display: inline-block; background: linear-gradient(to right, #facc15, #eab308); color: #000; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 15px;">
                Pay Remaining Balance
              </a>
            </div>

            <p style="margin-top: 30px;">Thank you!</p>
            <p style="margin: 0;">— Colorado Tap & Toast 🍸</p>

          </div>

        </div>

      </div>
      `
    }, idempotencyKey ? { idempotencyKey } : undefined)

    if (result.error) throw new Error(result.error.message)

    console.log("Balance payment email sent")
  } catch (error) {
    console.error("Balance email error:", error)
    throw error
  }
}

export async function sendBalanceReminderEmail(
  event: any,
  paymentUrl: string,
  daysBefore: number,
  idempotencyKey: string,
  html: string
) {
  const recipient = getRecipient(event)
  if (!recipient) {
    throw new Error(`No customer email found for event ${event.id}`)
  }

  const formattedDate = new Date(event.event_date).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })

  if (!paymentUrl) {
    throw new Error(`No balance payment URL provided for event ${event.id}`)
  }

  const result = await resend.emails.send({
    from: "Tap & Toast <jen@coloradotapandtoast.com>",
    to: recipient,
    bcc: INTERNAL_EMAILS,
    subject: daysBefore === 3
      ? `Final Reminder — Your Event Is Almost Here (${formattedDate})`
      : `Your Event Is Coming Up — Balance Due (${formattedDate})`,
    html,
  }, { idempotencyKey })

  if (result.error) throw new Error(result.error.message)
}

export async function sendPaymentReceivedEmail(
  event: any,
  type: "deposit" | "balance",
  idempotencyKey?: string
) {
  try {
    console.log("📨 Sending payment received email:", type, event.id)
    const mountainViewPackageName = getMountainViewPackageName(event)
    const recipient = getRecipient(event)
    if (!recipient) {
      throw new Error(`No customer email found for event ${event.id}`)
    }
    const result = await resend.emails.send({
      from: "Tap & Toast <jen@coloradotapandtoast.com>",
      to: recipient,
      bcc: INTERNAL_EMAILS,
      subject: type === "deposit"
        ? "🎉 Deposit Received – You're Booked!"
        : "✅ Payment Received – You're All Set!",
      html: `
      <div style="font-family: Arial, sans-serif; background-color: #000000; padding: 30px; color: #ffffff;">

        <div style="max-width: 600px; margin: 0 auto; background: #111111; border-radius: 10px; overflow: hidden; border: 1px solid #222;">

          <div style="background: linear-gradient(to right, #facc15, #eab308); padding: 20px; text-align: center;">
            <h1 style="margin: 0; font-size: 24px; color: #000;">${mountainViewPackageName ? "Mountain View Menagerie" : "Tap & Toast"}</h1>
            <p style="margin: 0; font-size: 14px; color: #000;">${mountainViewPackageName ? "Preferred Bartending Experience" : "Mobile Bar Experience"}</p>
          </div>

          <div style="padding: 25px;">

            <h2 style="margin-top: 0;">
              ${type === "deposit" ? "🎉 Deposit Received" : "✅ Payment Complete"}
            </h2>

            <p>Hi <strong>${event.customer?.name || "there"}</strong>,</p>

            <p>
              ${type === "deposit"
                ? "Your deposit has been received and your event is officially booked."
                : "Your final payment has been received and your event is fully paid."}
            </p>

            <div style="margin: 20px 0; padding: 15px; background: #1a1a1a; border-radius: 8px;">
              <h3 style="margin-top: 0; color: #facc15;">Event Details</h3>
              <p style="margin: 5px 0;"><strong>Date:</strong> ${event.event_date}</p>
              <p style="margin: 5px 0;"><strong>Location:</strong> ${event.location}</p>
              <p style="margin: 5px 0;"><strong>Start Time:</strong> ${formatTime(event.start_time)}</p>
              <p style="margin: 5px 0;"><strong>Duration:</strong> ${event.hours} hours</p>
              ${mountainViewPackageName ? `
                <p style="margin: 5px 0;"><strong>Venue:</strong> Mountain View Menagerie</p>
                <p style="margin: 5px 0;"><strong>Package:</strong> ${mountainViewPackageName}</p>
                <p style="margin: 5px 0;"><strong>Guest Count:</strong> ${event.guest_count}</p>
                <p style="margin: 5px 0;"><strong>Bartenders:</strong> ${event.bartenders_needed}</p>
              ` : ""}
            </div>

            ${type === "deposit" && mountainViewPackageName ? `
            <div style="margin: 20px 0; padding: 15px; background: #1a1a1a; border-radius: 8px;">
              <h3 style="margin-top: 0; color: #facc15;">Payment Summary</h3>
              <p style="margin: 5px 0;"><strong>Total Booking Price:</strong> $${formatCurrency(event.total_price)}</p>
              <p style="margin: 5px 0; color: #22c55e;"><strong>Deposit Paid:</strong> $${formatCurrency(event.payment_amount ?? event.deposit_amount)}</p>
              <p style="margin: 5px 0;"><strong>Remaining Balance:</strong> $${formatCurrency(event.balance_due)}</p>
            </div>
            ` : ""}

            ${type === "balance" ? `
            <div style="margin: 20px 0; padding: 15px; background: #1a1a1a; border-radius: 8px;">
              <h3 style="margin-top: 0; color: #22c55e;">Status</h3>
              <p style="margin: 5px 0; font-weight: bold; color: #22c55e;">
                Your event is fully paid and confirmed ✔
              </p>
            </div>
            ` : ""}

            <p style="margin-top: 25px;">
              We’re excited to be part of your event. If you need anything or want to make changes, just reply to this email.
            </p>

            <p style="margin-top: 30px;">Cheers,</p>
            <p style="margin: 0;">Tap & Toast 🍸</p>

          </div>

        </div>

      </div>
      `
    }, { idempotencyKey })

    if (result.error) throw new Error(result.error.message)

    console.log("Payment confirmation email sent")
  } catch (error) {
    console.error("Payment confirmation email error:", error)
    throw error
  }
}
export async function send15DayReminderEmail(
  event: any,
  paymentUrl?: string,
  idempotencyKey?: string
) {
  try {
    const recipient = getRecipient(event)
    if (!recipient) {
      throw new Error(`No customer email found for event ${event.id}`)
    }
    const result = await resend.emails.send({
      from: "Tap & Toast <jen@coloradotapandtoast.com>",
      to: recipient,
      bcc: INTERNAL_EMAILS,
      subject: "🍸 Your Event is Coming Up – 15 Day Reminder",
      html: `
      <div style="font-family: Arial, sans-serif; background-color: #000000; padding: 30px; color: #ffffff;">

        <div style="max-width: 600px; margin: 0 auto; background: #111111; border-radius: 10px; overflow: hidden; border: 1px solid #222;">

          <div style="background: linear-gradient(to right, #facc15, #eab308); padding: 20px; text-align: center;">
            <h1 style="margin: 0; font-size: 24px; color: #000;">Tap & Toast</h1>
            <p style="margin: 0; font-size: 14px; color: #000;">Mobile Bar Experience</p>
          </div>

          <div style="padding: 25px;">

            <h2 style="margin-top: 0;">⏳ 15-Day Reminder</h2>

            <p>Hi <strong>${event.customer?.name || "there"}</strong>,</p>

            <p>
              Your event is coming up soon! We’re getting everything ready to make it amazing.
            </p>

            <div style="margin: 20px 0; padding: 15px; background: #1a1a1a; border-radius: 8px;">
              <h3 style="margin-top: 0; color: #facc15;">Event Details</h3>
              <p style="margin: 5px 0;"><strong>Date:</strong> ${event.event_date}</p>
              <p style="margin: 5px 0;"><strong>Location:</strong> ${event.location}</p>
              <p style="margin: 5px 0;"><strong>Start Time:</strong> ${formatTime(event.start_time)}</p>
              <p style="margin: 5px 0;"><strong>Duration:</strong> ${event.hours} hours</p>
            </div>

            ${event.balance_due && event.balance_due > 0 ? `
            <div style="margin: 20px 0; padding: 15px; background: #1a1a1a; border-radius: 8px;">
              <h3 style="margin-top: 0; color: #facc15;">Payment Reminder</h3>
              <p style="margin: 5px 0;"><strong>Remaining Balance:</strong> $${event.balance_due}</p>
              <p style="margin: 5px 0; font-size: 12px; color: #aaa;">
                Final payment is due 10 days before your event
              </p>
            </div>

            ${paymentUrl ? `
            <div style="text-align: center; margin: 25px 0;">
              <a href="${paymentUrl}" 
                 style="display: inline-block; background: linear-gradient(to right, #facc15, #eab308); color: #000; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 15px;">
                Pay Remaining Balance
              </a>
            </div>
            ` : ""}
            ` : ""}

            <div style="margin: 25px 0; padding: 15px; background: #111; border: 1px solid #333; border-radius: 8px;">
              <p style="margin: 0; font-size: 14px; color: #facc15;">
                Want to elevate your experience?
              </p>
              <p style="margin: 5px 0 0 0; font-size: 13px;">
                Add bartenders, extend hours, or upgrade your bar setup anytime.
              </p>
            </div>

            <p style="margin-top: 25px;">
              If you need to make any changes or have questions, just reply to this email.
            </p>

            <p style="margin-top: 30px;">Cheers,</p>
            <p style="margin: 0;">Tap & Toast 🍸</p>

          </div>

        </div>

      </div>
      `
    }, idempotencyKey ? { idempotencyKey } : undefined)

    if (result.error) throw new Error(result.error.message)

    console.log("15-day reminder email sent")
  } catch (error) {
    console.error("15-day reminder email error:", error)
    throw error
  }
}
