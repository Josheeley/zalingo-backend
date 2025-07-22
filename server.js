require('dotenv').config();
const express = require('express');
const Stripe = require('stripe');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Combined plans configuration
const plans = {
  'price_1RncU5ION331djj7xzUmC': { name: 'trial', limit: 10 },
  'price_1RncUtION331djj7om5oiL': { name: 'starter', limit: 50 },
  'price_1RncVMION331djj7F3jbN': { name: 'unlimited', limit: -1 },
  // Additional plans from second implementation
  'price_1RncU5ION331djj7xzUmC': { name: 'Starter', limit: 50 },
  'price_1RncUtION331djj7om5oiL': { name: 'Standard', limit: 200 },
  'price_1RncVMION331djj7F3jbN': { name: 'Premium', limit: Infinity }
};

app.use(cors());
app.use(bodyParser.json());

// Combined checkout session creation
app.post('/create-checkout-session', async (req, res) => {
  const { priceId, customer_email, userId } = req.body;
  
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    ...(customer_email ? { customer_email } : {}),
    ...(userId ? { metadata: { userId } } : {}),
    success_url: process.env.FRONTEND_URL || 'https://zalingo.com' + '?success=true',
    cancel_url: process.env.FRONTEND_URL || 'https://zalingo.com' + '?canceled=true',
  });

  res.json({ url: session.url });
});

// Enhanced webhook handler
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const priceId = session.display_items ? 
                   session.display_items[0].price.id : 
                   (session.items?.data?.[0]?.price?.id || session.metadata?.priceId);
    
    const plan = plans[priceId];
    
    if (plan) {
      // Database update for PostgreSQL users
      if (pool) {
        await pool.query(
          'INSERT INTO users (stripe_customer_id, current_plan, message_limit) VALUES ($1, $2, $3) ON CONFLICT (stripe_customer_id) DO UPDATE SET current_plan=$2, message_limit=$3',
          [session.customer, plan.name, plan.limit]
        );
      }
      
      // In-memory update for simple implementation
      if (session.metadata?.userId) {
        users[session.metadata.userId] = {
          plan: plan.name,
          limit: plan.limit,
          used: 0
        };
      }
    }
  }

  res.json({ received: true });
});

// Combined user information endpoints
app.get('/user/:id', async (req, res) => {
  // Try database first
  const { rows } = await pool.query('SELECT * FROM users WHERE stripe_customer_id = $1', [req.params.id]);
  
  if (rows.length > 0) {
    res.json(rows[0]);
  } 
  // Fall back to in-memory storage
  else if (users[req.params.id]) {
    res.json(users[req.params.id]);
  }
  else {
    res.json({ plan: 'Free', limit: 10, used: 0 });
  }
});

app.get('/user-credits/:userId', async (req, res) => {
  // Alias for compatibility
  const { rows } = await pool.query('SELECT * FROM users WHERE stripe_customer_id = $1', [req.params.userId]);
  if (rows.length > 0) res.json(rows[0]);
  else res.status(404).json({ error: 'User not found' });
});

// Combined credit usage endpoints
app.post('/use-credit', async (req, res) => {
  const { userId } = req.body;
  
  // Try database first
  const { rows } = await pool.query('SELECT * FROM users WHERE stripe_customer_id = $1', [userId]);
  
  if (rows.length > 0) {
    const user = rows[0];
    if (user.message_limit === -1 || user.messages_used < user.message_limit) {
      await pool.query(
        'UPDATE users SET messages_used = messages_used + 1 WHERE stripe_customer_id = $1',
        [userId]
      );
      res.json({ success: true });
    } else {
      res.json({ success: false, message: 'Message limit reached' });
    }
  } 
  // Fall back to in-memory storage
  else if (users[userId]) {
    const user = users[userId];
    if (user.used < user.limit) {
      user.used++;
      res.json({ success: true, remaining: user.limit - user.used });
    } else {
      res.json({ success: false, message: 'Message limit reached' });
    }
  } else {
    res.status(404).json({ error: 'User not found' });
  }
});

app.post('/user/:id/message-used', (req, res) => {
  // In-memory implementation
  const user = users[req.params.id] || (users[req.params.id] = { plan: 'Free', limit: 10, used: 0 });
  if (user.used < user.limit) user.used++;
  res.json({ remaining: user.limit - user.used });
});

// In-memory storage fallback
const users = {};

app.listen(process.env.PORT || 3000, () => console.log("Server running..."));