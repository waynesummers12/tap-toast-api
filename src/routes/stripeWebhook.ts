import express from "express"
import Stripe from "stripe"
import { createClient } from "@supabase/supabase-js"
import {
  sendInternalNotification,
  sendPaymentReceivedEmail,
} from "../services/emailService"
import { createCalendarEvent } from "../services/calendarService"

const router = express.Router()

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2026-02-25.clover",
})

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
)

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function markQuoteConverted(cid?: string | null) {
  if (!cid || !UUID_PATTERN.test(cid)) return

  const { error } = await supabase
    .from("quotes")
    .update({
      converted: true,
      converted_at: new Date().toISOString(),
      status: "converted",
    })
    .eq("cid", cid)

  if (error) {
    console.error("❌ Quote conversion update failed")
  }
}

router.post("/", async (req, res) => {
  try {
    // 🔥 Ensure raw buffer
    if (!(req.body instanceof Buffer)) {
      req.body = Buffer.from(req.body)
    }

    const sig = req.headers["stripe-signature"] as string

    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET as string
    )

    // 🔥 Only handle checkout success
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session

      console.log("🔥 Webhook received: checkout.session.completed")
      console.log("📦 STRIPE SESSION:", JSON.stringify(session, null, 2))

      const eventId = session.metadata?.event_id
      const paymentType = session.metadata?.type || "deposit"
      const cid = session.metadata?.cid
      const stripeSessionId = session.id
      const amount = (session.amount_total || 0) / 100

      if (!eventId) {
        console.error("❌ No event_id in metadata")
        return res.json({ received: true })
      }

      console.log(`💰 Payment received (${paymentType}) for event:`, eventId)

      // 🔁 Prevent duplicate processing
      const { data: existingPayment } = await supabase
        .from("payments")
        .select("id")
        .eq("stripe_session_id", stripeSessionId)
        .maybeSingle()

      if (existingPayment) {
        console.log("⚠️ Webhook already processed:", stripeSessionId)
        if (paymentType === "deposit") await markQuoteConverted(cid)
        return res.json({ received: true })
      }

      // ✅ Save payment
      const { error: paymentError } = await supabase
        .from("payments")
        .insert({
          event_id: eventId,
          amount,
          type: paymentType,
          status: "completed",
          stripe_session_id: stripeSessionId,
        })

      if (paymentError) {
        console.error("❌ Payment insert failed:", paymentError)
        const { data: concurrentlyProcessedPayment } = await supabase
          .from("payments")
          .select("id")
          .eq("stripe_session_id", stripeSessionId)
          .maybeSingle()

        if (concurrentlyProcessedPayment) {
          console.log("⚠️ Webhook concurrently processed:", stripeSessionId)
          if (paymentType === "deposit") await markQuoteConverted(cid)
          return res.json({ received: true })
        }

        throw paymentError
      }

      console.log("✅ Payment saved")

      // 🔄 UPDATE EVENT (deposit)
      if (paymentType === "deposit") {
        const { error: updateError } = await supabase
          .from("events")
          .update({
            deposit_paid: true,
            event_status: "confirmed",
            stripe_session_id: stripeSessionId,
          })
          .eq("id", eventId)

        if (updateError) {
          console.error("❌ Event update failed:", updateError)
        }

        await markQuoteConverted(cid)

        const { data: eventData } = await supabase
          .from("events")
          .select(
            `
            *,
            customer:customers (
              id,
              name,
              email,
              phone
            )
          `
          )
          .eq("id", eventId)
          .single()

        if (eventData) {
          try {
            console.log("📧 Sending deposit emails...")
            await sendInternalNotification(eventData)
            await createCalendarEvent(eventData)
            await sendPaymentReceivedEmail(
              { ...eventData, payment_amount: amount },
              "deposit"
            )
            console.log("✅ Deposit flow completed")
          } catch (err) {
            console.error("❌ Post-deposit tasks failed:", err)
          }
        }
      }

      // 🔄 UPDATE EVENT (balance)
      if (paymentType === "balance") {
        const { error: updateError } = await supabase
          .from("events")
          .update({
            balance_paid: true,
            deposit_paid: true,
            balance_due: 0,
            event_status: "confirmed",
          })
          .eq("id", eventId)

        if (updateError) {
          console.error("❌ Balance update failed:", updateError)
        }

        const { data: eventData } = await supabase
          .from("events")
          .select(
            `
            *,
            customer:customers (
              id,
              name,
              email,
              phone
            )
          `
          )
          .eq("id", eventId)
          .single()

        if (eventData) {
          try {
            console.log("📧 Sending balance emails...")
            await sendInternalNotification(eventData)
            await sendPaymentReceivedEmail(
              { ...eventData, payment_amount: amount },
              "balance"
            )
            console.log("✅ Balance flow completed")
          } catch (err) {
            console.error("❌ Post-balance tasks failed:", err)
          }
        }
      }

      // 🚀 Upgrade placeholder
      if (paymentType === "upgrade") {
        console.log("🔥 Upgrade purchased for event:", eventId)
      }
    }

    res.json({ received: true })
  } catch (err: any) {
    console.error("❌ Webhook error:", err.message)
    res.status(400).send(`Webhook Error: ${err.message}`)
  }
})

export default router