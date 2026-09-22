import { ImageResponse } from 'next/og';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#8b1a4a',
          backgroundImage: 'linear-gradient(135deg, #8b1a4a 0%, #601238 100%)',
        }}
      >
        <svg width="96" height="84" viewBox="0 0 52 46" fill="none">
          <path d="M26 2L32 16L44 8L38 24H14L8 8L20 16L26 2Z" fill="#e4b040" stroke="#b87d2a" strokeWidth="1.5" />
          <rect x="10" y="26" width="32" height="6" rx="1" fill="#e4b040" />
        </svg>
        <div
          style={{
            marginTop: 36,
            fontSize: 56,
            fontWeight: 700,
            color: '#faf0d0',
            letterSpacing: 2,
          }}
        >
          TULSI BRIDAL JEWELLERY
        </div>
        <div style={{ marginTop: 14, fontSize: 26, color: '#f4c9dd', letterSpacing: 4 }}>
          HANDCRAFTED BRIDAL JEWELLERY · BUY OR RENT
        </div>
      </div>
    ),
    { ...size }
  );
}
