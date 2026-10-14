/**
 * Cloudflare Email Worker — DinnerBears calendar reply handler
 *
 * Receives inbound email sent to calendar@dinnerbears.com (prod) or
 * calendar-stage@dinnerbears.com (stage) when a member taps Accept/Maybe/Decline
 * on a calendar invite, then forwards the raw message to the correct API.
 *
 * Deploy steps:
 *  1. Enable Email Routing for dinnerbears.com in the Cloudflare dashboard.
 *  2. Create routes:
 *       calendar@dinnerbears.com       → this Worker  (prod)
 *       calendar-stage@dinnerbears.com → this Worker  (stage)
 *  3. Set Worker environment variables (Workers > Settings > Variables & Secrets):
 *       CLOUDFLARE_EMAIL_SECRET  — shared secret, must match API container env
 *       API_URL                  — https://www.dinnerbears.com
 *                                  (www, not the apex: dinnerbears.com has MX
 *                                  records only, so a POST there never resolves
 *                                  and the email still shows as "Handled")
 *       STAGE_API_URL            — https://stage.dinnerbears.com  (optional)
 *  4. Set the same CLOUDFLARE_EMAIL_SECRET in both prod and stage API containers.
 *  5. In stage docker-compose / env, set:
 *       CALENDAR_ORGANIZER_EMAIL=calendar-stage@dinnerbears.com
 *     (so stage .ics invites reply to the stage address, not prod)
 *
 * wrangler.toml:
 *   name = "dinnerbears-calendar-reply"
 *   main = "email-worker.js"
 *   compatibility_date = "2024-01-01"
 *   [vars]
 *   API_URL = "https://www.dinnerbears.com"
 *   STAGE_API_URL = "https://stage.dinnerbears.com"
 */

export default {
  async email(message, env, ctx) {
    const secret = env.CLOUDFLARE_EMAIL_SECRET ?? '';
    if (!secret) {
      console.error('CLOUDFLARE_EMAIL_SECRET is not set — dropping email');
      return;
    }

    // Route to prod or stage based on which address received the email
    const to = (message.to ?? '').toLowerCase();
    let apiUrl;
    if (to.startsWith('calendar-stage@')) {
      apiUrl = env.STAGE_API_URL ?? env.API_URL ?? 'https://www.dinnerbears.com';
    } else {
      apiUrl = env.API_URL ?? 'https://www.dinnerbears.com';
    }

    let raw;
    try {
      raw = await new Response(message.raw).text();
    } catch (err) {
      console.error('Failed to read raw email:', err);
      return;
    }

    let response;
    try {
      response = await fetch(`${apiUrl}/api/v1/calendar/rsvp-reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cloudflare-Secret': secret,
        },
        body: JSON.stringify({ raw }),
      });
    } catch (err) {
      console.error(`Failed to POST to ${apiUrl}/api/v1/calendar/rsvp-reply:`, err);
      return;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '(no body)');
      console.error(`rsvp-reply returned ${response.status}: ${text}`);
    }
  },
};
