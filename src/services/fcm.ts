import { getAdminMessaging } from '../lib/firebaseAdmin';
import { FcmToken } from '../models/FcmToken.model';

export async function sendNewOrderNotification(customerName: string, total: number, itemCount: number): Promise<void> {
  try {
    const messaging = getAdminMessaging();
    if (!messaging) return;

    const docs = await FcmToken.find().lean();
    const tokens = docs.map((d) => d.token);
    if (tokens.length === 0) return;

    await messaging.sendEachForMulticast({
      tokens,
      notification: {
        title: 'New Order Received!',
        body: `${customerName} paid ₹${total.toLocaleString('en-IN')} for ${itemCount} item${itemCount !== 1 ? 's' : ''}`,
      },
      webpush: {
        fcmOptions: { link: '/orders' },
        notification: { icon: '/favicon.ico', badge: '/favicon.ico' },
      },
    });
  } catch (err) {
    console.error('[FCM] sendNewOrderNotification failed:', err);
  }
}
