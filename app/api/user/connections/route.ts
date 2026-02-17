import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';

// Initialize Supabase client
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

// In-memory connection storage for development
declare global {
  var connectionStore: Map<string, {
    google_connected: boolean;
    google_token?: string;
    salesforce_connected: boolean;
    salesforce_token?: string;
  }>;
}

if (!global.connectionStore) {
  global.connectionStore = new Map();
}

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

    // Use Supabase if available
    if (supabase) {
      const { data, error } = await supabase
        .from('user_connections')
        .select('google_token, salesforce_token')
        .eq('email', email)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Supabase error:', error);
        return NextResponse.json(
          { error: '接続状態の取得に失敗しました' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        google_connected: !!data?.google_token,
        salesforce_connected: !!data?.salesforce_token,
      });
    }

    // Development mode
    const connections = global.connectionStore.get(email);

    return NextResponse.json({
      google_connected: connections?.google_connected || false,
      salesforce_connected: connections?.salesforce_connected || false,
    });

  } catch (error) {
    console.error('Connections error:', error);
    return NextResponse.json(
      { error: 'サーバーエラーが発生しました' },
      { status: 500 }
    );
  }
}
