import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'https://expense-api-one.vercel.app/api/google/callback';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      return new NextResponse(generateErrorPage('認証がキャンセルされました'), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    if (!code || !state) {
      return new NextResponse(generateErrorPage('認証パラメータが不足しています'), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // Decode state to get email
    let email: string;
    try {
      const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
      email = stateData.email;
    } catch {
      return new NextResponse(generateErrorPage('無効な認証状態です'), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return new NextResponse(generateErrorPage('Google設定が完了していません'), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // Exchange code for access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        code,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json();
      console.error('Google token error:', errorData);
      return new NextResponse(generateErrorPage('トークン取得に失敗しました'), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    const tokenData = await tokenResponse.json();

    // Store tokens
    const connectionData = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: Date.now() + (tokenData.expires_in * 1000),
    };

    if (supabase) {
      const { error: upsertError } = await supabase
        .from('user_connections')
        .upsert({
          email,
          google_token: JSON.stringify(connectionData),
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'email',
        });

      if (upsertError) {
        console.error('Supabase error:', upsertError);
        return new NextResponse(generateErrorPage('接続情報の保存に失敗しました'), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
    } else {
      // Development mode
      const existing = global.connectionStore?.get(email) || {
        google_connected: false,
        salesforce_connected: false,
      };
      global.connectionStore?.set(email, {
        ...existing,
        google_connected: true,
        google_token: JSON.stringify(connectionData),
      });
    }

    // Return success page that closes the window
    return new NextResponse(generateSuccessPage(), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });

  } catch (error) {
    console.error('Google callback error:', error);
    return new NextResponse(generateErrorPage('サーバーエラーが発生しました'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

function generateSuccessPage(): string {
  return `
    <!DOCTYPE html>
    <html lang="ja">
      <head>
        <meta charset="utf-8">
        <title>Google連携完了</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(to bottom, #f5f5f5, white);
          }
          .container {
            text-align: center;
            padding: 40px;
            background: white;
            border-radius: 16px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          }
          .success-icon {
            width: 64px;
            height: 64px;
            background: #22c55e;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 20px;
          }
          .success-icon svg {
            width: 32px;
            height: 32px;
            color: white;
          }
          h1 { color: #333; margin-bottom: 10px; }
          p { color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="success-icon">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
            </svg>
          </div>
          <h1>連携完了</h1>
          <p>Googleとの連携が完了しました。</p>
          <p>このウィンドウは自動的に閉じます。</p>
        </div>
        <script>
          setTimeout(() => window.close(), 2000);
        </script>
      </body>
    </html>
  `;
}

function generateErrorPage(message: string): string {
  return `
    <!DOCTYPE html>
    <html lang="ja">
      <head>
        <meta charset="utf-8">
        <title>エラー</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(to bottom, #f5f5f5, white);
          }
          .container {
            text-align: center;
            padding: 40px;
            background: white;
            border-radius: 16px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          }
          .error-icon {
            width: 64px;
            height: 64px;
            background: #ef4444;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 20px;
          }
          .error-icon svg {
            width: 32px;
            height: 32px;
            color: white;
          }
          h1 { color: #333; margin-bottom: 10px; }
          p { color: #666; }
          button {
            margin-top: 20px;
            padding: 12px 24px;
            background: #f97316;
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="error-icon">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </div>
          <h1>エラー</h1>
          <p>${message}</p>
          <button onclick="window.close()">閉じる</button>
        </div>
      </body>
    </html>
  `;
}
