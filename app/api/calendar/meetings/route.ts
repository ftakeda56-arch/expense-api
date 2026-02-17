import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

interface GoogleTokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  attendees: number;
}

// Get date range for current month
function getCurrentMonthRange(): { start: string; end: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0, 23, 59, 59);

  return {
    start: start.toISOString(),
    end: end.toISOString(),
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

async function fetchCalendarMeetings(
  tokenData: GoogleTokenData
): Promise<{ success: boolean; events?: CalendarEvent[]; error?: string; needsRefresh?: boolean }> {
  try {
    const { start, end } = getCurrentMonthRange();

    // Query Google Calendar API
    const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    url.searchParams.set('timeMin', start);
    url.searchParams.set('timeMax', end);
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('maxResults', '100');

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    if (response.status === 401) {
      return { success: false, needsRefresh: true };
    }

    if (!response.ok) {
      const errorData = await response.json();
      return { success: false, error: errorData.error?.message || 'Calendar query failed' };
    }

    const data = await response.json();
    const events: CalendarEvent[] = [];

    // Filter events that contain "Meeting" or "打ち合わせ"
    for (const item of data.items || []) {
      const title = item.summary || '';
      const lowerTitle = title.toLowerCase();

      if (lowerTitle.includes('meeting') || title.includes('打ち合わせ')) {
        events.push({
          id: item.id,
          title: title,
          date: item.start?.dateTime || item.start?.date || '',
          attendees: (item.attendees || []).length,
        });
      }
    }

    return { success: true, events };
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
      // Return mock data for development
      return NextResponse.json({
        meetings: [
          {
            id: 'mock1',
            title: 'Customer Meeting - ABC Corp',
            date: new Date().toISOString(),
            attendees: 3,
          },
          {
            id: 'mock2',
            title: '打ち合わせ - XYZ社',
            date: new Date().toISOString(),
            attendees: 2,
          },
        ],
      });
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

    // Fetch calendar events
    let result = await fetchCalendarMeetings(tokenData);

    if (result.needsRefresh) {
      const newTokenData = await refreshGoogleToken(tokenData);
      if (newTokenData) {
        if (supabase) {
          await supabase
            .from('user_connections')
            .update({ google_token: JSON.stringify(newTokenData) })
            .eq('email', email);
        }
        result = await fetchCalendarMeetings(newTokenData);
      }
    }

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'カレンダー取得に失敗しました' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      meetings: result.events || [],
    });

  } catch (error) {
    console.error('Calendar error:', error);
    return NextResponse.json(
      { error: 'サーバーエラーが発生しました' },
      { status: 500 }
    );
  }
}
