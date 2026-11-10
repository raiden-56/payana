/**
 * Turns a contract route builder into a Nest route pattern.
 *   r(ApiRoutes.bookings.one(':bookingId'))  ->  "/bookings/:bookingId"
 * (the builders URL-encode their arguments, so the ":" has to be restored).
 */
export const r = (path: string): string => decodeURIComponent(path);
