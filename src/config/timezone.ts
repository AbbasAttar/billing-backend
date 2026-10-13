/**
 * The shop runs on India time. Cloud Functions run in UTC, so code that groups by day with local
 * Date getters (getDate, setHours(0,0,0,0), …) filed bills made between 00:00 and 05:30 IST under the
 * previous day. Import this module first in every entry point so all local-time maths uses IST.
 * (Code that adds a fixed +05:30 and reads UTC getters is unaffected.)
 */
process.env.TZ = 'Asia/Kolkata';

export {};
