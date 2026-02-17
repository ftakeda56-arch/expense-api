import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

// In-memory storage for development
declare global {
  var userStore: Map<string, {
    email: string;
    name_kanji: string;
    name_alphabet: string;
    default_timing: string;
    created_at: string;
  }>;
}

if (!global.userStore) {
  global.userStore = new Map();
}

export async function POST(request: NextRequest) {
  try {
    const { email, name_kanji, name_alphabet, default_timing } = await request.json();

    if (!email || !name_kanji || !name_alphabet) {
      return NextResponse.json(
        { error: 'メールアドレス、氏名（漢字）、氏名（アルファベット）は必須です' },
        { status: 400 }
      );
    }

    const userData = {
      email,
      name_kanji,
      name_alphabet,
      default_timing: default_timing || '',
      created_at: new Date().toISOString(),
    };

    // Use Supabase if available
    if (supabase) {
      const { data, error } = await supabase
        .from('users')
        .upsert({
          email,
          name_kanji,
          name_alphabet,
          default_timing: default_timing || null,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'email',
        })
        .select()
        .single();

      if (error) {
        console.error('Supabase error:', error);
        return NextResponse.json(
          { error: 'ユーザー登録に失敗しました' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: 'ユーザー登録が完了しました',
        profile: data,
      });
    }

    // Development mode: use in-memory storage
    global.userStore.set(email, userData);

    console.log(`[DEV MODE] User registered: ${email}`);

    return NextResponse.json({
      success: true,
      message: 'ユーザー登録が完了しました',
      profile: userData,
    });

  } catch (error) {
    console.error('Register error:', error);
    return NextResponse.json(
      { error: 'サーバーエラーが発生しました' },
      { status: 500 }
    );
  }
}
