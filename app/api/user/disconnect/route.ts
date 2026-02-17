import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

export async function POST(request: NextRequest) {
  try {
    const { email, service } = await request.json();

    if (!email || !service) {
      return NextResponse.json(
        { error: 'メールアドレスとサービス名が必要です' },
        { status: 400 }
      );
    }

    if (!['google', 'salesforce'].includes(service)) {
      return NextResponse.json(
        { error: '無効なサービス名です' },
        { status: 400 }
      );
    }

    // Use Supabase if available
    if (supabase) {
      const updateField = service === 'google' ? 'google_token' : 'salesforce_token';

      const { error } = await supabase
        .from('user_connections')
        .update({ [updateField]: null })
        .eq('email', email);

      if (error) {
        console.error('Supabase error:', error);
        return NextResponse.json(
          { error: '連携解除に失敗しました' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: `${service}との連携を解除しました`,
      });
    }

    // Development mode
    const connections = global.connectionStore?.get(email);
    if (connections) {
      if (service === 'google') {
        connections.google_connected = false;
        connections.google_token = undefined;
      } else {
        connections.salesforce_connected = false;
        connections.salesforce_token = undefined;
      }
      global.connectionStore.set(email, connections);
    }

    return NextResponse.json({
      success: true,
      message: `${service}との連携を解除しました`,
    });

  } catch (error) {
    console.error('Disconnect error:', error);
    return NextResponse.json(
      { error: 'サーバーエラーが発生しました' },
      { status: 500 }
    );
  }
}
