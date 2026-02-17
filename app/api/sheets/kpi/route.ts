import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';

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
function getCurrentQuarter(): { quarter: string; column: string } {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  let quarter: string;
  if (month >= 1 && month <= 3) quarter = 'Q1';
  else if (month >= 4 && month <= 6) quarter = 'Q2';
  else if (month >= 7 && month <= 9) quarter = 'Q3';
  else quarter = 'Q4';

  // Map quarters to columns (based on the sheet structure)
  // 2025 Q3, 2025 Q4, 2026 Q1, 2026 Q2, 2026 Q3, 2026 Q4
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
    column: quarterColumns[fullQuarter] || 'D',
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

async function getSheetData(
  tokenData: GoogleTokenData,
  userNameAlphabet: string
): Promise<{ success: boolean; data?: any; error?: string; needsRefresh?: boolean }> {
  try {
    const { quarter, column } = getCurrentQuarter();

    // Read the entire Mtg sheet to find user's row
    const range = `${KPI_SHEET_TAB}!A:G`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${KPI_SHEET_ID}/values/${encodeURIComponent(range)}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    if (response.status === 401) {
      return { success: false, needsRefresh: true };
    }

    if (!response.ok) {
      const errorData = await response.json();
      return { success: false, error: errorData.error?.message || 'Sheets query failed' };
    }

    const data = await response.json();
    const rows = data.values || [];

    // Find header row to get column index
    const headerRow = rows[0] || [];
    const quarterIndex = headerRow.findIndex((h: string) => h?.includes(quarter.split(' ')[1]));

    // Find user's row by name
    let userRow = -1;
    let userMeetingCount = 0;

    for (let i = 1; i < rows.length; i++) {
      const name = rows[i][0]?.toLowerCase().trim();
      if (name && name.includes(userNameAlphabet.toLowerCase())) {
        userRow = i;
        userMeetingCount = parseInt(rows[i][quarterIndex] || '0', 10);
        break;
      }
    }

    return {
      success: true,
      data: {
        quarter,
        userRow,
        userMeetingCount,
        quarterIndex,
      },
    };
  } catch (error) {
    return { success: false, error: 'Network error' };
  }
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
      // Return mock KPI data if no user profile
      const { quarter } = getCurrentQuarter();
      return NextResponse.json({
        kpi: {
          userPartnerMeeting: { current: 0, target: 120 },
          cxoVisit: { current: 0, target: 3 },
          quarter,
        },
        pendingMeetings: [],
      });
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
      // Return mock data without Google connection
      const { quarter } = getCurrentQuarter();
      return NextResponse.json({
        kpi: {
          userPartnerMeeting: { current: 45, target: 120 },
          cxoVisit: { current: 1, target: 3 },
          quarter,
        },
        pendingMeetings: [],
      });
    }

    // Check if token needs refresh
    if (tokenData.expires_at < Date.now()) {
      const newTokenData = await refreshGoogleToken(tokenData);
      if (newTokenData) {
        tokenData = newTokenData;
        // Update stored token
        if (supabase) {
          await supabase
            .from('user_connections')
            .update({ google_token: JSON.stringify(tokenData) })
            .eq('email', email);
        }
      }
    }

    // Get KPI data from sheet
    const result = await getSheetData(tokenData, userNameAlphabet);

    if (result.needsRefresh) {
      const newTokenData = await refreshGoogleToken(tokenData);
      if (newTokenData) {
        // Update and retry
        if (supabase) {
          await supabase
            .from('user_connections')
            .update({ google_token: JSON.stringify(newTokenData) })
            .eq('email', email);
        }
        const retryResult = await getSheetData(newTokenData, userNameAlphabet);
        if (retryResult.success) {
          return NextResponse.json({
            kpi: {
              userPartnerMeeting: { current: retryResult.data.userMeetingCount, target: 120 },
              cxoVisit: { current: 1, target: 3 },
              quarter: retryResult.data.quarter,
            },
            pendingMeetings: [],
          });
        }
      }
    }

    if (!result.success) {
      const { quarter } = getCurrentQuarter();
      return NextResponse.json({
        kpi: {
          userPartnerMeeting: { current: 0, target: 120 },
          cxoVisit: { current: 0, target: 3 },
          quarter,
        },
        pendingMeetings: [],
      });
    }

    return NextResponse.json({
      kpi: {
        userPartnerMeeting: { current: result.data.userMeetingCount, target: 120 },
        cxoVisit: { current: 1, target: 3 }, // TODO: read from sheet
        quarter: result.data.quarter,
      },
      pendingMeetings: [], // TODO: integrate with calendar
    });

  } catch (error) {
    console.error('KPI error:', error);
    return NextResponse.json(
      { error: 'サーバーエラーが発生しました' },
      { status: 500 }
    );
  }
}
