

import Stripe from "stripe"
import { createClient } from "@supabase/supabase-js"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string)

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
)

export const createDepositCheckout = async (eventId: string) => {
  const { data: event, error } = await supabase
    .from("events")
    .select("*, customers(name,email)")
    .eq("id", eventId)
    .single()

  if (error || !event) {
    throw new Error("Event not found")
  }

  const amountCents = Math.round(Number(event.deposit_amount) * 100)
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error("Invalid deposit amount")
  }

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "payment",
    customer_email: event.customers?.email,
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `Tap & Toast Deposit — ${event.customers?.name}`
          },
          unit_amount: amountCents
        },
        quantity: 1
      }
    ],
    success_url: `${process.env.FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.FRONTEND_URL}/book`,
    metadata: {
      event_id: event.id,
      type: "deposit",
      expected_amount_cents: String(amountCents)
    }
  })

  return session.url
}

export const createBalanceCheckout = async (eventId: string) => {
  const { data: event, error } = await supabase
    .from("events")
    .select("*, customers(name,email)")
    .eq("id", eventId)
    .single()

  if (error || !event) {
    throw new Error("Event not found")
  }

  const amountCents = Math.round(Number(event.balance_due) * 100)
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error("Invalid balance amount")
  }

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "payment",
    customer_email: event.customers?.email,
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `Tap & Toast Final Balance — ${event.customers?.name}`
          },
          unit_amount: amountCents
        },
        quantity: 1
      }
    ],
    success_url: `${process.env.FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.FRONTEND_URL}/dashboard`,
    metadata: {
      event_id: event.id,
      type: "balance",
      expected_amount_cents: String(amountCents)
    }
  })

  return session.url
}