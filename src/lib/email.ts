// Email verification is handled via Firebase email link auth on the client.
// The backend only verifies the resulting Firebase ID token (which contains the email claim).
// No SMTP configuration is required.
export {};
