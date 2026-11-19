// The server works in Philippine time, so "today", "this month", due dates,
// and overdue days roll over at midnight in Manila, not UTC.
// Vercel reserves the TZ setting, so it is set here, in code, before any date
// is used. Import this module first. Every cooperative is in the Philippines;
// APP_TIME_ZONE can override it if that ever changes.
export const TIME_ZONE = process.env.APP_TIME_ZONE || 'Asia/Manila';
process.env.TZ = TIME_ZONE;
