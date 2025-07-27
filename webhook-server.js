// webhook-server.js
import express from "express";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// Required for Stripe signature verification
app.use(express.raw({ type: "application/json" }));

// Validate required environment variables
const requiredEnvVars = {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  RESEND_API_KEY: process.env.RESEND_API_KEY
};

const missingVars = Object.entries(requiredEnvVars)
  .filter(([key, value]) => !value)
  .map(([key]) => key);

if (missingVars.length > 0) {
  console.warn(`⚠️ Missing environment variables: ${missingVars.join(', ')}`);
  console.warn('Server will start but webhook processing will fail without these variables.');
}

// Initialize services with fallbacks for development
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY 
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Webhook endpoint
app.post("/webhook", async (req, res) => {
  const requestId = Math.random().toString(36).substring(7);
  console.log(`🪝 [${requestId}] Stripe webhook received`);
  
  // Check if required services are available
  if (!stripe || !supabase || !resend) {
    console.error(`❌ [${requestId}] Missing required services:`, {
      stripe: !!stripe,
      supabase: !!supabase,
      resend: !!resend
    });
    return res.status(500).json({ 
      error: 'Server not properly configured',
      missing: missingVars
    });
  }
  
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    // Verify Stripe signature
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    console.log(`✅ [${requestId}] Stripe signature verified, event type: ${event.type}`);
  } catch (err) {
    console.error(`❌ [${requestId}] Webhook signature verification failed:`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Only process checkout.session.completed events
  if (event.type === 'checkout.session.completed') {
    // Insert order to Supabase and send email (add your logic here)
    console.log('✅ Stripe checkout.session.completed:', event.data.object);
  } else {
    console.log(`ℹ️ [${requestId}] Ignoring event type: ${event.type}`);
  }

  // Always return 200 to Stripe
  res.status(200).json({ received: true, requestId });
});

// Send confirmation email function
async function sendConfirmationEmail(orderData, requestId) {
  try {
    const emailContent = `
      <h2>Vielen Dank für Ihre Bestellung bei POCAT!</h2>
      <p>Ihre Bestellung wurde erfolgreich verarbeitet.</p>
      
      <h3>Bestelldetails:</h3>
      <ul>
        <li><strong>Bindung:</strong> ${orderData.binding_name || 'N/A'}</li>
        <li><strong>Format:</strong> ${orderData.format || 'N/A'}</li>
        <li><strong>Papiergewicht:</strong> ${orderData.paper_weight || 'N/A'}</li>
        <li><strong>Druckoption:</strong> ${orderData.printing_option || 'N/A'}</li>
        <li><strong>Seitenanzahl:</strong> ${orderData.page_count || 'N/A'}</li>
        <li><strong>Gesamtpreis:</strong> ${(orderData.amount / 100).toFixed(2)} €</li>
        <li><strong>Zahlungsstatus:</strong> ${orderData.payment_status}</li>
      </ul>
      
      <p>Wir werden Ihre Bestellung so schnell wie möglich bearbeiten.</p>
      <p>Bei Fragen erreichen Sie uns unter: info@pocat.de</p>
      
      <p>Mit freundlichen Grüßen,<br>Ihr POCAT Team</p>
    `;

    const { data, error } = await resend.emails.send({
      from: 'info@pocat.de',
      to: orderData.user_email,
      subject: 'Bestellbestätigung - POCAT',
      html: emailContent
    });

    if (error) {
      console.error(`❌ [${requestId}] Resend email failed:`, error);
      throw new Error(`Email send failed: ${error.message}`);
    }

    console.log(`✅ [${requestId}] Email sent successfully:`, data);
    return { success: true, data };
    
  } catch (error) {
    console.error(`❌ [${requestId}] Email send error:`, error);
    throw error;
  }
}

// Health check route
app.get("/", (req, res) => {
  res.json({ 
    status: "OK", 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    services: {
      stripe: !!stripe,
      supabase: !!supabase,
      resend: !!resend
    },
    missing: missingVars
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Webhook server listening on port ${PORT}`);
  console.log(`📧 Resend API configured: ${process.env.RESEND_API_KEY ? 'Yes' : 'No'}`);
  console.log(`🗄️ Supabase configured: ${process.env.NEXT_PUBLIC_SUPABASE_URL ? 'Yes' : 'No'}`);
  console.log(`💳 Stripe configured: ${process.env.STRIPE_SECRET_KEY ? 'Yes' : 'No'}`);
  if (missingVars.length > 0) {
    console.log(`⚠️ Missing environment variables: ${missingVars.join(', ')}`);
  }
}); 