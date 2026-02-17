import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';

// Initialize Supabase client
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

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
        .from('users')
        .select('*')
        .eq('email', email)
        .single();

      if (error && error.code !== 'PGRST116') {
        // PGRST116 = no rows returned
        console.error('Supabase error:', error);
        return NextResponse.json(
          { error: 'プロフィール取得に失敗しました' },
          { status: 500 }
        );
      }

      if (!data) {
        return NextResponse.json({
          registered: false,
          profile: null,
        });
      }

      return NextResponse.json({
        registered: true,
        profile: {
          email: data.email,
          name_kanji: data.name_kanji,
          name_alphabet: data.name_alphabet,
          default_timing: data.default_timing,
        },
      });
    }

    // Development mode: use in-memory storage
    const userData = global.userStore?.get(email);

    if (!userData) {
      return NextResponse.json({
        registered: false,
        profile: null,
      });
    }

    return NextResponse.json({
      registered: true,
      profile: userData,
    });

  } catch (error) {
    console.error('Profile error:', error);
    return NextResponse.json(
      { error: 'サーバーエラーが発生しました' },
      { status: 500 }
    );
  }
}
