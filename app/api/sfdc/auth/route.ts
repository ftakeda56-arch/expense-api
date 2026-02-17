import { NextRequest, NextResponse } from 'next/server';

// Salesforce OAuth configuration
const SFDC_CLIENT_ID = process.env.SFDC_CLIENT_ID;
const SFDC_REDIRECT_URI = process.env.SFDC_REDIRECT_URI || 'https://expense-app-ten-sigma.vercel.app/api/sfdc/callback';
const SFDC_LOGIN_URL = process.env.SFDC_LOGIN_URL || 'https://login.salesforce.com';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');

    if (!email) {
      return NextResponse.json(
        { error: 'メールアドレスが必要です' },
        { status: 400 }
      );
    }

    if (!SFDC_CLIENT_ID) {
      return NextResponse.json(
        { error: 'Salesforce設定が完了していません' },
        { status: 500 }
      );
    }

    // Salesforce OAuth 2.0 Authorization URL
    const authUrl = new URL(`${SFDC_LOGIN_URL}/services/oauth2/authorize`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', SFDC_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', SFDC_REDIRECT_URI);
    authUrl.searchParams.set('scope', 'api refresh_token');
    authUrl.searchParams.set('state', Buffer.from(JSON.stringify({ email })).toString('base64'));

    // Redirect to Salesforce login
    return NextResponse.redirect(authUrl.toString());

  } catch (error) {
    console.error('SFDC auth error:', error);
    return NextResponse.json(
      { error: 'サーバーエラーが発生しました' },
      { status: 500 }
    );
  }
}
