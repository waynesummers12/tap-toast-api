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
    throw error
  }
}

type PaymentRecord = {
  id: string
  status: string
  customer_email_sent_at: string | null
  internal_notification_sent_at: string | null
}

async function getOrCreatePayment(input: {
  eventId: string
  amount: number
  paymentType: string
  stripeSessionId: string
}): Promise<{ payment: PaymentRecord; inserted: boolean }> {
  const paymentFields = "id, status, customer_email_sent_at, internal_notification_sent_at"
  const { data: existingPayment, error: lookupError } = await supabase
    .from("payments")
    .select(paymentFields)
    .eq("stripe_session_id", input.stripeSessionId)
    .maybeSingle()

  if (lookupError) throw lookupError
  if (existingPayment) {
    return { payment: existingPayment, inserted: false }
  }

  const { data: insertedPayment, error: insertError } = await supabase
    .from("payments")
    .insert({
      event_id: input.eventId,
      amount: input.amount,
      type: input.paymentType,
      status: "received",
      stripe_session_id: input.stripeSessionId,
    })
    .select(paymentFields)
    .single()

  if (!insertError && insertedPayment) {
    return { payment: insertedPayment, inserted: true }
  }

  if (insertError?.code !== "23505") throw insertError

  const { data: concurrentlyInsertedPayment, error: concurrentLookupError } = await supabase
    .from("payments")
    .select(paymentFields)
    .eq("stripe_session_id", input.stripeSessionId)
    .single()

  if (concurrentLookupError) throw concurrentLookupError
  return {
    payment: concurrentlyInsertedPayment,
    inserted: false,
  }
}

async function markPaymentForReconciliation(paymentId: string) {
  const { error } = await supabase
    .from("payments")
    .update({ status: "reconciliation_required" })
    .eq("id", paymentId)

  if (error) throw error
}

async function markPaymentCompleted(paymentId: string) {
  const { error } = await supabase
    .from("payments")
    .update({ status: "completed" })
    .eq("id", paymentId)

  if (error) throw error
}

async function eventHasStripeSession(eventId: string, stripeSessionId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("events")
    .select("stripe_session_id")
    .eq("id", eventId)
    .single()

  if (error) throw error
  return data?.stripe_session_id === stripeSessionId
}

async function markNotificationSent(
  paymentId: string,
  column: "customer_email_sent_at" | "internal_notification_sent_at"
) {
  const { error } = await supabase
    .from("payments")
    .update({ [column]: new Date().toISOString() })
    .eq("id", paymentId)
    .is(column, null)
    .select("id")
    .single()

  if (error) throw error
}

