import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { User } from '../models/User.model';
import { getAdminAuth } from '../lib/firebaseAdmin';

// POST /api/auth/register
// Body: { name, phone, password, firebaseToken }
// firebaseToken proves the phone number is real (verified via Firebase OTP on client)
export async function register(req: Request, res: Response) {
  try {
    const { name, phone, password, firebaseToken } = req.body as {
      name: string; phone: string; password: string; firebaseToken: string;
    };

    if (!name?.trim() || !phone || !password || !firebaseToken) {
      return res.status(400).json({ message: 'name, phone, password and firebaseToken are required.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    }

    // Verify Firebase token → confirms the phone number belongs to this user
    const adminAuth = getAdminAuth();
    if (!adminAuth) {
      return res.status(500).json({ message: 'Auth service unavailable.' });
    }
    let decoded;
    try {
      decoded = await adminAuth.verifyIdToken(firebaseToken);
    } catch {
      return res.status(400).json({ message: 'Phone verification failed. Please verify your number again.' });
    }

    const expectedPhone = `+91${phone.replace(/\D/g, '')}`;
    if (decoded.phone_number !== expectedPhone) {
      return res.status(400).json({ message: 'Verified phone number does not match the provided number.' });
    }

    // Prevent duplicate accounts
    const existing = await User.findOne({ phone: phone.replace(/\D/g, '') });
    if (existing) {
      return res.status(409).json({ message: 'This phone number is already registered. Please sign in.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      name:          name.trim(),
      phone:         phone.replace(/\D/g, ''),
      passwordHash,
      phoneVerified: true,
    });

    res.status(201).json({
      id:            user._id.toString(),
      name:          user.name,
      phone:         user.phone,
      phoneVerified: user.phoneVerified,
    });
  } catch (err) {
    console.error('[auth] register error:', err);
    res.status(500).json({ message: 'Registration failed. Please try again.' });
  }
}

// GET /api/auth/profile?phone=xxx
export async function getProfile(req: Request, res: Response) {
  try {
    const phone = (req.query.phone as string)?.replace(/\D/g, '');
    if (!phone) return res.status(400).json({ message: 'phone required' });
    const user = await User.findOne({ phone }, { passwordHash: 0, emailOtp: 0, emailOtpExpiry: 0 });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({
      id:            user._id.toString(),
      name:          user.name,
      phone:         user.phone,
      email:         user.email ?? '',
      emailVerified: user.emailVerified ?? false,
      address:       user.address ?? '',
      avatarB64:     user.avatarB64 ?? '',
      phoneVerified: user.phoneVerified,
    });
  } catch (err) {
    console.error('[auth] getProfile error:', err);
    res.status(500).json({ message: 'Failed to load profile.' });
  }
}

// PUT /api/auth/profile
// Body: { phone, name?, email?, address?, avatarB64? }
// Changing the email clears emailVerified until re-verified.
export async function updateProfile(req: Request, res: Response) {
  try {
    const { phone, name, email, address, avatarB64 } = req.body as {
      phone: string; name?: string; email?: string; address?: string; avatarB64?: string;
    };
    if (!phone) return res.status(400).json({ message: 'phone required' });
    const user = await User.findOne({ phone: phone.replace(/\D/g, '') });
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (name?.trim()) user.name = name.trim();
    if (email !== undefined) {
      const newEmail = email.trim() || undefined;
      if (newEmail !== user.email) {
        user.email         = newEmail;
        user.emailVerified = false;
      }
    }
    if (address !== undefined) user.address   = address.trim() || undefined;
    if (avatarB64 !== undefined) user.avatarB64 = avatarB64 || undefined;

    await user.save();
    res.json({
      id:            user._id.toString(),
      name:          user.name,
      phone:         user.phone,
      email:         user.email ?? '',
      emailVerified: user.emailVerified ?? false,
      address:       user.address ?? '',
      avatarB64:     user.avatarB64 ?? '',
    });
  } catch (err) {
    console.error('[auth] updateProfile error:', err);
    res.status(500).json({ message: 'Failed to update profile.' });
  }
}

// POST /api/auth/verify-email
// Body: { phone, email, firebaseToken }
// Firebase sends the email link; user clicks it → Firebase ID token contains email claim.
// We verify the token and mark the email as verified in our DB.
export async function verifyEmail(req: Request, res: Response) {
  try {
    const { phone, email, firebaseToken } = req.body as {
      phone: string; email: string; firebaseToken: string;
    };
    if (!phone || !email || !firebaseToken) {
      return res.status(400).json({ message: 'phone, email and firebaseToken are required.' });
    }

    const adminAuth = getAdminAuth();
    if (!adminAuth) return res.status(500).json({ message: 'Auth service unavailable.' });

    let decoded: any;
    try {
      decoded = await adminAuth.verifyIdToken(firebaseToken);
    } catch {
      return res.status(400).json({ message: 'Invalid or expired Firebase token.' });
    }

    if (decoded.email?.toLowerCase() !== email.toLowerCase()) {
      return res.status(400).json({ message: 'Token email does not match the provided email.' });
    }

    const user = await User.findOne({ phone: phone.replace(/\D/g, '') });
    if (!user) return res.status(404).json({ message: 'User not found.' });

    user.email         = email.toLowerCase().trim();
    user.emailVerified = true;
    await user.save();

    res.json({ success: true, emailVerified: true });
  } catch (err) {
    console.error('[auth] verifyEmail error:', err);
    res.status(500).json({ message: 'Email verification failed.' });
  }
}

// DELETE /api/auth/account
// Body: { phone, password } — verifies credentials then hard-deletes the account
export async function deleteAccount(req: Request, res: Response) {
  try {
    const { phone, password } = req.body as { phone: string; password: string };
    if (!phone || !password) {
      return res.status(400).json({ message: 'Phone and password are required.' });
    }
    const user = await User.findOne({ phone: phone.replace(/\D/g, '') });
    if (!user) return res.status(404).json({ message: 'Account not found.' });

    const valid = await user.comparePassword(password);
    if (!valid) return res.status(401).json({ message: 'Incorrect password.' });

    await user.deleteOne();
    res.json({ message: 'Account deleted.' });
  } catch (err) {
    console.error('[auth] deleteAccount error:', err);
    res.status(500).json({ message: 'Could not delete account. Please try again.' });
  }
}

// POST /api/auth/login
// Body: { phone, password } OR { phone, reauthToken } (one-time reauth after Google email verify)
export async function login(req: Request, res: Response) {
  try {
    const { phone, password, reauthToken } = req.body as {
      phone: string; password?: string; reauthToken?: string;
    };

    if (!phone) return res.status(400).json({ message: 'Phone is required.' });

    const user = await User.findOne({ phone: phone.replace(/\D/g, '') });
    if (!user) return res.status(401).json({ message: 'not_registered' });

    if (reauthToken) {
      // One-time reauth path (used after Google email verification to restore phone session)
      if (!user.reauthToken || user.reauthToken !== reauthToken) {
        return res.status(401).json({ message: 'Invalid reauth token.' });
      }
      if (!user.reauthExpiry || user.reauthExpiry < new Date()) {
        return res.status(401).json({ message: 'Reauth token expired. Please try again.' });
      }
      user.reauthToken  = undefined;
      user.reauthExpiry = undefined;
      await user.save();
    } else {
      if (!password) return res.status(400).json({ message: 'Password is required.' });
      const valid = await user.comparePassword(password);
      if (!valid) return res.status(401).json({ message: 'Incorrect password. Please try again.' });
    }

    res.json({
      id:            user._id.toString(),
      name:          user.name,
      phone:         user.phone,
      phoneVerified: user.phoneVerified,
    });
  } catch (err) {
    console.error('[auth] login error:', err);
    res.status(500).json({ message: 'Login failed. Please try again.' });
  }
}

// POST /api/auth/reauth-token
// Body: { phone } — creates a 5-min one-time token used to restore the phone session
// after a Google popup is used for email verification.
export async function createReauthToken(req: Request, res: Response) {
  try {
    const { phone } = req.body as { phone: string };
    if (!phone) return res.status(400).json({ message: 'phone required' });
    const user = await User.findOne({ phone: phone.replace(/\D/g, '') });
    if (!user) return res.status(404).json({ message: 'User not found.' });
    const token = crypto.randomUUID();
    user.reauthToken  = token;
    user.reauthExpiry = new Date(Date.now() + 5 * 60 * 1000);
    await user.save();
    res.json({ token });
  } catch (err) {
    console.error('[auth] createReauthToken error:', err);
    res.status(500).json({ message: 'Could not create token.' });
  }
}

// POST /api/auth/mark-email-verified
// Body: { phone, email, secret } — internal endpoint called by Next.js API route after
// verifying the Google session server-side. Protected by INTERNAL_API_SECRET.
export async function markEmailVerified(req: Request, res: Response) {
  try {
    const { phone, email, secret } = req.body as {
      phone: string; email: string; secret: string;
    };
    if (!phone || !email || !secret) {
      return res.status(400).json({ message: 'phone, email and secret required.' });
    }
    if (secret !== process.env.INTERNAL_API_SECRET) {
      return res.status(403).json({ message: 'Forbidden.' });
    }
    const user = await User.findOne({ phone: phone.replace(/\D/g, '') });
    if (!user) return res.status(404).json({ message: 'User not found.' });
    user.email         = email.toLowerCase().trim();
    user.emailVerified = true;
    await user.save();
    res.json({ success: true });
  } catch (err) {
    console.error('[auth] markEmailVerified error:', err);
    res.status(500).json({ message: 'Could not mark email verified.' });
  }
}
