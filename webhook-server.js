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
    const session = event.data.object;
    console.log(`💰 [${requestId}] Processing completed checkout session: ${session.id}`);

    try {
      // Build the order data (adapt fields as needed)
      const orderData = {
        // You must map fields from the Stripe session metadata or line_items to your table schema
        user_email: session.customer_details?.email || session.customer_email,
        binding_type: session.metadata?.bindingType,
        price: session.amount_total / 100,
        status: 'paid',
        payment_status: session.payment_status,
        amount: session.amount_total,
        currency: session.currency,
        stripe_session_id: session.id,
        created_at: new Date().toISOString(),
        // Extract metadata fields
        binding_name: session.metadata?.bindingName || null,
        format: session.metadata?.format || null,
        paper_weight: session.metadata?.paperWeight || null,
        printing_option: session.metadata?.printingOption || null,
        page_count: session.metadata?.pageCount ? parseInt(session.metadata.pageCount) : null,
        total_price: session.metadata?.totalPrice ? parseFloat(session.metadata.totalPrice) : null,
        payment_method: session.metadata?.paymentMethod || null,
        // Additional fields
        customer_name: session.customer_details?.name || null,
        customer_address: session.customer_details?.address ? JSON.stringify(session.customer_details.address) : null,
        customer_phone: session.customer_details?.phone || null
      };

      console.log(`📊 [${requestId}] Order data prepared:`, orderData);

      // Insert to Supabase
      const { data, error } = await supabase
        .from('orders')
        .insert([orderData]);

      if (error) {
        console.error(`❌ [${requestId}] Supabase insert error:`, error.message);
        throw new Error(`Supabase insert failed: ${error.message}`);
      } else {
        console.log(`✅ [${requestId}] Order inserted to Supabase:`, data);
      }

      // Send confirmation email via Resend
      const emailResult = await sendConfirmationEmail(orderData, requestId);
      console.log(`📧 [${requestId}] Email sent:`, emailResult);

      console.log(`🎉 [${requestId}] Webhook processing completed successfully`);

    } catch (error) {
      console.error(`❌ [${requestId}] Error processing webhook:`, error);
      // Still return 200 to Stripe to prevent retries
    }
  } else {
    console.log(`ℹ️ [${requestId}] Ignoring event type: ${event.type}`);
  }

  // Always return 200 to Stripe
  res.status(200).json({ received: true, requestId });
});

// Send confirmation email function
async function sendConfirmationEmail(orderData, requestId) {
  try {
    const { data, error } = await resend.emails.send({
      from: 'info@pocat.de', // Your domain email
      to: orderData.user_email,
      subject: 'Danke für deine Bestellung',
      html: '<h1>Danke für deine Bestellung!</h1><p>Dein Auftrag wurde erfolgreich übermittelt.</p>',
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