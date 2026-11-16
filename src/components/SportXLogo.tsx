import React from 'react';

interface SportXLogoProps {
  size?: 'sm' | 'md' | 'lg';
  theme?: 'light' | 'dark';
  showSubtitle?: boolean;
}

export function SportXLogo({
  size = 'md',
  theme = 'light',
  showSubtitle = true,
}: SportXLogoProps) {
  const isDark = theme === 'dark';
  const sportSize =
    size === 'lg'
      ? 'text-2xl sm:text-3xl'
      : size === 'sm'
        ? 'text-base'
        : 'text-lg sm:text-xl';
  const xSize =
    size === 'lg'
      ? 'text-3xl sm:text-4xl'
      : size === 'sm'
        ? 'text-xl'
        : 'text-2xl sm:text-[26px]';
  const iconDim =
    size === 'lg' ? 'w-7 h-7 sm:w-8 sm:h-8' : size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';

  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap shrink-0 select-none font-display">
      <span className="inline-flex items-center">
        <svg
          viewBox="0 0 36 36"
          aria-hidden="true"
          className={`${iconDim} mr-1.5 shrink-0 self-center`}
        >
          <defs>
            <linearGradient id="sportx-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ef4444" />
              <stop offset="55%" stopColor="#f97316" />
              <stop offset="100%" stopColor="#f59e0b" />
            </linearGradient>
          </defs>
          <path
            d="M4 4h9.5l5.5 9.2L24.5 4H34L23.5 18 34 32h-9.5L19 22.8 13.5 32H4l10.5-14L4 4z"
            fill="url(#sportx-grad)"
          />
        </svg>
        <span
          className={`${sportSize} font-extrabold tracking-tight leading-none ${
            isDark ? 'text-white' : 'text-slate-900'
          }`}
        >
          Sport
        </span>
        <span
          className={`${xSize} font-black italic tracking-tighter leading-none bg-gradient-to-br from-red-500 via-orange-500 to-amber-500 bg-clip-text text-transparent ml-0.5`}
        >
          X
        </span>
      </span>
      {showSubtitle && (
        <span
          className={`font-semibold tracking-tight leading-none ${
            size === 'lg'
              ? 'text-base sm:text-lg'
              : size === 'sm'
                ? 'text-xs'
                : 'text-xs sm:text-sm'
          } ${isDark ? 'text-slate-300' : 'text-slate-600'}`}
        >
          booking
        </span>
      )}
    </span>
  );
}
