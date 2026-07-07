// api/subscribe.js — Vercel Serverless Function
// Upload this as api/subscribe.js in your GitHub repo

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, name } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const API_KEY = process.env.MAILCHIMP_API_KEY;
  const AUDIENCE_ID = process.env.MAILCHIMP_AUDIENCE_ID;
  const SERVER = process.env.MAILCHIMP_SERVER_PREFIX;

  const data = {
    email_address: email,
    status: 'subscribed',
    merge_fields: {
      FNAME: name || ''
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