async function getExpectedAmountCents(
  session: Stripe.Checkout.Session,
  eventId: string,
  paymentType: "deposit" | "balance"
): Promise<number> {
  const metadataAmount = session.metadata?.expected_amount_cents
  if (metadataAmount && /^\d+$/.test(metadataAmount)) {
    const expectedAmountCents = Number(metadataAmount)
    if (Number.isSafeInteger(expectedAmountCents) && expectedAmountCents > 0) {
      return expectedAmountCents
    }
  }

  const persistedSession = await stripe.checkout.sessions.retrieve(session.id, {
    expand: ["line_items"],
  })
  const lineItems = persistedSession.line_items?.data || []
  const lineItemAmount = lineItems.length === 1 && lineItems[0].quantity === 1
    ? lineItems[0].amount_total
    : null

  if (
    persistedSession.metadata?.event_id !== eventId ||
    persistedSession.metadata?.type !== paymentType ||
    persistedSession.amount_total !== session.amount_total ||
    !Number.isSafeInteger(lineItemAmount) ||
    Number(lineItemAmount) <= 0
  ) {
    throw new Error("Invalid Stripe Checkout payment context")
  }

  return Number(lineItemAmount)
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
      console.log("📦 Stripe checkout session received")

      const eventId = session.metadata?.event_id
      const paymentType = session.metadata?.type || "deposit"
      const cid = session.metadata?.cid
      const stripeSessionId = session.id
      const amount = (session.amount_total || 0) / 100

      if (!eventId) {
        console.error("❌ No event_id in metadata")
        return res.json({ received: true })
      }

      if (paymentType === "deposit" || paymentType === "balance") {
        const expectedAmountCents = await getExpectedAmountCents(session, eventId, paymentType)
        if (session.amount_total !== expectedAmountCents) {
          console.error("Stripe payment amount mismatch", {
            eventId,
            paymentType,
            stripeSessionId,
          })
          return res.status(400).json({ error: "Payment amount mismatch" })
        }
      }

      console.log(`💰 Payment received (${paymentType}) for event:`, eventId)

      const paymentResult = await getOrCreatePayment({
        eventId,
        amount,
        paymentType,
        stripeSessionId,
      })
      const { payment } = paymentResult

      console.log(paymentResult.inserted ? "✅ Payment saved" : "♻️ Reusing payment")

      if (payment.status === "reconciliation_required") {
        console.warn("Stripe payment remains pending reconciliation", {
          eventId,
          paymentType,
          stripeSessionId,
        })
        return res.json({ received: true })
      }

      const paymentAlreadyApplied = !paymentResult.inserted && payment.status === "completed"

      // 🔄 UPDATE EVENT (deposit)
      if (paymentType === "deposit" && !paymentAlreadyApplied) {
        const { data: updatedEvent, error: updateError } = await supabase
          .from("events")
          .update({
            deposit_paid: true,
            event_status: "confirmed",
            stripe_session_id: stripeSessionId,
          })
          .eq("id", eventId)
          .or("deposit_paid.is.null,deposit_paid.eq.false")
          .select("id")
          .maybeSingle()

        if (updateError) throw updateError

        if (!updatedEvent && !(await eventHasStripeSession(eventId, stripeSessionId))) {
          await markPaymentForReconciliation(payment.id)
          console.warn("Completed Stripe payment requires reconciliation", {
            eventId,
            paymentType,
            stripeSessionId,
          })
          return res.json({ received: true })
        }

        await markPaymentCompleted(payment.id)
      }

      // 🔄 UPDATE EVENT (balance)
      if (paymentType === "balance" && !paymentAlreadyApplied) {
        const { data: updatedEvent, error: updateError } = await supabase
          .from("events")
          .update({
            balance_paid: true,
            deposit_paid: true,
            balance_due: 0,
            event_status: "confirmed",
            stripe_session_id: stripeSessionId,
          })
          .eq("id", eventId)
          .or("balance_paid.is.null,balance_paid.eq.false")
          .select("id")
          .maybeSingle()

        if (updateError) throw updateError


        if (!updatedEvent && !(await eventHasStripeSession(eventId, stripeSessionId))) {
          await markPaymentForReconciliation(payment.id)
          console.warn("Completed Stripe payment requires reconciliation", {
            eventId,
            paymentType,
            stripeSessionId,
          })
          return res.json({ received: true })
        }

        await markPaymentCompleted(payment.id)
      }

      if (paymentType === "deposit") {
        await markQuoteConverted(cid)
      }

      if (paymentType === "deposit" || paymentType === "balance") {
        const { data: eventData, error: eventError } = await supabase
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

        if (eventError) throw eventError

        if (paymentResult.inserted && paymentType === "deposit") {
          await createCalendarEvent(eventData)
        }

        const notificationErrors: unknown[] = []

        if (!payment.internal_notification_sent_at) {
          try {
            await sendInternalNotification(
              eventData,
              `stripe-${stripeSessionId}-${paymentType}-internal`
            )
            await markNotificationSent(payment.id, "internal_notification_sent_at")
          } catch (error) {
            notificationErrors.push(error)
          }
        }

        if (!payment.customer_email_sent_at) {
          try {
            await sendPaymentReceivedEmail(
              { ...eventData, payment_amount: amount },
              paymentType,
              `stripe-${stripeSessionId}-${paymentType}-customer`
            )
            await markNotificationSent(payment.id, "customer_email_sent_at")
          } catch (error) {
            notificationErrors.push(error)
          }
        }

        if (notificationErrors.length > 0) {
          throw notificationErrors[0]
        }

        console.log(`✅ ${paymentType} flow completed`)
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