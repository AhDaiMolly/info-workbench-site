/**
 * 信息汇总工作台 · 通用弹层（确认对话框等）
 */

import { useEffect, type ReactNode } from 'react';

interface Props {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  extraActions?: ReactNode;
  onConfirm?: () => void;
  onCancel: () => void;
}

export function Modal({
  open, title, children, confirmText = '确定', cancelText = '取消',
  danger, extraActions, onConfirm, onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="iw-modal-mask" role="dialog" aria-modal="true" aria-label={title}>
      <div className="iw-modal">
        <h3 className="iw-modal-title">{title}</h3>
        <div className="iw-modal-body">{children}</div>
        <div className="iw-modal-actions">
          {extraActions}
          <button className="iw-btn" type="button" onClick={onCancel}>{cancelText}</button>
          {onConfirm ? (
            <button
              className={`iw-btn ${danger ? 'iw-btn-danger' : 'iw-btn-primary'}`}
              type="button"
              onClick={onConfirm}
            >
              {confirmText}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
