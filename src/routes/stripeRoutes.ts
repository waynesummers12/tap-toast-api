import express from "express"
import Stripe from "stripe"
import { supabase } from "../lib/supabase"
import { sendEmail } from "../lib/email"
import { sendBalancePaymentEmail } from "../services/emailService"

const router = express.Router()

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2026-02-25.clover",
})

const BASE_URL =
  process.env.FRONTEND_URL && process.env.FRONTEND_URL.startsWith("http")
    ? process.env.FRONTEND_URL
    : "https://www.coloradotapandtoast.com"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function getMountainViewMetadata(event: any): Record<string, string> {
  if (event.venue !== "mountain-view") return {}
  if (event.package_key === "classic" && event.package_name !== "Classic") return {}
  if (event.package_key === "signature" && event.package_name !== "Signature") return {}
  if (event.package_key !== "classic" && event.package_key !== "signature") return {}

  return {
    venue: event.venue,
    package_key: event.package_key,
  }
}

function getBookingCancelUrl(event: any, cid?: string): string {
  const params = new URLSearchParams()
  if (cid) params.set("cid", cid)

  const mountainViewMetadata = getMountainViewMetadata(event)
  if (mountainViewMetadata.venue && mountainViewMetadata.package_key) {
    params.set("venue", mountainViewMetadata.venue)
    params.set("package", mountainViewMetadata.package_key)
  }

  const query = params.toString()
  return `${BASE_URL}/book${query ? `?${query}` : ""}`
}

// Helper to fetch event
const getEvent = async (eventId: string) => {
  const { data: event, error } = await supabase
    .from("events")
    .select(`
      *,
      customer:customers (
        id,
        name,
        email,
        phone
      )
    `)
    .eq("id", eventId)
    .single()

  if (error || !event) {
    throw new Error("Event not found")
  }

  return event
}

// CREATE CHECKOUT SESSION (used by dashboard)
router.post("/create-checkout-session", async (req, res) => {
  try {
    const eventId = req.body.eventId || req.body.event_id
    const cid = req.body.cid ? String(req.body.cid) : undefined

    if (!eventId) {
      return res.status(400).json({ error: "Missing eventId" })
    }

    if (cid && !UUID_PATTERN.test(cid)) {
      return res.status(400).json({ error: "Invalid cid" })
    }

    const { type } = req.body

    const event = await getEvent(eventId)

    const isDeposit = type === "deposit"

    let amount = isDeposit
      ? event.deposit_amount
      : event.balance_due

    // 🔥 Fallback if amount missing (prevents $0 Stripe bug)
    if (!amount || amount === 0) {
      const total = Number(event.total_price || 0)
      amount = total * 0.5
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",

      customer_email: event.customer?.email || event.email || undefined,

      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: isDeposit
                ? "Tap & Toast Event Deposit"
                : "Tap & Toast Event Balance",
            },
            unit_amount: Math.round((amount || 0) * 100),
          },
          quantity: 1,
        },
      ],

      success_url: `${BASE_URL}/success?event_id=${encodeURIComponent(eventId)}&payment_type=${isDeposit ? "deposit" : "balance"}`,
      cancel_url: getBookingCancelUrl(event, cid),

      metadata: {
        event_id: eventId,
        type,
        ...(cid ? { cid } : {}),
        ...getMountainViewMetadata(event),
      },
    })

    res.json({
      success: true, // 🔥 REQUIRED
      url: session.url,
    })

  } catch (err) {
    console.error("Stripe session error", err)
    res.status(500).json({ error: "Failed to create session" })
  }
})

// SEND DEPOSIT PAYMENT LINK
router.post("/send-deposit", async (req, res) => {
  try {
    const eventId = req.body.eventId || req.body.event_id

    const event = await getEvent(eventId)

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],

      customer_email: event.customer?.email || undefined,

      metadata: {
        event_id: event.id,
        type: "deposit",
        ...getMountainViewMetadata(event),
      },

      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Tap & Toast Event Deposit",
            },
            unit_amount: Math.round((event.deposit_amount || 0) * 100),
          },
          quantity: 1,
        },
      ],

      success_url: `${BASE_URL}/success?event_id=${encodeURIComponent(event.id)}&payment_type=deposit`,
      cancel_url: `${BASE_URL}/book`,
    })

    // Send email with payment link
    await sendEmail({
      to: event.customer?.email,
      subject: "Complete Your Deposit – Colorado Tap & Toast",
      html: `
        <p>Hi ${event.customer?.name || "there"},</p>

        <p>Please secure your event date by completing your deposit below:</p>

        <p>
          <a href="${session.url as string}" target="_blank">
            Pay Deposit
          </a>
        </p>

        <p>We look forward to serving you!</p>
        <p>— Colorado Tap & Toast</p>
      `,
    })

    res.json({ success: true, url: session.url as string })
  } catch (err) {
    console.error("Deposit link error:", err)
    res.status(500).json({ error: "Failed to send deposit link" })
  }
})

// SEND BALANCE PAYMENT LINK
router.post("/send-balance", async (req, res) => {
  try {
    const eventId = req.body.eventId || req.body.event_id

    const event = await getEvent(eventId)

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],

      customer_email: event.customer?.email || undefined,

      metadata: {
        event_id: event.id,
        type: "balance",
      },

      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Tap & Toast Event Balance",
            },
            unit_amount: Math.round((event.balance_due || 0) * 100),
          },
          quantity: 1,
        },
      ],

      success_url: `${BASE_URL}/success?event_id=${encodeURIComponent(event.id)}&payment_type=balance`,
      cancel_url: `${BASE_URL}/book`,
    })

    // Send styled balance email
    await sendBalancePaymentEmail(event, session.url as string)

    res.json({ success: true, url: session.url as string })
  } catch (err) {
    console.error("Balance link error:", err)
    res.status(500).json({ error: "Failed to send balance link" })
  }
})

export default router