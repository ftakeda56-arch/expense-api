import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// KPI Sheet configuration
const KPI_SHEET_ID = process.env.KPI_SHEET_ID || '1pMyBWA_zOus3FLZifW3esAyGZPOZ3Qe70YGVXOTju0c';
const KPI_SHEET_TAB = 'Mtg';

interface GoogleTokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

// Get current Cloudflare quarter
function getCurrentQuarter(): { quarter: string; columnLetter: string } {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  let quarter: string;
  if (month >= 1 && month <= 3) quarter = 'Q1';
  else if (month >= 4 && month <= 6) quarter = 'Q2';
  else if (month >= 7 && month <= 9) quarter = 'Q3';
  else quarter = 'Q4';

  // Map quarters to columns
  const quarterColumns: Record<string, string> = {
    '2025 Q3': 'B',
    '2025 Q4': 'C',
    '2026 Q1': 'D',
    '2026 Q2': 'E',
    '2026 Q3': 'F',
    '2026 Q4': 'G',
  };

  const fullQuarter = `${year} ${quarter}`;
  return {
    quarter: fullQuarter,
    columnLetter: quarterColumns[fullQuarter] || 'D',
  };
}

async function refreshGoogleToken(tokenData: GoogleTokenData): Promise<GoogleTokenData | null> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return null;

  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: tokenData.refresh_token,
      }),
    });

    if (!response.ok) return null;

    const newTokenData = await response.json();
    return {
      access_token: newTokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: Date.now() + (newTokenData.expires_in * 1000),
    };
  } catch {
    return null;
  }
}

async function findUserRowAndUpdate(
  tokenData: GoogleTokenData,
  userNameAlphabet: string,
  meetingCount: number
): Promise<{ success: boolean; error?: string; needsRefresh?: boolean }> {
  try {
    const { columnLetter } = getCurrentQuarter();

    // First, read the sheet to find user's row
    const readRange = `${KPI_SHEET_TAB}!A:G`;
    const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${KPI_SHEET_ID}/values/${encodeURIComponent(readRange)}`;

    const readResponse = await fetch(readUrl, {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    if (readResponse.status === 401) {
      return { success: false, needsRefresh: true };
    }

    if (!readResponse.ok) {
      const errorData = await readResponse.json();
      return { success: false, error: errorData.error?.message || 'Failed to read sheet' };
    }

    const readData = await readResponse.json();
    const rows = readData.values || [];

    // Find user's row by name
    let userRowNumber = -1;
    let currentValue = 0;

    // Find header row to get correct column index
    const headerRow = rows[0] || [];
    const quarterStr = getCurrentQuarter().quarter;
    let columnIndex = -1;

    for (let i = 0; i < headerRow.length; i++) {
      const header = headerRow[i]?.toString() || '';
      if (header.includes(quarterStr.split(' ')[1]) && header.includes(quarterStr.split(' ')[0])) {
        columnIndex = i;
        break;
      }
    }

    if (columnIndex === -1) {
      // Try finding just by quarter
      for (let i = 0; i < headerRow.length; i++) {
        if (headerRow[i]?.toString().includes(quarterStr)) {
          columnIndex = i;
          break;
        }
      }
    }

    // Default to column index based on letter if not found
    if (columnIndex === -1) {
      columnIndex = columnLetter.charCodeAt(0) - 'A'.charCodeAt(0);
    }

    for (let i = 1; i < rows.length; i++) {
      const name = rows[i][0]?.toLowerCase().trim();
      if (name && name.includes(userNameAlphabet.toLowerCase())) {
        userRowNumber = i + 1; // Sheet rows are 1-indexed
        currentValue = parseInt(rows[i][columnIndex] || '0', 10);
        break;
      }
    }

    if (userRowNumber === -1) {
      return { success: false, error: 'ユーザーがKPIシートに見つかりません' };
    }

    // Calculate new value (cumulative update)
    const newValue = currentValue + meetingCount;

    // Update the cell
    const updateRange = `${KPI_SHEET_TAB}!${columnLetter}${userRowNumber}`;
    const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${KPI_SHEET_ID}/values/${encodeURIComponent(updateRange)}?valueInputOption=USER_ENTERED`;

    const updateResponse = await fetch(updateUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [[newValue]],
      }),
    });

    if (updateResponse.status === 401) {
      return { success: false, needsRefresh: true };
    }

    if (!updateResponse.ok) {
      const errorData = await updateResponse.json();
      return { success: false, error: errorData.error?.message || 'Failed to update sheet' };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: 'Network error' };
  }
}

export async function POST(request: NextRequest) {
  try {
    const { email, meetingCount } = await request.json();

    if (!email) {
      return NextResponse.json(
        { error: 'メールアドレスが必要です' },
        { status: 400 }
      );
    }

    if (typeof meetingCount !== 'number' || meetingCount < 0) {
      return NextResponse.json(
        { error: '有効なミーティング数が必要です' },
        { status: 400 }
      );
    }

    // Get user profile for name_alphabet
    let userNameAlphabet = '';
    if (supabase) {
      const { data: userData } = await supabase
        .from('users')
        .select('name_alphabet')
        .eq('email', email)
        .single();
      userNameAlphabet = userData?.name_alphabet || '';
    } else {
      const userData = global.userStore?.get(email);
      userNameAlphabet = userData?.name_alphabet || '';
    }

    if (!userNameAlphabet) {
      return NextResponse.json(
        { error: 'ユーザープロフィールが見つかりません' },
        { status: 400 }
      );
    }

    // Get Google token
    let tokenData: GoogleTokenData | null = null;
    if (supabase) {
      const { data } = await supabase
        .from('user_connections')
        .select('google_token')
        .eq('email', email)
        .single();
      if (data?.google_token) {
        tokenData = JSON.parse(data.google_token);
      }
    } else {
      const connections = global.connectionStore?.get(email);
      if (connections?.google_token) {
        tokenData = JSON.parse(connections.google_token);
      }
    }

    if (!tokenData) {
      return NextResponse.json(
        { error: 'Googleへの接続が必要です' },
        { status: 401 }
      );
    }

    // Check if token needs refresh
    if (tokenData.expires_at < Date.now()) {
      const newTokenData = await refreshGoogleToken(tokenData);
      if (newTokenData) {
        tokenData = newTokenData;
        if (supabase) {
          await supabase
            .from('user_connections')
            .update({ google_token: JSON.stringify(tokenData) })
            .eq('email', email);
        }
      }
    }

    // Update the sheet
    let result = await findUserRowAndUpdate(tokenData, userNameAlphabet, meetingCount);

    // Handle token refresh if needed
    if (result.needsRefresh) {
      const newTokenData = await refreshGoogleToken(tokenData);
      if (newTokenData) {
        if (supabase) {
          await supabase
            .from('user_connections')
            .update({ google_token: JSON.stringify(newTokenData) })
            .eq('email', email);
        }
        result = await findUserRowAndUpdate(newTokenData, userNameAlphabet, meetingCount);
      } else {
        return NextResponse.json(
          { error: 'Googleへの再接続が必要です' },
          { status: 401 }
        );
      }
    }

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'KPI更新に失敗しました' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `${meetingCount}件のミーティングをKPIに追加しました`,
    });

  } catch (error) {
    console.error('Meeting sync error:', error);
    return NextResponse.json(
      { error: 'サーバーエラーが発生しました' },
      { status: 500 }
    );
  }
}
