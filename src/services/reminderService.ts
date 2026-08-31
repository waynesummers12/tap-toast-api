import Stripe from "stripe"
import { createClient } from "@supabase/supabase-js"
import {
  send15DayReminderEmail,
  sendBalanceReminderEmail,
} from "./emailService"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2026-02-25.clover",
})

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
)

const BASE_URL =
  process.env.FRONTEND_URL && process.env.FRONTEND_URL.startsWith("http")
    ? process.env.FRONTEND_URL
    : "https://www.coloradotapandtoast.com"

const REMINDER_WINDOWS = [15, 10, 3]

export const runPaymentReminders = async (today = new Date()) => {
  const reminderErrors: unknown[] = []

  for (const daysBefore of REMINDER_WINDOWS) {
    const reminderDate = new Date(today)
    reminderDate.setDate(today.getDate() + daysBefore)

    const start = new Date(reminderDate)
    start.setHours(0, 0, 0, 0)
    const end = new Date(reminderDate)
    end.setHours(23, 59, 59, 999)

    let query = supabase
      .from("events")
      .select("*, customer:customers(name,email)")
      .eq("event_status", "confirmed")
      .gte("event_date", start.toISOString())
      .lte("event_date", end.toISOString())
      .gt("balance_due", 0)
      .or("balance_paid.is.null,balance_paid.eq.false")

    if (daysBefore === 3) {
      query = query.or("balance_reminder_sent.is.null,balance_reminder_sent.eq.false")
    }

    const { data: events, error } = await query

    if (error) throw error

    if (!events || events.length === 0) {
      console.log(`No reminder events found for ${daysBefore}-day window`)
      continue
    }

    for (const event of events) {
      const customer = event.customer
      const balance = Number(event.balance_due)

      if (event.balance_paid === true || !Number.isFinite(balance) || balance <= 0) {
        continue
      }

      if (!customer?.email) {
        console.error(`Skipping ${daysBefore}-day reminder for event ${event.id}: customer email missing`)
        continue
      }

      const reminderKey = `balance-reminder-${event.id}-${daysBefore}-${start.toISOString().slice(0, 10)}`
      const amountCents = Math.round(balance * 100)

      if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
        console.error(`Skipping ${daysBefore}-day reminder for event ${event.id}: invalid balance amount`)
        continue
      }

      try {
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          mode: "payment",
          customer_email: customer.email,
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: "Tap & Toast Event Remaining Balance",
                },
                  unit_amount: amountCents,
              },
              quantity: 1,
            },
          ],
          metadata: {
            event_id: event.id,
            type: "balance",
            expected_amount_cents: String(amountCents),
          },
          success_url: `${BASE_URL}/success?event_id=${encodeURIComponent(event.id)}&payment_type=balance`,
          cancel_url: `${BASE_URL}/book`,
        }, { idempotencyKey: reminderKey })

        if (!session.url) {
          throw new Error(`Stripe did not return a Checkout URL for event ${event.id}`)
        }

        const upsellLink = `${BASE_URL}/upgrade?eventId=${encodeURIComponent(event.id)}`

        const formattedDate = new Date(event.event_date).toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })

        // -----------------------------
        // Email HTML
        // -----------------------------
        const html = `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111;">
            <h2>Your Tap & Toast Event Is Coming Up 🍸</h2>

            <p>Hi ${customer.name || "there"},</p>

            <p>Your event is scheduled for:</p>
            <p style="font-size: 18px; font-weight: bold;">
              ${formattedDate}
            </p>

            <p>Your remaining balance is due:</p>
            <p style="font-size: 22px; font-weight: bold;">
              $${balance}
            </p>

            <p>
              <a href="${session.url}" 
                 style="display:inline-block;padding:12px 20px;background:#000;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">
                Pay Remaining Balance
              </a>
            </p>

            ${
              daysBefore === 3
                ? `
            <hr style="margin:20px 0;" />

            <h3>Want to upgrade your event?</h3>

            <p>Popular add-ons:</p>
            <ul>
              <li>✨ Extra service hour</li>
              <li>🍸 Premium bar setup</li>
              <li>🥤 Custom drinks</li>
            </ul>

            <p>
              <a href="${upsellLink}" 
                 style="display:inline-block;padding:10px 16px;background:#d4af37;color:#000;text-decoration:none;border-radius:6px;font-weight:bold;">
                Upgrade Your Event
              </a>
            </p>
            `
                : ""
            }

            <p style="margin-top:20px;">
              Questions? Just reply — we’ve got you covered.
            </p>

            <p>
              — Tap & Toast Mobile Bar
            </p>
          </div>
        `

        if (daysBefore === 15) {
          await send15DayReminderEmail(event, session.url, reminderKey)
        } else {
          await sendBalanceReminderEmail(event, session.url, daysBefore, reminderKey, html)
        }

        console.log(`Reminder sent (${daysBefore} days) for event ${event.id}`)

        // Only mark as sent on final (3-day) reminder
        if (daysBefore === 3) {
          const { error: updateError } = await supabase
            .from("events")
            .update({ balance_reminder_sent: true })
            .eq("id", event.id)

          if (updateError) throw updateError
        }
      } catch (error) {
        console.error(`Reminder failed (${daysBefore} days) for event ${event.id}:`, error)
        reminderErrors.push(error)
      }
    }
  }

  // -----------------------------
  // Auto-complete past events
  // -----------------------------
  const now = today.toISOString()

  const { data: pastEvents, error: pastEventsError } = await supabase
    .from("events")
    .select("id")
    .eq("event_status", "confirmed")
    .lt("event_date", now)

  if (pastEventsError) {
    console.error("Failed fetching past events:", pastEventsError)
    reminderErrors.push(pastEventsError)
  } else if (pastEvents && pastEvents.length > 0) {
    for (const pastEvent of pastEvents) {
      const { error: updateError } = await supabase
        .from("events")
        .update({ event_status: "completed" })
        .eq("id", pastEvent.id)

      if (updateError) {
        console.error(`Failed marking event ${pastEvent.id} completed:`, updateError)
        reminderErrors.push(updateError)
      } else {
        console.log(`Event ${pastEvent.id} marked completed`)
      }
    }
  }

  if (reminderErrors.length > 0) {
    throw new Error(`Reminder service completed with ${reminderErrors.length} failure(s)`)
  }
}