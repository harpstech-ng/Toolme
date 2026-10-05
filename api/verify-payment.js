export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Use POST" });
  
  const { reference, planId, userId } = req.body || {};
  const SECRET = process.env.PAYSTACK_SECRET_KEY;
  
  if (!SECRET) return res.status(500).json({ success: false, error: "Server not configured" });
  if (!reference) return res.status(400).json({ success: false, error: "Missing reference" });
  if (!userId) return res.status(400).json({ success: false, error: "Missing userId" });
  
  // Plan prices in Naira — this prevents users from paying ₦10 for a ₦15,000 plan
  const PLAN_PRICES = {
    starter: 2000,
    pro: 5000,
    business: 15000
  };
  
  if (!PLAN_PRICES[planId]) {
    return res.status(400).json({ success: false, error: "Invalid plan" });
  }
  
  try {
    // verify with Paystack
    const paystackRes = await fetch("https://api.paystack.co/transaction/verify/" + encodeURIComponent(reference), {
      method: "GET",
      headers: {
        "Authorization": "Bearer " + SECRET,
        "Accept": "application/json"
      }
    });
    const data = await paystackRes.json();
    
    if (!data.status) {
      return res.status(400).json({ success: false, error: data.message || "Verification failed" });
    }
    
    const tx = data.data;
    
    if (tx.status !== "success") {
      return res.status(400).json({ success: false, error: "Payment was not successful: " + tx.status });
    }
    
    // check amount matches the plan
    const expectedAmount = PLAN_PRICES[planId] * 100; // kobo
    if (tx.amount < expectedAmount) {
      return res.status(400).json({
        success: false,
        error: "Amount mismatch. Expected ₦" + PLAN_PRICES[planId] + ", got ₦" + (tx.amount / 100)
      });
    }
    
    // check the user_id matches what we sent
    const metadataUser = tx.metadata && tx.metadata.user_id;
    if (metadataUser && metadataUser !== userId) {
      return res.status(400).json({ success: false, error: "User mismatch" });
    }
    
    // success
    return res.json({
      success: true,
      planId: planId,
      amount: tx.amount / 100,
      reference: tx.reference,
      paidAt: tx.paid_at
    });
    
  } catch (err) {
    return res.status(500).json({ success: false, error: String((err && err.message) || err) });
  }
}
