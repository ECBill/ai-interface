interface LoadingOverlayProps {
  message?: string;
  error?: string | null;
  onRetry?: () => void;
}

export function LoadingOverlay({ message, error, onRetry }: LoadingOverlayProps) {
  return (
    <div className="loading-overlay">
      {error ? (
        <>
          <h2>加载失败</h2>
          <p>{error}</p>
          {onRetry && (
            <button className="loading-retry" onClick={onRetry}>
              重试
            </button>
          )}
        </>
      ) : (
        <>
          <div className="loading-spinner" />
          <p>{message || "正在加载工作区..."}</p>
        </>
      )}
    </div>
  );
}
