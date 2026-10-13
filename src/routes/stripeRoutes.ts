import { SERVICE_LABELS } from "../lib/serviceTypes"
import express from "express"
import Stripe from "stripe"
import { supabase } from "../lib/supabase"
import { sendEmail } from "../lib/email"
import { randomUUID } from "node:crypto"
import { requireAdmin, requireAdminForNonDeposit } from "../middleware/auth"

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

function paymentBlock(event: any, type: "deposit" | "balance"): string | null {
  if (event.event_status === "cancelled" || event.status === "cancelled") return "This event is cancelled. Please contact Jen."
  if (event.balance_paid) return "This event is already fully paid."
  if (type === "deposit" && event.deposit_paid) return "The deposit is already paid."
  if (type === "balance" && !event.deposit_paid && Number(event.deposit_amount) > 0) return "Collect the deposit before requesting the remaining balance."
  return null
}

// Public deposit checkout; balance checkout requires an administrator.
router.post("/create-checkout-session", requireAdminForNonDeposit, async (req, res) => {
  try {
    const eventId = req.body.eventId || req.body.event_id
    const cid = req.body.cid ? String(req.body.cid) : undefined

    if (typeof eventId !== "string" || !UUID_PATTERN.test(eventId)) {
      return res.status(400).json({ error: "Invalid event ID" })
    }

    if (cid && !UUID_PATTERN.test(cid)) {
      return res.status(400).json({ error: "Invalid cid" })
    }

    const { type } = req.body

    if (type !== "deposit" && type !== "balance") {
      return res.status(400).json({ error: "Invalid payment type" })
    }

    const event = await getEvent(eventId)

    const blocked = paymentBlock(event, type)
    if (blocked) return res.status(409).json({ error: blocked })

    const isDeposit = type === "deposit"

    const amount = isDeposit
      ? event.deposit_amount
      : event.balance_due
    const amountCents = Math.round(Number(amount) * 100)

    if (!isDeposit && Number(amount) === 0) {
      return res.status(400).json({ error: "No balance due" })
    }

    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      return res.status(400).json({ error: "Invalid payment amount" })
    }

    const session = await stripe.checkout.sessions.create({
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
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],

      success_url: `${BASE_URL}/success?event_id=${encodeURIComponent(eventId)}&payment_type=${isDeposit ? "deposit" : "balance"}`,
      cancel_url: getBookingCancelUrl(event, cid),

      metadata: {
        event_id: eventId,
        type,
        expected_amount_cents: String(amountCents),
        ...(cid ? { cid } : {}),
        ...getMountainViewMetadata(event),
      },
    })

    if (!session.url) throw new Error("Stripe did not return a checkout URL")
    res.json({
      success: true, // 🔥 REQUIRED
      url: session.url,
    })

  } catch (err) {
    console.error("Stripe session error", err)
    res.status(500).json({ error: "Failed to create session" })
  }
})

const html = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!))
const dollars = (cents: number) => new Intl.NumberFormat("en-US", {style:"currency",currency:"USD"}).format(cents / 100)

// Admin email actions. Creating/sending a request never changes payment status.
for (const action of ["deposit", "balance", "invoice"] as const) {
  router.post(`/send-${action}`, requireAdmin, async (req, res) => {
    try {
      const eventId = req.body.eventId || req.body.event_id
      const requestId = req.body.request_id || randomUUID()
      if (typeof eventId !== "string" || !UUID_PATTERN.test(eventId) || typeof requestId !== "string" || !UUID_PATTERN.test(requestId))
        return res.status(400).json({error:"Invalid event or request ID"})
      const event = await getEvent(eventId)
      const recipient = String(event.customer?.email || event.email || "").trim()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))
        return res.status(400).json({error:"Add a valid customer email before sending a payment request."})
      const type = action === "invoice" ? (event.deposit_paid ? "balance" : "deposit") : action
      const blocked = paymentBlock(event, type)
      if (blocked) return res.status(409).json({error:blocked})
      const amountCents = Math.round(Number(type === "deposit" ? event.deposit_amount : event.balance_due) * 100)
      if (!Number.isSafeInteger(amountCents) || amountCents <= 0)
        return res.status(400).json({error:`No valid ${type} amount is due.`})
      const key = `admin-${action}-${eventId}-${requestId}`
      const session = await stripe.checkout.sessions.create({
        mode:"payment", customer_email:recipient,
        metadata:{event_id:eventId,type,expected_amount_cents:String(amountCents),...getMountainViewMetadata(event)},
        line_items:[{price_data:{currency:"usd",product_data:{name:`Tap & Toast Event ${type === "deposit" ? "Deposit" : "Balance"}`},unit_amount:amountCents},quantity:1}],
        success_url:`${BASE_URL}/success?event_id=${encodeURIComponent(eventId)}&payment_type=${type}`,
        cancel_url:getBookingCancelUrl(event),
      }, {idempotencyKey:key})
      if (!session.url) throw new Error("Stripe did not return a checkout URL")
      const totalCents = Math.round(Number(event.custom_total_price ?? event.total_price) * 100)
      const depositCents = Math.round(Number(event.deposit_amount) * 100)
      const summary = action === "invoice" ? `
        <h2>Event invoice</h2>
        <p>Reference: ${html(eventId)}</p>
        <table cellpadding="8">
          <tr><th align="left">Event date</th><td>${html(String(event.event_date || "").slice(0,10))}</td></tr>
          <tr><th align="left">Location</th><td>${html(event.location)} ${html(event.city)}</td></tr>
          <tr><th align="left">Service</th><td>${html(SERVICE_LABELS[event.service_type] || "Bartending")}</td></tr>
          <tr><th align="left">Service hours</th><td>${html(event.hours)}</td></tr>
          <tr><th align="left">Drinks</th><td>${html(event.drinks_serving || "To be confirmed")}</td></tr>
          <tr><th align="left">Agreed total</th><td>${html(dollars(totalCents))}</td></tr>
          <tr><th align="left">Deposit</th><td>${html(dollars(depositCents))} (${event.deposit_paid ? "paid" : "unpaid"})</td></tr>
          <tr><th align="left">${type === "deposit" ? "Deposit requested now" : "Remaining balance requested"}</th><td>${html(dollars(amountCents))}</td></tr>
        </table>` : `<h2>${type === "deposit" ? "Event deposit" : "Remaining event balance"}</h2><p>Event date: ${html(String(event.event_date || "").slice(0,10))}</p><p>Amount requested: ${html(dollars(amountCents))}</p>`
      await sendEmail({to:recipient,
        subject: action === "invoice" ? "Your Event Invoice – Colorado Tap & Toast" : type === "deposit" ? "Complete Your Deposit – Colorado Tap & Toast" : "Final Payment Due – Colorado Tap & Toast",
        html:`<p>Hi ${html(event.customer?.name || "there")},</p>${summary}<p><a href="${html(session.url)}">Pay ${type === "deposit" ? "deposit" : "balance"} — ${html(dollars(amountCents))}</a></p><p>Questions? Reply to this email to connect with Jen.</p><p>Colorado Tap & Toast</p>`,
        idempotencyKey:key,
      })
      return res.json({success:true,recipient,payment_type:type})
    } catch (error) {
      console.error(`Send ${action} failed`, error)
      return res.status(502).json({error:"The payment email could not be sent. Please retry; payment status has not changed."})
    }
  })
}

export default router
