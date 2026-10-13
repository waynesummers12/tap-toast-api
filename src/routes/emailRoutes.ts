import { randomUUID } from "node:crypto"
import express from "express"
import Stripe from "stripe"
import { supabase } from "../lib/supabase"
import { sendEmail } from "../lib/email"
import { sendBalancePaymentEmail } from "../services/emailService"
import { requireAdmin } from "../middleware/auth"

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!))
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
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

    const requestId = req.body.request_id || randomUUID()
    if (typeof eventId !== "string" || !UUID_PATTERN.test(eventId) ||
        !["deposit_reminder", "balance_reminder"].includes(type) ||
        typeof requestId !== "string" || !UUID_PATTERN.test(requestId)) {
      return res.status(400).json({ error: "Invalid event, reminder type, or request ID" })
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
        deposit_paid,
        event_status,
        status,
        venue,
        package_key,
        package_name,
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

    if (event.event_status === "cancelled" || event.status === "cancelled")
      return res.status(409).json({ error: "This event is cancelled." })
    if (event.balance_paid)
      return res.status(409).json({ error: "This event is already fully paid." })
    if (type === "deposit_reminder" && event.deposit_paid)
      return res.status(409).json({ error: "The deposit is already paid." })
    if (type === "balance_reminder" && !event.deposit_paid && Number(event.deposit_amount) > 0)
      return res.status(409).json({ error: "Collect the deposit before requesting the remaining balance." })
    if (!customer?.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) {
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

    const eventDate = String(event.event_date || "").slice(0, 10)
    const idempotencyKey = `manual-deposit-reminder-${event.id}-${requestId}`

    let subject = ""
    let html = ""

    if (type === "deposit_reminder") {
      const amountCents = Math.round(Number(event.deposit_amount) * 100)
      if (!Number.isSafeInteger(amountCents) || amountCents <= 0)
        return res.status(400).json({ error: "No valid deposit amount is due." })
      const mountainView = event.venue === "mountain-view" &&
        ((event.package_key === "classic" && event.package_name === "Classic") ||
         (event.package_key === "signature" && event.package_name === "Signature"))
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: customer.email,
        line_items: [{ price_data: { currency: "usd", product_data: { name: "Tap & Toast Event Deposit" }, unit_amount: amountCents }, quantity: 1 }],
        metadata: { event_id: event.id, type: "deposit", expected_amount_cents: String(amountCents),
          ...(mountainView ? { venue: "mountain-view", package_key: event.package_key } : {}) },
        success_url: `${BASE_URL}/success?event_id=${encodeURIComponent(event.id)}&payment_type=deposit`,
        cancel_url: mountainView ? `${BASE_URL}/book?venue=mountain-view&package=${encodeURIComponent(event.package_key)}` : `${BASE_URL}/book`,
      }, { idempotencyKey })
      if (!session.url) throw new Error("Stripe did not return a checkout URL")
      const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amountCents / 100)
      subject = "Reminder: Secure Your Event Date"

      html = `
        <p>Hi ${escapeHtml(customer.name)},</p>

        <p>This is a friendly reminder to secure your event date.</p>

        <p><strong>Event:</strong> ${escapeHtml(eventDate)}</p>
        <p><strong>Deposit Due:</strong> ${escapeHtml(amount)}</p>

        <p><a href="${escapeHtml(session.url)}">Pay your deposit — ${escapeHtml(amount)}</a></p>
        <p>Use the secure payment link above to reserve your event date.</p>

        <p>— Colorado Tap & Toast</p>
      `
    } else {
      return res.status(400).json({ error: "Invalid reminder type" })
    }

    await sendEmail({
      to: customer.email,
      subject,
      html,
      idempotencyKey,
    })

    console.log("Reminder email sent", { eventId, type })

    return res.json({ success: true })

  } catch (err) {
    console.error("🔥 REMINDER ERROR:", err)
    return res.status(500).json({ error: "Failed to send reminder" })
  }
})

export default router