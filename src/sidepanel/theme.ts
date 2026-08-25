/** 主题切换的图标与顺序，抽出避免 App / Fullscreen 重复定义（#66） */

export const THEME_ICON: Record<string, string> = { light: '☀', dark: '🌙', auto: '🌗' };

export const THEME_ORDER = ['light', 'dark', 'auto'] as const;
