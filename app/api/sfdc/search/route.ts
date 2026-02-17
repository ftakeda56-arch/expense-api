import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

const SFDC_CLIENT_ID = process.env.SFDC_CLIENT_ID;
const SFDC_CLIENT_SECRET = process.env.SFDC_CLIENT_SECRET;

interface SalesforceTokenData {
  access_token: string;
  refresh_token: string;
  instance_url: string;
}

async function refreshAccessToken(tokenData: SalesforceTokenData): Promise<SalesforceTokenData | null> {
  if (!SFDC_CLIENT_ID || !SFDC_CLIENT_SECRET) return null;

  try {
    const response = await fetch('https://login.salesforce.com/services/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: SFDC_CLIENT_ID,
        client_secret: SFDC_CLIENT_SECRET,
        refresh_token: tokenData.refresh_token,
      }),
    });

    if (!response.ok) return null;

    const newTokenData = await response.json();
    return {
      access_token: newTokenData.access_token,
      refresh_token: tokenData.refresh_token, // Refresh token stays the same
      instance_url: newTokenData.instance_url || tokenData.instance_url,
    };
  } catch {
    return null;
  }
}

async function queryOpportunities(
  tokenData: SalesforceTokenData,
  searchQuery: string
): Promise<{ success: boolean; data?: any; error?: string; needsRefresh?: boolean }> {
  try {
    // SOQL query to search opportunities
    const soql = `
      SELECT Id, Name, Account.Name, Amount, CloseDate, StageName
      FROM Opportunity
      WHERE (Name LIKE '%${searchQuery}%' OR Account.Name LIKE '%${searchQuery}%')
      AND IsClosed = false
      ORDER BY CloseDate ASC
      LIMIT 20
    `;

    const response = await fetch(
      `${tokenData.instance_url}/services/data/v59.0/query?q=${encodeURIComponent(soql)}`,
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.status === 401) {
      return { success: false, needsRefresh: true };
    }

    if (!response.ok) {
      const errorData = await response.json();
      return { success: false, error: errorData.message || 'SFDC query failed' };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: 'Network error' };
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');
    const query = searchParams.get('q');

    if (!email) {
      return NextResponse.json(
        { error: 'メールアドレスが必要です' },
        { status: 400 }
      );
    }

    if (!query || query.length < 2) {
      return NextResponse.json(
        { error: '検索クエリは2文字以上必要です' },
        { status: 400 }
      );
    }

    // Get stored tokens
    let tokenData: SalesforceTokenData | null = null;

    if (supabase) {
      const { data, error } = await supabase
        .from('user_connections')
        .select('salesforce_token')
        .eq('email', email)
        .single();

      if (error || !data?.salesforce_token) {
        return NextResponse.json(
          { error: 'Salesforceへの接続が必要です' },
          { status: 401 }
        );
      }

      tokenData = JSON.parse(data.salesforce_token);
    } else {
      // Development mode
      const connections = global.connectionStore?.get(email);
      if (!connections?.salesforce_token) {
        // Return mock data for development
        return NextResponse.json({
          opportunities: [
            {
              id: '006MOCK00000001',
              name: `${query} - Development Deal`,
              accountName: `${query} Corp`,
              amount: 150000,
              closeDate: '2026-03-31',
              stageName: 'Negotiation',
            },
            {
              id: '006MOCK00000002',
              name: `${query} - Enterprise Agreement`,
              accountName: `${query} Inc`,
              amount: 500000,
              closeDate: '2026-06-30',
              stageName: 'Proposal',
            },
          ],
        });
      }
      tokenData = JSON.parse(connections.salesforce_token);
    }

    if (!tokenData) {
      return NextResponse.json(
        { error: 'Salesforceへの接続が必要です' },
        { status: 401 }
      );
    }

    // Query opportunities
    let result = await queryOpportunities(tokenData, query);

    // If token expired, try to refresh
    if (result.needsRefresh) {
      const newTokenData = await refreshAccessToken(tokenData);
      if (newTokenData) {
        // Update stored token
        if (supabase) {
          await supabase
            .from('user_connections')
            .update({ salesforce_token: JSON.stringify(newTokenData) })
            .eq('email', email);
        }

        // Retry query
        result = await queryOpportunities(newTokenData, query);
      } else {
        return NextResponse.json(
          { error: 'Salesforceへの再接続が必要です' },
          { status: 401 }
        );
      }
    }

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || '検索に失敗しました' },
        { status: 500 }
      );
    }

    // Transform SFDC response to our format
    const opportunities = result.data.records.map((record: any) => ({
      id: record.Id,
      name: record.Name,
      accountName: record.Account?.Name || 'Unknown',
      amount: record.Amount || 0,
      closeDate: record.CloseDate,
      stageName: record.StageName,
    }));

    return NextResponse.json({ opportunities });

  } catch (error) {
    console.error('SFDC search error:', error);
    return NextResponse.json(
      { error: 'サーバーエラーが発生しました' },
      { status: 500 }
    );
  }
}
