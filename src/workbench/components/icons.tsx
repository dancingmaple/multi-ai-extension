// ============================================================
// workbench/components/icons.tsx
// 自含内联 SVG 图标集（stroke 1.5，统一视觉语言）。
// 说明：环境无法安装 @phosphor-icons 等图标库（沙箱 npm 受限），
// 故以统一 stroke 风格的内联 SVG 实现，视觉对齐 Phosphor 系。
// 图标语义：play / stop / save / history / download / panel /
//           plus / check / arrow-right / refresh / copy / link /
//           trash / spark / terminal / arrow-clock / wand。
// ============================================================
import React from 'react';

interface IconProps {
  size?: number;
  className?: string;
}

/** 统一 SVG 基座：stroke 1.5 圆头风格，currentColor 继承 */
function base(size: number, className?: string): React.SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className: className ?? '',
  };
}

/**
 * 包装为 memo 组件：size / className 均为原子值，默认浅比较即可，
 * 避免父组件（如历史列表、节点卡片）重渲染时图标无谓重渲染。
 */
function defineIcon(
  render: (size: number, className?: string) => React.ReactElement
): React.MemoExoticComponent<(p: IconProps) => React.ReactElement> {
  const C = ({ size = 14, className }: IconProps) => render(size, className);
  return React.memo(C);
}

export const PlayIcon = defineIcon((size, className) => (
  <svg {...base(size, className)}>
    <path d="M7 5.5v13l11-6.5z" fill="currentColor" stroke="none" />
  </svg>
));

export const StopIcon = defineIcon((size, className) => (
  <svg {...base(size, className)}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" stroke="none" />
  </svg>
));

export const SaveIcon = defineIcon((size, className) => (
  <svg {...base(size, className)}>
    <path d="M5 4.5h11l2.5 2.5V19.5H5z" />
    <path d="M8 4.5V9h7V4.5" />
    <path d="M8.5 15.5h7" />
    <path d="M8.5 19.5v-4h7v4" />
  </svg>
));

export const HistoryIcon = defineIcon((size, className) => (
  <svg {...base(size, className)}>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
    <path d="M4.5 3.5v4h4" />
    <path d="M12 7.5V12l3 1.8" />
  </svg>
));

export const DownloadIcon = defineIcon((size, className) => (
  <svg {...base(size, className)}>
    <path d="M12 4v10" />
    <path d="M7.5 10.5L12 15l4.5-4.5" />
    <path d="M5 19.5h14" />
  </svg>
));

export const PanelIcon = defineIcon((size, className) => (
  <svg {...base(size, className)}>
    <rect x="4" y="5" width="16" height="14" rx="2" />
    <path d="M4 10h16" />
    <path d="M9.5 10v9" />
  </svg>
));

export const PlusIcon = defineIcon((size, className) => (
  <svg {...base(size, className)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
));

export const CheckIcon = defineIcon((size, className) => (
  <svg {...base(size, className)}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
));

export const ArrowRightIcon = defineIcon((size, className) => (
  <svg {...base(size, className)}>
    <path d="M4 12h15" />
    <path d="M13.5 6.5L19 12l-5.5 5.5" />
  </svg>
));

export const RefreshIcon = defineIcon((size, className) => (
  <svg {...base(size, className)}>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
    <path d="M19.5 3.5v4h-4" />
  </svg>
));

export const CopyIcon = defineIcon((size, className) => (
  <svg {...base(size, className)}>
    <rect x="9" y="9" width="10.5" height="10.5" rx="2" />
    <path d="M5.5 15H5a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 5 4h8A1.5 1.5 0 0 1 14.5 5.5V6" />
  </svg>
));

export const LinkIcon = defineIcon((size, className) => (
  <svg {...base(size, className)}>
    <path d="M10 14a4 4 0 0 0 5.7.3l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5" />
    <path d="M14 10a4 4 0 0 0-5.7-.3l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5" />
  </svg>
));

export const TrashIcon = defineIcon((size, className) => (
  <svg {...base(size, className)}>
    <path d="M4.5 7h15" />
    <path d="M9 7V4.5h6V7" />
    <path d="M6.5 7l1 12h9l1-12" />
    <path d="M10 11v5M14 11v5" />
  </svg>
));

export const SparkIcon = defineIcon((size, className) => (
  <svg {...base(size, className)}>
    <path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z" fill="currentColor" stroke="none" />
    <path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" fill="currentColor" stroke="none" />
  </svg>
));

export const TerminalIcon = defineIcon((size, className) => (
  <svg {...base(size, className)}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <path d="M7 9.5l3 2.5-3 2.5" />
    <path d="M12.5 14.5h4" />
  </svg>
));

export const ArrowClockIcon = defineIcon((size, className) => (
  <svg {...base(size, className)}>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
    <path d="M4.5 3.5v4h4" />
    <path d="M12 8v4l2.5 1.5" />
  </svg>
));

export const WandIcon = defineIcon((size, className) => (
  <svg {...base(size, className)}>
    <path d="M14.5 5l4.5 4.5L8 20.5 3.5 16z" />
    <path d="M3 5.5l1.5 1.5M7 3l.6 1.8M3 9.5L4.5 11" />
    <path d="M18 3.5l.8 2.2L21 6.5l-2.2.8L18 9.5l-.8-2.2L15 6.5l2.2-.8z" />
  </svg>
));

export const GearIcon = defineIcon((size, className) => (
  <svg {...base(size, className)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" />
  </svg>
));

export const CloseIcon = defineIcon((size, className) => (
  <svg {...base(size, className)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
));

export const ArrowLeftIcon = defineIcon((size, className) => (
  <svg {...base(size, className)}>
    <path d="M20 12H5" />
    <path d="M10.5 6.5L5 12l5.5 5.5" />
  </svg>
));

export const EyeIcon = defineIcon((size, className) => (
  <svg {...base(size, className)}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.5" />
  </svg>
));

export const EyeSlashIcon = defineIcon((size, className) => (
  <svg {...base(size, className)}>
    <path d="M4 4l16 16" />
    <path d="M9.9 5.9A9.5 9.5 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.4 3M6.3 6.3A16.6 16.6 0 0 0 2.5 12S6 18.5 12 18.5a9.3 9.3 0 0 0 3.7-.8" />
    <path d="M9.9 9.9a2.8 2.8 0 0 0 3.9 3.9" />
  </svg>
));
