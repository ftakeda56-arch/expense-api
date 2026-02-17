import { NextRequest, NextResponse } from 'next/server';

// Access the global OTP store
export const dynamic = 'force-dynamic';
declare global {
  var otpStore: Map<string, { otp: string; expires: number }>;
}

if (!global.otpStore) {
  global.otpStore = new Map();
}

export async function POST(request: NextRequest) {
  try {
    const { email, otp } = await request.json();

    if (!email || !otp) {
      return NextResponse.json(
        { error: 'メールアドレスと認証コードが必要です' },
        { status: 400 }
      );
    }

    // Development mode: Accept any 6-digit OTP if RESEND_API_KEY is not set
    if (!process.env.RESEND_API_KEY) {
      if (otp.length === 6 && /^\d{6}$/.test(otp)) {
        console.log(`[DEV MODE] OTP verified for ${email}`);
        return NextResponse.json({ success: true, message: '認証成功（開発モード）' });
      }
      return NextResponse.json(
        { error: '無効な認証コードです' },
        { status: 401 }
      );
    }

    // Production mode: Verify against stored OTP
    const storedData = global.otpStore.get(email);

    if (!storedData) {
      console.log(`No OTP found for ${email}`);
      return NextResponse.json(
        { error: '認証コードが見つかりません。再度送信してください。' },
        { status: 401 }
      );
    }

    // Check expiration
    if (storedData.expires < Date.now()) {
      global.otpStore.delete(email);
      console.log(`OTP expired for ${email}`);
      return NextResponse.json(
        { error: '認証コードの有効期限が切れています。再度送信してください。' },
        { status: 401 }
      );
    }

    // Verify OTP
    if (storedData.otp !== otp) {
      console.log(`Invalid OTP for ${email}: expected ${storedData.otp}, got ${otp}`);
      return NextResponse.json(
        { error: '認証コードが正しくありません' },
        { status: 401 }
      );
    }

    // OTP verified successfully - delete it to prevent reuse
    global.otpStore.delete(email);
    console.log(`OTP verified successfully for ${email}`);

    return NextResponse.json({ success: true, message: '認証成功' });

  } catch (error) {
    console.error('Verify OTP error:', error);
    return NextResponse.json(
      { error: 'サーバーエラーが発生しました' },
      { status: 500 }
    );
  }
}
