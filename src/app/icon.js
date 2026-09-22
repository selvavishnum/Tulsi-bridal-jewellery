import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#8b1a4a',
        }}
      >
        <svg width="22" height="20" viewBox="0 0 52 46" fill="none">
          <path d="M26 2L32 16L44 8L38 24H14L8 8L20 16L26 2Z" fill="#e4b040" stroke="#b87d2a" strokeWidth="1.5" />
          <rect x="10" y="26" width="32" height="6" rx="1" fill="#e4b040" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
