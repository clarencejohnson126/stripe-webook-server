// webhook-server.js
import express from "express";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf } }));

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Required for Stripe signature
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    // Insert into Supabase "orders" table
    await supabase
      .from("orders")
      .insert([
        {
          user_email: session.customer_email,
          payment_status: session.payment_status,
          amount: session.amount_total,
          // ... add other fields as needed from your metadata
        }
      ]);
    // (Send confirmation email logic here, e.g. via Resend API)
    console.log("Order inserted & email logic goes here:", session);
  }

  res.status(200).json({ received: true });
});

// Health check route
app.get("/", (req, res) => res.send("OK"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Listening on", PORT)); 