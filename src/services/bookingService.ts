

import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
)

interface BookingInput {
  name: string
  email: string
  phone?: string
  event_date: string
  location: string
  guest_count: number
  hours: number
  bartenders: number
}

export const calculatePricing = (hours: number, bartenders: number) => {
  const basePrice = 600
  const bartenderRate = 40

  const bartenderCost = hours * bartenders * bartenderRate

  const totalPrice = basePrice + bartenderCost

  const deposit = Math.round(totalPrice * 0.5)

  const balanceDue = totalPrice - deposit

  return {
    basePrice,
    bartenderCost,
    totalPrice,
    deposit,
    balanceDue
  }
}

export const createBooking = async (input: BookingInput) => {
  const pricing = calculatePricing(input.hours, input.bartenders)

  try {
    // Create or fetch customer
    let { data: customer } = await supabase
      .from("customers")
      .select("*")
      .eq("email", input.email)
      .single()

    if (!customer) {
      const { data: newCustomer, error } = await supabase
        .from("customers")
        .insert({
          name: input.name,
          email: input.email,
          phone: input.phone
        })
        .select()
        .single()

      if (error) throw error

      customer = newCustomer
    }

    const { data: event, error } = await supabase
      .from("events")
      .insert({
        customer_id: customer.id,
        event_date: input.event_date,
        location: input.location,
        guest_count: input.guest_count,
        hours: input.hours,
        bartenders: input.bartenders,
        total_price: pricing.totalPrice,
        deposit_amount: pricing.deposit,
        balance_due: pricing.balanceDue,
        deposit_paid: false
      })
      .select()
      .single()

    if (error) throw error

    return {
      success: true,
      event,
      pricing
    }
  } catch (err) {
    console.error(err)

    return {
      success: false,
      error: "Failed to create booking"
    }
  }
}