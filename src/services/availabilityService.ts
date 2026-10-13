import type { SupabaseClient } from "@supabase/supabase-js"

export const RESERVED_STATUSES = ["confirmed", "imported"]
export const CONFLICT_MESSAGE = "That time is no longer available. Please choose another date or time, or contact Jen."
const HOUR = 3600000
export type Reservation = { event_date: string; start_time: string | null; hours: number | null }
export type Slot = { date: string; start: string; end: string }

// Compare Colorado wall-clock values consistently, independent of server timezone.
export function bookingWindow(date: string, time: string, hours: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time) || !Number.isFinite(hours) || hours <= 0 || hours > 168) return null
  const start = Date.parse(`${date}T${time.length === 5 ? time + ':00' : time}Z`)
  if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== date) return null
  return { start, end: start + hours * HOUR }
}

export function reservedSlot(event: Reservation): Slot {
  const date = event.event_date.slice(0, 10)
  const window = bookingWindow(date, event.start_time || "", Number(event.hours))
  const midnight = Date.parse(`${date}T00:00:00Z`)
  if (!Number.isFinite(midnight)) throw new Error("Invalid reservation date")
  const start = window?.start ?? midnight
  // Missing times must never make an imported reservation disappear.
  const end = window?.end ?? midnight + Math.max(24, Number(event.hours) || 24) * HOUR
  return { date, start: new Date(start).toISOString().slice(0, 19), end: new Date(end).toISOString().slice(0, 19) }
}

export async function reservedSlots(client: SupabaseClient): Promise<Slot[]> {
  const result: Slot[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.from("events").select("id,event_date,start_time,hours")
      .in("event_status", RESERVED_STATUSES).order("id").range(offset, offset + 999)
    if (error) throw error
    for (const row of data || []) result.push(reservedSlot(row))
    if (!data || data.length < 1000) return result
  }
}

export async function hasReservationConflict(client: SupabaseClient, date: string, time: string, hours: number) {
  const window = bookingWindow(date, time, hours)
  if (!window) throw new Error("Invalid booking time")
  const slots = await reservedSlots(client)
  return slots.some(slot => window.start - HOUR < Date.parse(slot.end + "Z") && window.end + HOUR > Date.parse(slot.start + "Z"))
}
