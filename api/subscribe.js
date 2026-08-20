// api/subscribe.js — Vercel Serverless Function
// Bot-hardened 2026-08-20: honeypot + time-trap + stricter validation

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, name, website, ts } = req.body;

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

  const API_KEY = process.env.MAILCHIMP_API_KEY;
  const AUDIENCE_ID = process.env.MAILCHIMP_AUDIENCE_ID;
  const SERVER = process.env.MAILCHIMP_SERVER_PREFIX;

  const data = {
    email_address: email,
    status: 'subscribed',
    merge_fields: {
      FNAME: (typeof name === 'string' ? name.slice(0, 80) : '')
    },
    tags: ['cheat-sheet', 'free-protocol']
  };

  try {
    const response = await fetch(
      `https://${SERVER}.api.mailchimp.com/3.0/lists/${AUDIENCE_ID}/members`,
      {
        method: 'POST',
        headers: {
          Authorization: `apikey ${API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      }
    );

    const result = await response.json();

    if (response.status === 200 || response.status === 201) {
      return res.status(200).json({ success: true });
    } else if (result.title === 'Member Exists') {
      return res.status(200).json({ success: true, existing: true });
    } else {
      return res.status(400).json({ error: result.detail || 'Subscription failed' });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
}
