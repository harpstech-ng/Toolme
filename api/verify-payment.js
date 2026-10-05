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

  const PLAN_PRICES = {
    starter: 2000,
    pro: 5000,
    business: 15000
  };

  if (!PLAN_PRICES[planId]) {
    return res.status(400).json({ success: false, error: "Invalid plan" });
  }

  try {
    const paystackRes = await fetch(
      "https://api.paystack.co/transaction/verify/" + encodeURIComponent(reference),
      {
        method: "GET",
        headers: {
          "Authorization": "Bearer " + SECRET,
          "Accept": "application/json"
        }
      }
    );
    const data = await paystackRes.json();

    if (!data.status) {
      return res.status(400).json({ success: false, error: data.message || "Verification failed" });
    }

    const tx = data.data;

    if (tx.status !== "success") {
      return res.status(400).json({ success: false, error: "Payment was not successful: " + tx.status });
    }

    const expectedAmount = PLAN_PRICES[planId] * 100;
    if (tx.amount < expectedAmount) {
      return res.status(400).json({
        success: false,
        error: "Amount mismatch. Expected N" + PLAN_PRICES[planId] + ", got N" + (tx.amount / 100)
      });
    }

    const metadataUser = tx.metadata && tx.metadata.user_id;
    if (metadataUser && metadataUser !== userId) {
      return res.status(400).json({ success: false, error: "User mismatch" });
    }

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
