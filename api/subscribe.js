// api/subscribe.js — Vercel Serverless Function
// Bot-hardened 2026-08-20: honeypot + time-trap + stricter validation
// Updated 2026-09-25: upsert + separate tag call (same pattern as api/audit.js),
// so NEW and EXISTING contacts both get tagged, and forms can pass one approved tag.
//   - cheat-sheet.html box sends tag "cheatsheet-tailored" (triggers the 2-email follow-up)
//   - homepage coaching form sends "coaching-applicant"
// Every contact still gets the original "cheat-sheet" + "free-protocol" tags only when
// no approved tag is sent, so nothing that relied on the old behavior changes.

import { createHash } from 'crypto';

const APPROVED_TAGS = ['cheatsheet-tailored', 'coaching-applicant'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, name, website, ts, tag, tags } = req.body || {};

  // Honeypot: hidden "website" field. Humans never see it; bots fill it.
  if (website) {
    return res.status(200).json({ success: true }); // silently accept, never subscribe
  }

  // Time-trap: form must be open at least 3 seconds before submit.
  const elapsed = Date.now() - Number(ts || 0);
  if (!ts || isNaN(elapsed) || elapsed < 3000) {
    return res.status(200).json({ success: true }); // silently drop instant submits
  }

  // Stricter email validation
  const emailOk = typeof email === 'string'
    && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
    && email.length <= 254
    && !/@(vtext\.com|txt\.att\.net|tmomail\.net|vzwpix\.com|mypixmessages\.com)$/i.test(email);
  if (!emailOk) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  // Accept a single `tag` or a `tags` array; keep only approved tags.
  const requested = []
    .concat(typeof tag === 'string' ? [tag] : [])
    .concat(Array.isArray(tags) ? tags.filter(t => typeof t === 'string') : []);
  const approved = requested.filter(t => APPROVED_TAGS.includes(t));
  const tagNames = approved.length ? approved : ['cheat-sheet', 'free-protocol'];

  const API_KEY = process.env.MAILCHIMP_API_KEY;
  const AUDIENCE_ID = process.env.MAILCHIMP_AUDIENCE_ID;
  const SERVER = process.env.MAILCHIMP_SERVER_PREFIX;
  const base = `https://${SERVER}.api.mailchimp.com/3.0/lists/${AUDIENCE_ID}/members`;
  const headers = {
    Authorization: `apikey ${API_KEY}`,
    'Content-Type': 'application/json'
  };
  const hash = createHash('md5').update(email.toLowerCase()).digest('hex');

  try {
    // 1) UPSERT — creates the contact if new; leaves an existing contact subscribed as-is.
    // Only send a first name when one was given, so a blank field never wipes a saved name.
    const body = { email_address: email, status_if_new: 'subscribed' };
    const cleanName = typeof name === 'string' ? name.trim().slice(0, 80) : '';
    if (cleanName) body.merge_fields = { FNAME: cleanName };

    const put = await fetch(`${base}/${hash}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body)
    });
    const putResult = await put.json();
    if (!(put.status === 200 || put.status === 201)) {
      return res.status(400).json({ error: putResult.detail || 'Subscription failed' });
    }

    // 2) TAG — applied separately so it works for existing contacts too
    //    (this is what fires tag-triggered journeys in Mailchimp).
    await fetch(`${base}/${hash}/tags`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tags: tagNames.map(n => ({ name: n, status: 'active' })) })
    });

    return res.status(200).json({ success: true, existing: put.status === 200 });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
}
