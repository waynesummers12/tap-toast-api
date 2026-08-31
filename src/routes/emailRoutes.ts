import express from "express"
import Stripe from "stripe"
import { supabase } from "../lib/supabase"
import { sendEmail } from "../lib/email"
import { sendBalancePaymentEmail } from "../services/emailService"
import { requireAdmin } from "../middleware/auth"

const router = express.Router()
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2026-02-25.clover",
})
const BASE_URL =
  process.env.FRONTEND_URL && process.env.FRONTEND_URL.startsWith("http")
    ? process.env.FRONTEND_URL
    : "https://www.coloradotapandtoast.com"

router.post("/reminder", requireAdmin, async (req, res) => {
  try {
    const { eventId, type } = req.body

    console.log("📩 REMINDER REQUEST:", { eventId, type })

    if (!eventId || !type) {
      return res.status(400).json({ error: "Missing eventId or type" })
    }

    // Get event + customer
    const { data: event, error } = await supabase
      .from("events")
      .select(`
        id,
        event_date,
        location,
        start_time,
        hours,
        deposit_amount,
        balance_due,
        balance_paid,
        customers (
          name,
          email
        )
      `)
      .eq("id", eventId)
      .single()

    if (error || !event) {
      console.error("Reminder event lookup failed", { eventId })
      return res.status(404).json({ error: "Event not found" })
    }

    const customer = Array.isArray(event.customers)
      ? event.customers[0]
      : event.customers

    if (!customer?.email) {
      return res.status(400).json({ error: "Customer email missing" })
    }

    if (type === "balance_reminder") {
      const balance = Number(event.balance_due)

      if (event.balance_paid === true || balance === 0) {
        return res.status(400).json({ error: "No balance due" })
      }

      if (!Number.isFinite(balance) || balance < 0) {
        return res.status(400).json({ error: "Invalid balance amount" })
      }

      const amountCents = Math.round(balance * 100)
      if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
        return res.status(400).json({ error: "Invalid balance amount" })
      }
      const idempotencyKey = `manual-balance-reminder-${event.id}-${amountCents}`

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        customer_email: customer.email,
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: "Tap & Toast Event Balance",
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
      }, { idempotencyKey })

      if (!session.url) {
        throw new Error(`Stripe did not return a Checkout URL for event ${event.id}`)
      }

      await sendBalancePaymentEmail(
        { ...event, customer },
        session.url,
        `manual-balance-reminder-email-${event.id}-${amountCents}`
      )
      return res.json({ success: true })
    }

    const eventDate = new Date(event.event_date).toLocaleDateString()

    let subject = ""
    let html = ""

    if (type === "deposit_reminder") {
      subject = "Reminder: Secure Your Event Date"

      html = `
        <p>Hi ${customer.name},</p>

        <p>This is a friendly reminder to secure your event date.</p>

        <p><strong>Event:</strong> ${eventDate}</p>
        <p><strong>Deposit Due:</strong> $${event.deposit_amount}</p>

        <p>Please complete your deposit at your earliest convenience.</p>

        <p>— Colorado Tap & Toast</p>
      `
    } else {
      return res.status(400).json({ error: "Invalid reminder type" })
    }

    await sendEmail({
      to: customer.email,
      subject,
      html,
    })

    console.log("Reminder email sent", { eventId, type })

    return res.json({ success: true })

  } catch (err) {
    console.error("🔥 REMINDER ERROR:", err)
    return res.status(500).json({ error: "Failed to send reminder" })
  }
})

export default router