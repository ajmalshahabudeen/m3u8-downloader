import { ImageResponse } from "next/og";

// Image metadata
export const size = {
  width: 180,
  height: 180,
};
export const contentType = "image/png";

// Apple Touch Image generation
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #090d16 0%, #1e1b4b 60%, #312e81 100%)",
          borderRadius: 40,
          border: "4px solid rgba(99, 102, 241, 0.4)",
          boxSizing: "border-box",
        }}
      >
        <svg
          width="110"
          height="110"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Play Triangle - HLS Stream */}
          <path
            d="M3 5.5C3 4.6 4 4.1 4.8 4.6L11.2 9.1C11.9 9.6 11.9 10.7 11.2 11.1L4.8 15.6C4 16.1 3 15.6 3 14.7V5.5Z"
            fill="url(#apple-gradient-play)"
          />
          {/* Download Arrow */}
          <path
            d="M17 4V13M17 13L13.5 9.5M17 13L20.5 9.5"
            stroke="url(#apple-gradient-arrow)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Download Base Tray */}
          <path
            d="M13.5 17H20.5"
            stroke="url(#apple-gradient-arrow)"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <defs>
            <linearGradient
              id="apple-gradient-play"
              x1="3"
              y1="4.6"
              x2="11.2"
              y2="15.6"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#6366F1" />
              <stop offset="1" stopColor="#A855F7" />
            </linearGradient>
            <linearGradient
              id="apple-gradient-arrow"
              x1="17"
              y1="4"
              x2="17"
              y2="17"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#38BDF8" />
              <stop offset="1" stopColor="#6366F1" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    ),
    {
      ...size,
    }
  );
}
