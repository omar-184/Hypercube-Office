/**
 * Memory the runner shares with its worker. MuPDF runs synchronously, so a
 * busy worker cannot read a "cancel" message until the job is over; it reads
 * these slots instead, between files and pages.
 *
 * Slots 0..CANCEL_SLOTS-1: request `id` is canceled when slot `id % CANCEL_SLOTS`
 * holds `id`. RUNNING: the run request the worker is on (left set once it is
 * done). WRITING: 1 while the worker writes outputs. REPORTED: how many
 * finished inputs the worker has posted for the RUNNING request.
 */
export const CANCEL_SLOTS = 64
export const RUNNING = CANCEL_SLOTS
export const WRITING = CANCEL_SLOTS + 1
export const REPORTED = CANCEL_SLOTS + 2

export function newControl(): Int32Array<SharedArrayBuffer> {
  return new Int32Array(new SharedArrayBuffer((CANCEL_SLOTS + 3) * 4))
}

export const cancelSlot = (id: number): number => id % CANCEL_SLOTS
