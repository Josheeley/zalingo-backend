# Zalingo Stripe Payment + Messaging API

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in the values.
3. `node server.js`

## Endpoints

- POST `/create-checkout-session`
- POST `/webhook`
- GET `/user-credits/:userId`
- POST `/use-credit`