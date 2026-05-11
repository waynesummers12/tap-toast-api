import Stripe from "stripe"
import { createClient } from "@supabase/supabase-js"
import * as emailService from "./emailService"

const sendEmail =
  (emailService as any).sendEmail ??
  (emailService as any).default

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2026-02-25.clover",
})

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
)

const REMINDER_WINDOWS = [10, 3]

export const runPaymentReminders = async () => {
  try {
    const today = new Date()

    for (const daysBefore of REMINDER_WINDOWS) {
      const reminderDate = new Date()
      reminderDate.setDate(today.getDate() + daysBefore)

      const start = new Date(reminderDate.setHours(0, 0, 0, 0)).toISOString()
      const end = new Date(reminderDate.setHours(23, 59, 59, 999)).toISOString()

      const { data: events, error } = await supabase
        .from("events")
        .select("*, customers(name,email)")
        .eq("event_status", "confirmed")
        .gte("event_date", start)
        .lte("event_date", end)
        .gt("balance_due", 0)

      if (error) throw error

      if (!events || events.length === 0) {
        console.log(`No reminder events found for ${daysBefore}-day window`)
        continue
      }

      for (const event of events) {
        const customer = event.customers
        if (!customer?.email) continue

        const balance = event.balance_due
        if (!balance || balance <= 0) continue

        // -----------------------------
        // Stripe checkout for balance
        // -----------------------------
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
                unit_amount: Math.round(balance * 100),
              },
              quantity: 1,
            },
          ],
          metadata: {
            event_id: event.id,
            type: "balance",
          },
          success_url: `${process.env.FRONTEND_URL}/success?event_id=${event.id}`,
          cancel_url: `${process.env.FRONTEND_URL}/dashboard`,
        })

        const upsellLink = `${process.env.FRONTEND_URL}/upgrade?eventId=${event.id}`

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

        await sendEmail({
          to: customer.email,
          subject:
            daysBefore === 3
              ? `Final Reminder — Your Event Is Almost Here (${formattedDate})`
              : `Your Event Is Coming Up — Balance Due (${formattedDate})`,
          html,
        })

        console.log(`Reminder sent (${daysBefore} days) to ${customer.email}`)

        // Only mark as sent on final (3-day) reminder
        if (daysBefore === 3) {
          await supabase
            .from("events")
            .update({ balance_reminder_sent: true })
            .eq("id", event.id)
        }
      }
    }

    // -----------------------------
    // Auto-complete past events
    // -----------------------------
    const now = new Date().toISOString()

    const { data: pastEvents, error: pastEventsError } = await supabase
      .from("events")
      .select("id")
      .eq("event_status", "confirmed")
      .lt("event_date", now)

    if (pastEventsError) {
      console.error("Failed fetching past events:", pastEventsError)
    } else if (pastEvents && pastEvents.length > 0) {
      for (const pastEvent of pastEvents) {
        await supabase
          .from("events")
          .update({ event_status: "completed" })
          .eq("id", pastEvent.id)

        console.log(`Event ${pastEvent.id} marked completed`)
      }
    }
  } catch (err) {
    console.error("Reminder service error:", err)
  }
}