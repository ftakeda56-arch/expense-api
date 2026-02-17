export default function Home() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      background: 'linear-gradient(to bottom, #fff7ed, white)',
    }}>
      <div style={{
        background: 'white',
        padding: '40px',
        borderRadius: '16px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
        textAlign: 'center',
      }}>
        <h1 style={{ color: '#f97316', marginBottom: '16px' }}>
          経費申請アプリ API
        </h1>
        <p style={{ color: '#666', marginBottom: '24px' }}>
          Version 3.0.0
        </p>
        <div style={{ color: '#999', fontSize: '14px' }}>
          <p>Available Endpoints:</p>
          <ul style={{ textAlign: 'left', marginTop: '12px' }}>
            <li>/api/auth/send-otp</li>
            <li>/api/auth/verify-otp</li>
            <li>/api/user/register</li>
            <li>/api/user/profile</li>
            <li>/api/user/connections</li>
            <li>/api/sfdc/auth</li>
            <li>/api/sfdc/search</li>
            <li>/api/google/auth</li>
            <li>/api/sheets/kpi</li>
            <li>/api/sheets/meeting/sync</li>
            <li>/api/calendar/meetings</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
