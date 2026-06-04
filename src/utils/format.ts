export function formatNumber(num: number, decimals = 1): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(2) + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'k';
  }
  return num.toFixed(decimals);
}

export function formatCurrency(num: number): string {
  return num.toFixed(2);
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) {
    return mins > 0 ? `${hours}小时${mins}分钟` : `${hours}小时`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `${days}天${remainingHours}小时`;
}

export function getMeterTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    electricity: '电表',
    water: '水表',
    gas: '燃气表',
    cooling: '冷量表',
  };
  return labels[type] || type;
}

export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    normal: '正常',
    warning: '偏高',
    alert: '异常',
  };
  return labels[status] || status;
}
