const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const payload = req.body;
    const trackingNumber = payload.trackingNumber || payload._id || payload.deliveryId;
    const state = payload.state ? payload.state.value : (payload.status || null);

    if (!trackingNumber || !state) {
      return res.status(200).send('Ignored: Missing tracking or state');
    }

    const companyState = state.toString().toUpperCase();
    let newAppStatus = 'Processing';

    if (['DELIVERING', 'IN_TRANSIT', 'PICKED_UP', 'ARRIVED_AT_WAREHOUSE'].includes(companyState)) {
      newAppStatus = 'Shipped';
    } else if (companyState === 'DELIVERED') {
      newAppStatus = 'Delivered';
    } else if (['CANCELLED', 'RETURNED', 'TERMINATED', 'FAILED'].includes(companyState)) {
      newAppStatus = 'Cancelled';
    }

    const snapshot = await db.collection('orders').where('trackingNumber', '==', String(trackingNumber)).get();

    if (snapshot.empty) {
      return res.status(200).send('Order not found in database');
    }

    const updatePromises = snapshot.docs.map(doc => {
      const data = doc.data();
      const updates = {
        status: newAppStatus,
        shippingProviderState: companyState,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      if (newAppStatus === 'Delivered') {
        let pieces = 0;
        if (data.products && Array.isArray(data.products)) {
          data.products.forEach(p => { pieces += (p.quantity || 1); });
        }
        updates.deliveredItemsCount = pieces > 0 ? pieces : 1;
      }

      return doc.ref.update(updates);
    });

    await Promise.all(updatePromises);
    return res.status(200).json({ success: true, updatedStatus: newAppStatus });

  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(500).send('Internal Server Error');
  }
};