import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';

export const dynamic = 'force-dynamic';
// In-memory OTP storage (use Redis or database in production)
// This is a simple Map that stores OTP codes with expiration
declare global {
  var otpStore: Map<string, { otp: string; expires: number }>;
}

if (!global.otpStore) {
  global.otpStore = new Map();
}

// Initialize Resend with API key
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Generate a 6-digit OTP
function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json(
        { error: 'メールアドレスが必要です' },
        { status: 400 }
      );
    }

    // Generate OTP
    const otp = generateOTP();

    // Store OTP with 10-minute expiration
    const expires = Date.now() + 10 * 60 * 1000; // 10 minutes
    global.otpStore.set(email, { otp, expires });

    // Clean up expired OTPs
    for (const [key, value] of global.otpStore.entries()) {
      if (value.expires < Date.now()) {
        global.otpStore.delete(key);
      }
    }

    // Development mode: Skip email if RESEND_API_KEY is not set
    if (!resend || !process.env.RESEND_API_KEY) {
      console.log(`[DEV MODE] OTP for ${email}: ${otp}`);
      return NextResponse.json({
        success: true,
        message: '開発モード: OTPをコンソールに出力しました',
        devMode: true,
        // Only show OTP in dev mode for testing
        devOtp: process.env.NODE_ENV === 'development' ? otp : undefined
      });
    }

    // Send email via Resend
    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
      to: email,
      subject: '【業務効率化アプリ】認証コード',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(to right, #F6821F, #E5720E); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">業務効率化アプリ</h1>
          </div>
          <div style="background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
            <p style="color: #333; font-size: 16px; margin-bottom: 20px;">
              認証コードは以下の通りです：
            </p>
            <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #F6821F;">
                ${otp}
              </span>
            </div>
            <p style="color: #666; font-size: 14px; margin-top: 20px;">
              このコードは10分間有効です。
            </p>
            <p style="color: #999; font-size: 12px; margin-top: 30px;">
              このメールに心当たりがない場合は、無視してください。
            </p>
          </div>
        </div>
      `,
    });

    if (error) {
      console.error('Resend error:', error);
      return NextResponse.json(
        { error: 'メール送信に失敗しました' },
        { status: 500 }
      );
    }

    console.log(`OTP sent to ${email}, message ID: ${data?.id}`);
    return NextResponse.json({ success: true, message: '認証コードを送信しました' });

  } catch (error) {
    console.error('Send OTP error:', error);
    return NextResponse.json(
      { error: 'サーバーエラーが発生しました' },
      { status: 500 }
    );
  }
}
