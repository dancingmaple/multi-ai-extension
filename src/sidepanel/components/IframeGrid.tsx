import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ProviderName } from '../../shared/types';
import { ALL_PROVIDERS, PROVIDER_LABELS, PROVIDER_URLS } from '../../shared/constants';
import styles from './IframeGrid.module.css';

interface IframeGridProps {
  visibleProviders: ProviderName[];
  onToggle: (provider: ProviderName) => void;
}

const MIN_COLUMN_PX = 240;

export const IframeGrid: React.FC<IframeGridProps> = ({ visibleProviders, onToggle }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [columnWidths, setColumnWidths] = useState<number[]>(() =>
    ALL_PROVIDERS.map(() => 100 / ALL_PROVIDERS.length)
  );
  const dragging = useRef<{ index: number; startX: number; startWidths: number[] } | null>(null);

  const visible = ALL_PROVIDERS.map((p) => visibleProviders.includes(p));
  const visibleCount = visible.filter(Boolean).length;

  // Redistribute widths when visibility changes
  useEffect(() => {
    if (visibleCount === 0) return;
    const equalWidth = 100 / visibleCount;
    setColumnWidths((prev) => {
      const next = [...prev];
      ALL_PROVIDERS.forEach((_, i) => {
        if (visible[i]) {
          next[i] = equalWidth;
        } else {
          next[i] = 0;
        }
      });
      return next;
    });
  }, [visibleCount, visible.join(',')]);

  const handleMouseDown = useCallback(
    (index: number, e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = {
        index,
        startX: e.clientX,
        startWidths: [...columnWidths],
      };
    },
    [columnWidths]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const { index, startX, startWidths } = dragging.current;
      const containerWidth = containerRef.current.getBoundingClientRect().width;
      const dx = ((e.clientX - startX) / containerWidth) * 100;

      const newWidths = [...startWidths];
      // Adjust the two adjacent columns
      const leftIdx = index;
      const rightIdx = index + 1;

      if (visible[leftIdx] && visible[rightIdx]) {
        const leftMinPct = (MIN_COLUMN_PX / containerWidth) * 100;
        const rightMinPct = leftMinPct;
        const leftNew = Math.max(leftMinPct, startWidths[leftIdx] + dx);
        const rightNew = Math.max(rightMinPct, startWidths[rightIdx] - dx);

        // Only apply if both are within bounds
        if (leftNew >= leftMinPct && rightNew >= rightMinPct) {
          newWidths[leftIdx] = leftNew;
          newWidths[rightIdx] = rightNew;
        }
      }

      setColumnWidths(newWidths);
    };

    const handleMouseUp = () => {
      dragging.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [visible]);

  const visibleIndices = ALL_PROVIDERS.map((_, i) => i).filter((i) => visible[i]);

  return (
    <div className={styles.container} ref={containerRef}>
      {ALL_PROVIDERS.map((provider, i) => {
        if (!visible[i]) return <React.Fragment key={provider} />;

        const isFirstVisible = visibleIndices[0] === i;
        const url = PROVIDER_URLS[provider];

        return (
          <React.Fragment key={provider}>
            {!isFirstVisible && (
              <div
                className={styles.handle}
                onMouseDown={(e) => handleMouseDown(i - 1, e)}
              >
                <div className={styles.handleLine} />
              </div>
            )}
            <div
              className={styles.column}
              style={{ width: `${columnWidths[i]}%` }}
            >
              <div className={styles.header}>
                <span className={styles.label}>{PROVIDER_LABELS[provider]}</span>
                <button
                  className={styles.closeBtn}
                  onClick={() => onToggle(provider)}
                  title={`Hide ${PROVIDER_LABELS[provider]}`}
                >
                  ×
                </button>
              </div>
              <iframe
                className={styles.iframe}
                src={url}
                title={PROVIDER_LABELS[provider]}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              />
            </div>
          </React.Fragment>
        );
      })}
      {/* Show hidden providers as small toggles */}
      {ALL_PROVIDERS.filter((p) => !visibleProviders.includes(p)).map((provider) => (
        <button
          key={provider}
          className={styles.hiddenToggle}
          onClick={() => onToggle(provider)}
          title={`Show ${PROVIDER_LABELS[provider]}`}
        >
          {PROVIDER_LABELS[provider]}
        </button>
      ))}
    </div>
  );
};
