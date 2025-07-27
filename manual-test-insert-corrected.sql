-- Manual test insert for Supabase orders table (CORRECTED)
-- Run this in Supabase SQL editor to test if the table structure is correct

INSERT INTO orders (
  order_reference,
  status,
  total_price,
  stripe_session_id,
  order_config,
  shipping_method,
  shipping_address
) VALUES (
  'ORD-1732752000000-test123',
  'paid',
  6.95,
  'cs_test_manual_insert_corrected',
  '{
    "binding_type": "softcover-classic",
    "binding_name": "Softcover Classic",
    "format": "A4",
    "paper_weight": "80g",
    "printing_option": "single-sided",
    "page_count": 10,
    "payment_method": "credit_card",
    "customer_email": "test@example.com",
    "customer_name": "Test Customer",
    "customer_phone": "+49123456789",
    "payment_status": "paid",
    "currency": "eur",
    "amount": 695
  }'::jsonb,
  'standard',
  '{"line1": "Test Address", "city": "Test City", "country": "DE"}'::jsonb
);

-- Check if insert was successful
SELECT * FROM orders WHERE stripe_session_id = 'cs_test_manual_insert_corrected';
