// api/audit.js — Vercel Serverless Function
// Standards Audit signup. Upserts the contact (works for NEW and EXISTING
// addresses), writes the four score fields, and applies the "Standards Audit"
// tag — which is what triggers the 5-email sequence in Mailchimp.
//
// Bot protection mirrors api/subscribe.js: honeypot + time-trap.
// Uses the same env vars as api/subscribe.js — nothing new to configure.

import { createHash } from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, name, phone, smsok, phys, ment, spir, lowest, website, ts } = req.body || {};

  // Honeypot: hidden "website" field. Humans never see it; bots fill it.
  if (website) {
    return res.status(200).json({ success: true });
  }

  // Time-trap: the audit takes minutes to complete. Anything under 20s is a bot.
  const elapsed = Date.now() - Number(ts || 0);
  if (!ts || isNaN(elapsed) || elapsed < 20000) {
    return res.status(200).json({ success: true });
  }

  const emailOk = typeof email === 'string'
    && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
    && email.length <= 254
    && !/@(vtext\.com|txt\.att\.net|tmomail\.net|vzwpix\.com|mypixmessages\.com)$/i.test(email);
  if (!emailOk) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const clampScore = (v) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? String(Math.max(0, Math.min(100, n))) : '';
  };
  const pillars = ['Physical', 'Mental', 'Spiritual'];
  const lowestClean = pillars.includes(lowest) ? lowest : 'weakest';

  const API_KEY = process.env.MAILCHIMP_API_KEY;
  const AUDIENCE_ID = process.env.MAILCHIMP_AUDIENCE_ID;
  const SERVER = process.env.MAILCHIMP_SERVER_PREFIX;
  const base = `https://${SERVER}.api.mailchimp.com/3.0/lists/${AUDIENCE_ID}/members`;
  const headers = {
    Authorization: `apikey ${API_KEY}`,
    'Content-Type': 'application/json'
  };

  // Mailchimp addresses a member by the MD5 of the lowercased email.
  const hash = createHash('md5').update(email.toLowerCase()).digest('hex');

  const merge_fields = {
    FNAME: typeof name === 'string' ? name.slice(0, 80) : '',
    PHYS: clampScore(phys),
    MENT: clampScore(ment),
    SPIR: clampScore(spir),
    LOWEST: lowestClean
  };
  if (typeof phone === 'string' && phone.trim()) {
    merge_fields.PHONE = phone.trim().slice(0, 30);
  }

  try {
    // 1) UPSERT — creates the contact if new, updates merge fields if existing.
    const put = await fetch(`${base}/${hash}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        email_address: email,
        status_if_new: 'subscribed',
        merge_fields
      })
    });
    const putResult = await put.json();
    if (!(put.status === 200 || put.status === 201)) {
      return res.status(400).json({ error: putResult.detail || 'Subscription failed' });
    }

    // 2) TAG — applied separately so it works for existing contacts too.
    //    This is the trigger for the "Standards Audit" automation.
    const tags = [{ name: 'Standards Audit', status: 'active' }];
    if (smsok === 'yes' || smsok === true) {
      tags.push({ name: 'SMS OK', status: 'active' });
    }
    await fetch(`${base}/${hash}/tags`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tags })
    });

    return res.status(200).json({ success: true, existing: put.status === 200 });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
}
