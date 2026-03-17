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

const DAYS_BEFORE_REMINDER = 10

export const runPaymentReminders = async () => {
  try {
    const today = new Date()

    const reminderDate = new Date()
    reminderDate.setDate(today.getDate() + DAYS_BEFORE_REMINDER)

    const start = new Date(reminderDate.setHours(0, 0, 0, 0)).toISOString()
    const end = new Date(reminderDate.setHours(23, 59, 59, 999)).toISOString()

    const { data: events, error } = await supabase
      .from("events")
      .select("*, customers(name,email)")
      .eq("event_status", "confirmed")
      .eq("balance_reminder_sent", false)
      .gte("event_date", start)
      .lte("event_date", end)
      .gt("balance_due", 0)

    if (error) throw error

    if (!events || events.length === 0) {
      console.log("No reminder events found")
      return
    }

    for (const event of events) {
      const customer = event.customers

      if (!customer?.email) continue

      const balance = event.balance_due

      if (!balance || balance <= 0) continue

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
          payment_type: "balance",
        },
        success_url: "http://localhost:3000/success",
        cancel_url: "http://localhost:3000/dashboard",
      })

      const html = `
        <h2>Your Tap & Toast event is coming up!</h2>
        <p>Hi ${customer.name || "there"},</p>
        <p>Your event on <strong>${new Date(event.event_date).toDateString()}</strong> is coming up soon.</p>
        <p>Your remaining balance is:</p>
        <h3>$${balance}</h3>
        <p>Please complete payment here:</p>
        <p><a href="${session.url}">Pay Remaining Balance</a></p>
        <p>Cheers,<br/>Tap & Toast Mobile Bar</p>
      `

      await sendEmail({
        to: customer.email,
        subject: "Tap & Toast Event Balance Due",
        html,
      })

      console.log(`Balance reminder sent to ${customer.email}`)

      // Mark reminder as sent
      const { error: updateError } = await supabase
        .from("events")
        .update({ balance_reminder_sent: true })
        .eq("id", event.id)

      if (updateError) {
        console.error("Failed to update balance_reminder_sent:", updateError)
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
        const { error: completeError } = await supabase
          .from("events")
          .update({ event_status: "completed" })
          .eq("id", pastEvent.id)

        if (completeError) {
          console.error("Failed marking event completed:", completeError)
        } else {
          console.log(`Event ${pastEvent.id} marked completed`)
        }
      }
    }
  } catch (err) {
    console.error("Reminder service error:", err)
  }
}